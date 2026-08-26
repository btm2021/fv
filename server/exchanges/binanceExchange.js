/**
 * Binance Futures USDT-M Standardized Exchange Adapter
 */
const BaseExchangeAdapter = require('./baseExchange');
const DB = require('../db');
const { WebSocket } = require('ws');
const logger = require('../logger');

const BINANCE_FAPI_BASE = 'https://fapi.binance.com';

class BinanceExchangeAdapter extends BaseExchangeAdapter {
  constructor() {
    super({
      id: 'BINANCE',
      name: 'Binance USDT-M Futures',
      icon: '🔶',
      defaultTargetSymbols: 500,
      takerFeeRate: 0.0005, // 0.05% Taker VIP0
      makerFeeRate: 0.0002, // 0.02% Maker VIP0
      mmrRate: 0.005,       // 0.5% MMR
      minRequestIntervalMs: 120,
      pacingConfig: {
        tasksPerBucket: 250,
        microBatchSize: 15,
        tickIntervalMs: 1500,
        ratePerMin: 600,
        totalBuckets: 5
      }
    });

    this.ws = null;
    this.livePriceMap = {};
    this.reconnectTimer = null;
    this.isReconnecting = false;
  }

  mapTimeframe(tf) {
    return tf || '5m';
  }

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
          quantityPrecision: s.quantityPrecision,
          raw: s
        }));
    }
    return [];
  }

  async getTickerPrice(symbol = null) {
    let url = `${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`;
    if (symbol) url += `?symbol=${symbol.toUpperCase()}`;
    const data = await this.fetchWithRateLimit(url);
    if (Array.isArray(data)) {
      return data.map(d => ({
        symbol: d.symbol,
        lastPrice: parseFloat(d.lastPrice),
        high24h: parseFloat(d.highPrice),
        low24h: parseFloat(d.lowPrice),
        volume24h: parseFloat(d.volume),
        turnover24h: parseFloat(d.quoteVolume),
        priceChangePct: parseFloat(d.priceChangePercent)
      }));
    } else if (data && data.symbol) {
      return [{
        symbol: data.symbol,
        lastPrice: parseFloat(data.lastPrice),
        high24h: parseFloat(data.highPrice),
        low24h: parseFloat(data.lowPrice),
        volume24h: parseFloat(data.volume),
        turnover24h: parseFloat(data.quoteVolume),
        priceChangePct: parseFloat(data.priceChangePercent)
      }];
    }
    return [];
  }

  async syncCandles(symbol, timeframe = '5m', targetBuffer = 1500) {
    const sym = symbol.toUpperCase();
    const localCandles = await DB.getCandles(sym, timeframe, targetBuffer, 'BINANCE');

    let klines = [];
    if (localCandles.length === 0) {
      const limit = Math.min(targetBuffer, 1500);
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/klines?symbol=${sym}&interval=${timeframe}&limit=${limit}`;
      const raw = await this.fetchWithRateLimit(url);
      klines = raw.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    } else {
      const latestLocalTime = localCandles[localCandles.length - 1].time;
      const startTimeMs = (latestLocalTime + 1) * 1000;
      const url = `${BINANCE_FAPI_BASE}/fapi/v1/klines?symbol=${sym}&interval=${timeframe}&startTime=${startTimeMs}&limit=100`;
      const raw = await this.fetchWithRateLimit(url);
      if (raw && raw.length > 0) {
        const newBars = raw.map(k => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5])
        }));
        klines = [...localCandles, ...newBars];
      } else {
        klines = localCandles;
      }
    }

    await DB.saveCandles(sym, timeframe, klines, 'BINANCE');
    return klines;
  }

  // ── WEBSOCKET STREAM ──
  connectWs() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    const wsUrl = 'wss://fstream.binance.com/ws/!miniTicker@arr';
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.on('open', () => {
        logger.success('BINANCE_WS', '⚡ Connected to Binance Futures Live Ticker Stream (!miniTicker@arr).');
      });
      this.ws.on('message', (data) => {
        try {
          const tickers = JSON.parse(data);
          if (!Array.isArray(tickers)) return;
          for (let i = 0; i < tickers.length; i++) {
            const t = tickers[i];
            if (t.s && t.c) this.livePriceMap[t.s] = parseFloat(t.c);
          }
        } catch (e) {}
      });
      this.ws.on('error', (err) => logger.error('BINANCE_WS', `Binance WS Error: ${err.message}`));
      this.ws.on('close', () => this.scheduleReconnectWs());
    } catch (e) {
      this.scheduleReconnectWs();
    }
  }

  scheduleReconnectWs() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.isReconnecting = false;
      this.connectWs();
    }, 3000);
  }

  getLivePrice(symbol) {
    if (!symbol) return null;
    return this.livePriceMap[symbol.toUpperCase()] || null;
  }
}

module.exports = new BinanceExchangeAdapter();
