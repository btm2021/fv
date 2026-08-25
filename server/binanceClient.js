/**
 * Binance Futures REST Client with Rate Limiting & Candle Buffer Optimization
 */
const DB = require('./db');

const BINANCE_FAPI_BASE = 'https://fapi.binance.com';

class BinanceClient {
  constructor() {
    this.requestQueue = [];
    this.isProcessing = false;
    this.lastRequestTime = 0;
    this.minRequestIntervalMs = 120; // Max ~8 requests/sec to stay far below Binance 1200 weight/min limit
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async fetchWithRateLimit(url) {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestIntervalMs) {
      await this.sleep(this.minRequestIntervalMs - elapsed);
    }
    this.lastRequestTime = Date.now();

    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NodeTradingBot/1.0'
        }
      });

      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Binance API HTTP ${response.status}: ${txt}`);
      }

      return await response.json();
    } catch (err) {
      console.error(`[BinanceClient Error] ${url} ->`, err.message);
      throw err;
    }
  }

  /**
   * Fetches latest ticker price for one or all symbols
   */
  async getTickerPrice(symbol = null) {
    let url = `${BINANCE_FAPI_BASE}/fapi/v1/ticker/price`;
    if (symbol) {
      url += `?symbol=${symbol.toUpperCase()}`;
    }
    return await this.fetchWithRateLimit(url);
  }

  /**
   * Fetches 24h market stats for exchange discovery
   */
  async get24hTicker(symbol = null) {
    let url = `${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`;
    if (symbol) {
      url += `?symbol=${symbol.toUpperCase()}`;
    }
    return await this.fetchWithRateLimit(url);
  }

  /**
   * Fetches Exchange Info (list of all USDT perpetual futures contracts)
   */
  async getExchangeInfo() {
    const url = `${BINANCE_FAPI_BASE}/fapi/v1/exchangeInfo`;
    const data = await this.fetchWithRateLimit(url);
    if (data && data.symbols) {
      return data.symbols
        .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL')
        .map(s => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          pricePrecision: s.pricePrecision,
          quantityPrecision: s.quantityPrecision
        }));
    }
    return [];
  }

  /**
   * Smart Candle Sync:
   * - If no local candles in SQLite: fetch target limit (e.g. 1500 bars)
   * - If already has local candles: fetch only newly closed bars since latest timestamp
   */
  async syncCandles(symbol, timeframe = '5m', targetBuffer = 1500) {
    const sym = symbol.toUpperCase();
    const localCandles = await DB.getCandles(sym, timeframe, targetBuffer);

    let klines = [];
    if (localCandles.length === 0) {
      // Cold start: Fetch initial 1500 candles (via 3 batches of 500 or 1500)
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/klines?symbol=${sym}&interval=${timeframe}&limit=${Math.min(targetBuffer, 1000)}`;
      const raw = await this.fetchWithRateLimit(url);
      klines = this.parseKlines(raw);
    } else {
      // Incremental Sync: Fetch recent candles since last stored time
      const latestTimeMs = localCandles[localCandles.length - 1].time * 1000;
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/klines?symbol=${sym}&interval=${timeframe}&startTime=${latestTimeMs}&limit=100`;
      const raw = await this.fetchWithRateLimit(url);
      klines = this.parseKlines(raw);
    }

    if (klines.length > 0) {
      await DB.saveCandles(sym, timeframe, klines);
    }

    return await DB.getCandles(sym, timeframe, targetBuffer);
  }

  parseKlines(rawList) {
    if (!Array.isArray(rawList)) return [];
    return rawList.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: Math.floor(k[6] / 1000)
    }));
  }
}

module.exports = new BinanceClient();
