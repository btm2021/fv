/**
 * Bybit V5 Linear Futures REST Client with Rate Limiting & Candle Buffer Optimization
 * 
 * Features:
 * - Bybit V5 API (/v5/market/kline, /v5/market/tickers, /v5/market/instruments-info)
 * - Isolated Request Pacing & Queue (Max 8 req/s to stay safely within Bybit rate limits)
 * - Standardized Candle formatting ({ time, open, high, low, close, volume })
 * - Target 1,000 candles per symbol timeframe
 */
const DB = require('./db');

const BYBIT_API_BASE = 'https://api.bybit.com';

class BybitClient {
  constructor() {
    this.requestQueue = [];
    this.isProcessing = false;
    this.lastRequestTime = 0;
    this.minRequestIntervalMs = 120; // Max ~8 requests/sec (Bybit allows 120-600 req/min)
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
          'User-Agent': 'NodeTradingBot-Bybit/1.0'
        }
      });

      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Bybit API HTTP ${response.status}: ${txt}`);
      }

      const json = await response.json();
      if (json.retCode !== 0 && json.retCode !== undefined) {
        throw new Error(`Bybit V5 Error (${json.retCode}): ${json.retMsg}`);
      }

      return json.result || json;
    } catch (err) {
      console.error(`[BybitClient Error] ${url} ->`, err.message);
      throw err;
    }
  }

  /**
   * Map standard timeframe to Bybit interval format:
   * 1m -> 1, 3m -> 3, 5m -> 5, 15m -> 15, 30m -> 30, 1h -> 60, 4h -> 240, 1d -> D
   */
  mapTimeframeToInterval(tf) {
    const map = {
      '1m': '1',
      '3m': '3',
      '5m': '5',
      '15m': '15',
      '30m': '30',
      '1h': '60',
      '2h': '120',
      '4h': '240',
      '1d': 'D'
    };
    return map[tf] || '5';
  }

  /**
   * Fetches latest ticker price for one or all Bybit Linear perpetual symbols
   */
  async getTickerPrice(symbol = null) {
    let url = `${BYBIT_API_BASE}/v5/market/tickers?category=linear`;
    if (symbol) {
      url += `&symbol=${symbol.toUpperCase()}`;
    }
    const res = await this.fetchWithRateLimit(url);
    return res && res.list ? res.list : [];
  }

  /**
   * Fetches all Bybit Linear instruments info (USDT Perpetual pairs)
   */
  async getExchangeInfo() {
    const url = `${BYBIT_API_BASE}/v5/market/instruments-info?category=linear&limit=1000`;
    const res = await this.fetchWithRateLimit(url);
    if (res && res.list) {
      return res.list
        .filter(s => s.status === 'Trading' && s.quoteCoin === 'USDT' && s.contractType === 'LinearPerpetual')
        .map(s => ({
          symbol: s.symbol,
          baseAsset: s.baseCoin,
          quoteAsset: s.quoteCoin,
          pricePrecision: s.priceScale || 2,
          quantityPrecision: s.lotSizeFilter && s.lotSizeFilter.qtyStep ? s.lotSizeFilter.qtyStep : 0.001
        }));
    }
    return [];
  }

  /**
   * Smart Candle Sync for Bybit:
   * Fetches up to 1,000 candles and standardizes to { time (sec), open, high, low, close, volume }
   */
  async syncCandles(symbol, timeframe = '5m', targetBuffer = 1000) {
    const sym = symbol.toUpperCase();
    const interval = this.mapTimeframeToInterval(timeframe);
    const limit = Math.min(targetBuffer, 1000);
    const url = `${BYBIT_API_BASE}/v5/market/kline?category=linear&symbol=${sym}&interval=${interval}&limit=${limit}`;

    const res = await this.fetchWithRateLimit(url);
    if (!res || !res.list || !Array.isArray(res.list) || res.list.length === 0) {
      return [];
    }

    // Bybit V5 returns reverse chronological: [startTime, open, high, low, close, volume, turnover]
    const formatted = res.list.map(k => ({
      time: Math.floor(parseInt(k[0], 10) / 1000), // Convert ms to seconds
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    })).filter(c => !isNaN(c.time) && !isNaN(c.close));

    // Sort chronological (ascending)
    formatted.sort((a, b) => a.time - b.time);

    // Save to SQLite with exchange = 'BYBIT'
    await DB.saveCandles(sym, timeframe, formatted, 'BYBIT');
    return formatted;
  }
}

module.exports = new BybitClient();
