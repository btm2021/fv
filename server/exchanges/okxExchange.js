/**
 * OKX USDT Swap / Perpetual Standardized Exchange Adapter (V5 API)
 */
const BaseExchangeAdapter = require('./baseExchange');
const DB = require('../db');
const { WebSocket } = require('ws');
const logger = require('../logger');

const OKX_API_BASE = 'https://www.okx.com';

class OkxExchangeAdapter extends BaseExchangeAdapter {
  constructor() {
    super({
      id: 'OKX',
      name: 'OKX USDT Perpetual',
      icon: '🔷',
      defaultTargetSymbols: 200,
      takerFeeRate: 0.0005, // 0.05% OKX Taker VIP0
      makerFeeRate: 0.0002, // 0.02% OKX Maker VIP0
      mmrRate: 0.005,       // 0.5% MMR
      minRequestIntervalMs: 150,
      pacingConfig: {
        tasksPerBucket: 200,
        microBatchSize: 10,
        tickIntervalMs: 1500,
        ratePerMin: 400,
        totalBuckets: 5
      }
    });

    this.ws = null;
    this.livePriceMap = {};
    this.subscribedInstIds = new Set();
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.isReconnecting = false;
  }

  /**
   * Helper: Standardize OKX instId (e.g. BTC-USDT-SWAP) to canonical symbol (e.g. BTCUSDT)
   */
  toCanonicalSymbol(instId) {
    if (!instId) return '';
    return instId.replace('-SWAP', '').replace('-', '').toUpperCase();
  }

  /**
   * Helper: Convert canonical symbol (e.g. BTCUSDT) to OKX instId (e.g. BTC-USDT-SWAP)
   */
  toInstId(symbol) {
    const sym = (symbol || '').toUpperCase().replace('-SWAP', '');
    if (sym.includes('-')) return `${sym}-SWAP`;
    if (sym.endsWith('USDT')) {
      const base = sym.substring(0, sym.length - 4);
      return `${base}-USDT-SWAP`;
    }
    return `${sym}-SWAP`;
  }

  mapTimeframe(tf) {
    const map = {
      '1m': '1m',
      '3m': '3m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1H',
      '2h': '2H',
      '4h': '4H',
      '1d': '1D'
    };
    return map[tf] || '5m';
  }

  async getExchangeInfo() {
    const url = `${OKX_API_BASE}/api/v5/public/instruments?instType=SWAP`;
    const res = await this.fetchWithRateLimit(url);
    if (res && res.data && Array.isArray(res.data)) {
      return res.data
        .filter(s => s.state === 'live' && (s.settleCcy === 'USDT' || s.instId.includes('-USDT-SWAP')))
        .map(s => ({
          symbol: this.toCanonicalSymbol(s.instId),
          instId: s.instId,
          baseAsset: s.ctValCcy || s.instId.split('-')[0],
          quoteAsset: 'USDT',
          pricePrecision: s.tickSz ? (s.tickSz.includes('.') ? s.tickSz.split('.')[1].length : 2) : 2,
          quantityPrecision: s.lotSz ? parseFloat(s.lotSz) : 0.01,
          contractVal: parseFloat(s.ctVal || 1),
          raw: s
        }));
    }
    return [];
  }

  async getTickerPrice(symbol = null) {
    let url = `${OKX_API_BASE}/api/v5/market/tickers?instType=SWAP`;
    if (symbol) {
      url = `${OKX_API_BASE}/api/v5/market/ticker?instId=${this.toInstId(symbol)}`;
    }
    const res = await this.fetchWithRateLimit(url);
    const list = res && res.data ? res.data : [];
    return list.map(t => ({
      symbol: this.toCanonicalSymbol(t.instId),
      instId: t.instId,
      lastPrice: parseFloat(t.last || 0),
      high24h: parseFloat(t.high24h || 0),
      low24h: parseFloat(t.low24h || 0),
      volume24h: parseFloat(t.vol24h || 0),
      turnover24h: parseFloat(t.volCcy24h || 0),
      priceChangePct: t.sodUtc0 && parseFloat(t.sodUtc0) > 0 ? ((parseFloat(t.last) - parseFloat(t.sodUtc0)) / parseFloat(t.sodUtc0)) * 100 : 0
    }));
  }

  async syncCandles(symbol, timeframe = '5m', targetBuffer = 1000) {
    const sym = symbol.toUpperCase();
    const instId = this.toInstId(sym);
    const bar = this.mapTimeframe(timeframe);
    const limit = Math.min(targetBuffer, 300); // OKX limits to 300 per call
    const url = `${OKX_API_BASE}/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;

    const res = await this.fetchWithRateLimit(url);
    if (!res || !res.data || !Array.isArray(res.data) || res.data.length === 0) {
      return [];
    }

    // OKX format: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
    const formatted = res.data.map(k => ({
      time: Math.floor(parseInt(k[0], 10) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    })).filter(c => !isNaN(c.time) && !isNaN(c.close));

    formatted.sort((a, b) => a.time - b.time);
    await DB.saveCandles(sym, timeframe, formatted, 'OKX');
    return formatted;
  }

  // ── WEBSOCKET STREAM ──
  connectWs() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    const wsUrl = 'wss://ws.okx.com:8443/ws/v5/public';
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.on('open', () => {
        logger.success('OKX_WS', '⚡ Connected to OKX V5 Public WebSocket Stream.');
        this.startPing();
        this.subscribeActiveSymbols();
      });
      this.ws.on('message', (data) => {
        try {
          const str = data.toString();
          if (str === 'pong') return;
          const msg = JSON.parse(str);
          if (msg.arg && msg.arg.channel === 'tickers' && msg.data && Array.isArray(msg.data)) {
            for (const t of msg.data) {
              const canonical = this.toCanonicalSymbol(t.instId);
              const price = parseFloat(t.last);
              if (canonical && !isNaN(price)) {
                this.livePriceMap[canonical] = price;
              }
            }
          }
        } catch (e) {}
      });
      this.ws.on('error', (err) => logger.error('OKX_WS', `OKX WS Error: ${err.message}`));
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
        this.ws.send('ping');
      }
    }, 20000);
  }

  stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  async subscribeSymbols(symbols) {
    if (!symbols || symbols.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const newInsts = symbols.map(s => this.toInstId(s)).filter(inst => !this.subscribedInstIds.has(inst));
    if (newInsts.length === 0) return;

    for (let i = 0; i < newInsts.length; i += 10) {
      const chunk = newInsts.slice(i, i + 10);
      const args = chunk.map(instId => ({ channel: 'tickers', instId }));
      this.ws.send(JSON.stringify({ op: 'subscribe', args }));
      chunk.forEach(inst => this.subscribedInstIds.add(inst));
    }
  }

  async subscribeActiveSymbols() {
    try {
      const symbols = await DB.getWhitelistSymbols('OKX');
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

module.exports = new OkxExchangeAdapter();
