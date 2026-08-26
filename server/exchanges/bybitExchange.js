/**
 * Bybit Linear Perpetual Standardized Exchange Adapter (V5 API)
 */
const BaseExchangeAdapter = require('./baseExchange');
const DB = require('../db');
const { WebSocket } = require('ws');
const logger = require('../logger');

const BYBIT_API_BASE = 'https://api.bybit.com';

class BybitExchangeAdapter extends BaseExchangeAdapter {
  constructor() {
    super({
      id: 'BYBIT',
      name: 'Bybit Linear Perpetual',
      icon: '⬛',
      defaultTargetSymbols: 300,
      takerFeeRate: 0.00055, // 0.055% Bybit Taker VIP0
      makerFeeRate: 0.0002,  // 0.02% Bybit Maker VIP0
      mmrRate: 0.005,        // 0.5% MMR
      minRequestIntervalMs: 120,
      pacingConfig: {
        tasksPerBucket: 120,
        microBatchSize: 6,
        tickIntervalMs: 3000,
        ratePerMin: 120,
        totalBuckets: 5
      }
    });

    this.ws = null;
    this.livePriceMap = {};
    this.subscribedSymbols = new Set();
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.isReconnecting = false;
  }

  mapTimeframe(tf) {
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

  async getExchangeInfo() {
    const url = `${BYBIT_API_BASE}/v5/market/instruments-info?category=linear&limit=1000`;
    const res = await this.fetchWithRateLimit(url);
    if (res && res.result && res.result.list) {
      return res.result.list
        .filter(s => s.status === 'Trading' && s.quoteCoin === 'USDT' && s.contractType === 'LinearPerpetual')
        .map(s => ({
          symbol: s.symbol,
          baseAsset: s.baseCoin,
          quoteAsset: s.quoteCoin,
          pricePrecision: s.priceScale || 2,
          quantityPrecision: s.lotSizeFilter && s.lotSizeFilter.qtyStep ? s.lotSizeFilter.qtyStep : 0.001,
          raw: s
        }));
    }
    return [];
  }

  async getTickerPrice(symbol = null) {
    let url = `${BYBIT_API_BASE}/v5/market/tickers?category=linear`;
    if (symbol) url += `&symbol=${symbol.toUpperCase()}`;
    const res = await this.fetchWithRateLimit(url);
    const list = res && res.result && res.result.list ? res.result.list : [];
    return list.map(t => ({
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice || 0),
      high24h: parseFloat(t.highPrice24h || 0),
      low24h: parseFloat(t.lowPrice24h || 0),
      volume24h: parseFloat(t.volume24h || 0),
      turnover24h: parseFloat(t.turnover24h || 0),
      priceChangePct: parseFloat(t.price24hPcnt ? t.price24hPcnt * 100 : 0)
    }));
  }

  async syncCandles(symbol, timeframe = '5m', targetBuffer = 1000) {
    const sym = symbol.toUpperCase();
    const interval = this.mapTimeframe(timeframe);
    const limit = Math.min(targetBuffer, 1000);
    const url = `${BYBIT_API_BASE}/v5/market/kline?category=linear&symbol=${sym}&interval=${interval}&limit=${limit}`;

    const res = await this.fetchWithRateLimit(url);
    if (!res || !res.result || !res.result.list || !Array.isArray(res.result.list) || res.result.list.length === 0) {
      return [];
    }

    const formatted = res.result.list.map(k => ({
      time: Math.floor(parseInt(k[0], 10) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    })).filter(c => !isNaN(c.time) && !isNaN(c.close));

    formatted.sort((a, b) => a.time - b.time);
    await DB.saveCandles(sym, timeframe, formatted, 'BYBIT');
    return formatted;
  }

  // ── WEBSOCKET STREAM ──
  connectWs() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    const wsUrl = 'wss://stream.bybit.com/v5/public/linear';
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.on('open', () => {
        logger.success('BYBIT_WS', '⚡ Connected to Bybit V5 Linear Ticker Stream.');
        this.startPing();
        this.subscribeActiveSymbols();
      });
      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.topic && msg.topic.startsWith('tickers.') && msg.data) {
            const sym = msg.data.symbol;
            const price = parseFloat(msg.data.lastPrice);
            if (sym && !isNaN(price)) this.livePriceMap[sym] = price;
          }
        } catch (e) {}
      });
      this.ws.on('error', (err) => logger.error('BYBIT_WS', `Bybit WS Error: ${err.message}`));
      this.ws.on('close', () => {
        this.stopPing();
        this.scheduleReconnectWs();
      });
    } catch (e) {
      this.scheduleReconnectWs();
    }
  }

  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, 20000);
  }

  stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  async subscribeSymbols(symbols) {
    if (!symbols || symbols.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const newSyms = symbols.filter(s => !this.subscribedSymbols.has(s.toUpperCase()));
    if (newSyms.length === 0) return;

    for (let i = 0; i < newSyms.length; i += 10) {
      const chunk = newSyms.slice(i, i + 10);
      const args = chunk.map(s => `tickers.${s.toUpperCase()}`);
      this.ws.send(JSON.stringify({ op: 'subscribe', args }));
      chunk.forEach(s => this.subscribedSymbols.add(s.toUpperCase()));
    }
  }

  async subscribeActiveSymbols() {
    try {
      const symbols = await DB.getWhitelistSymbols('BYBIT');
      const symList = symbols.map(s => s.symbol);
      if (symList.length > 0) {
        await this.subscribeSymbols(symList.slice(0, 100));
      }
    } catch (e) {}
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

module.exports = new BybitExchangeAdapter();
