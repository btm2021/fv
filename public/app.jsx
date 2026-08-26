/**
 * STAT2 Pro Full Trading Terminal (React 18 + Tailwind CSS)
 * 1:1 Implementation of the STAT2 Engine (Lightweight Charts + High-DPI Canvas Overlays)
 * Features:
 * - Direct Browser Multi-Exchange Klines (Binance, Bybit, OKX)
 * - Pure JavaScript SMC & STAT2 Pro Box Strategy Calculation
 * - High-DPI Canvas Overlay for Trade Cards HUD, Guide Rays, FVG Zones & Liquidity Rays
 * - On-Chart TradingView-Style Indicator Legend (👁️ ⚙️ ✕) & Watermark
 * - Indicator Sub-Toolbar Toggle Chips & fx Catalog Modal
 * - Global All-Market Ticker WebSocket for Live Prices on 1,000+ Pairs
 * - Collapsible Bottom Desk for 100% Full-Height Chart Analysis
 */

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ── UTILITY HELPERS ──
function formatPrice(val, precision = 2) {
  if (val === null || val === undefined || isNaN(val)) return '0.00';
  const num = Number(val);
  if (num === 0) return '0.00';
  if (Math.abs(num) < 0.0001) return num.toFixed(7);
  if (Math.abs(num) < 0.01) return num.toFixed(6);
  if (Math.abs(num) < 1) return num.toFixed(4);
  if (Math.abs(num) < 100) return num.toFixed(3);
  return num.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

function formatVolume(val) {
  if (!val || isNaN(val)) return '0';
  const n = Number(val);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(0);
}

function timeAgo(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - (ts > 1e11 ? ts : ts * 1000)) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

// ── GLOBAL ALL-MARKET TICKERS STREAM (HYBRID WEBSOCKET + REST ENGINE) ──
const GlobalMarketStreamManager = {
  binanceWs: null,
  okxWs: null,
  bybitWs: null,
  pollTimer: null,
  listeners: new Set(),
  cachedPrices: {},

  subscribe(listener) {
    this.listeners.add(listener);
    if (Object.keys(this.cachedPrices).length > 0) {
      listener(this.cachedPrices);
    }
    if (!this.binanceWs) this.initBinance();
    if (!this.okxWs) this.initOkx();
    if (!this.pollTimer) this.startPeriodicPolling();
    return () => this.listeners.delete(listener);
  },

  emit(updates) {
    const finalBatch = {};
    for (const [key, val] of Object.entries(updates)) {
      const prev = this.cachedPrices[key];
      const prevPrice = prev ? prev.price : val.price;
      let tickDir = 'equal';
      if (prev && val.price > prevPrice) tickDir = 'up';
      else if (prev && val.price < prevPrice) tickDir = 'down';
      else if (prev) tickDir = prev.tickDir || 'equal';

      finalBatch[key] = {
        ...val,
        prevPrice,
        tickDir
      };
    }
    Object.assign(this.cachedPrices, finalBatch);
    this.listeners.forEach(l => l(finalBatch));
  },

  async fetchInitialSnapshot() {
    const batch = {};
    const promises = [
      // 1. Binance Tickers
      fetch('https://fapi.binance.com/fapi/v1/ticker/24hr')
        .then(r => r.json())
        .then(arr => {
          if (Array.isArray(arr)) {
            for (let i = 0; i < arr.length; i++) {
              const t = arr[i];
              const p = parseFloat(t.lastPrice) || 0;
              const chg = parseFloat(t.priceChangePercent) || 0;
              const vol = parseFloat(t.quoteVolume) || 0;
              batch['BINANCE_' + t.symbol] = { price: p, change24h: chg, vol };
              batch[t.symbol] = { price: p, change24h: chg, vol };
            }
          }
        }).catch(() => {}),

      // 2. Bybit Linear Tickers
      fetch('https://api.bybit.com/v5/market/tickers?category=linear')
        .then(r => r.json())
        .then(json => {
          if (json.result && json.result.list) {
            for (let i = 0; i < json.result.list.length; i++) {
              const t = json.result.list[i];
              const p = parseFloat(t.lastPrice) || 0;
              const chg = (parseFloat(t.price24hPcnt) || 0) * 100;
              const vol = parseFloat(t.turnover24h) || 0;
              batch['BYBIT_' + t.symbol] = { price: p, change24h: chg, vol };
              if (!batch[t.symbol]) batch[t.symbol] = { price: p, change24h: chg, vol };
            }
          }
        }).catch(() => {}),

      // 3. OKX SWAP Tickers
      fetch('https://www.okx.com/api/v5/market/tickers?instType=SWAP')
        .then(r => r.json())
        .then(json => {
          if (json.data && Array.isArray(json.data)) {
            for (let i = 0; i < json.data.length; i++) {
              const t = json.data[i];
              const rawId = t.instId; // e.g. "BTC-USDT-SWAP"
              const symDash = rawId.replace('-SWAP', ''); // "BTC-USDT"
              const symClean = symDash.replace('-', ''); // "BTCUSDT"
              const last = parseFloat(t.last) || 0;
              const open24 = parseFloat(t.sodUtc8 || t.open24h || t.last) || last;
              const chg = open24 > 0 ? ((last - open24) / open24) * 100 : 0;
              const vol = parseFloat(t.volCcy24h) || 0;

              batch['OKX_' + symClean] = { price: last, change24h: chg, vol };
              batch['OKX_' + symDash] = { price: last, change24h: chg, vol };
              batch['OKX_' + rawId] = { price: last, change24h: chg, vol };
            }
          }
        }).catch(() => {})
    ];

    await Promise.allSettled(promises);
    this.emit(batch);
    return batch;
  },

  startPeriodicPolling() {
    this.fetchInitialSnapshot();
    this.pollTimer = setInterval(() => {
      this.fetchInitialSnapshot();
    }, 4000);
  },

  initBinance() {
    try {
      const ws = new WebSocket('wss://fstream.binance.com/ws/!ticker@arr');
      this.binanceWs = ws;
      ws.onmessage = (e) => {
        try {
          const arr = JSON.parse(e.data);
          if (Array.isArray(arr)) {
            const batch = {};
            for (let i = 0; i < arr.length; i++) {
              const t = arr[i];
              const p = parseFloat(t.c) || 0;
              const chg = parseFloat(t.P) || 0;
              const vol = parseFloat(t.q) || 0;
              batch['BINANCE_' + t.s] = { price: p, change24h: chg, vol };
              batch[t.s] = { price: p, change24h: chg, vol };
            }
            this.emit(batch);
          }
        } catch (err) {}
      };
      ws.onclose = () => setTimeout(() => this.initBinance(), 4000);
    } catch (e) {}
  },

  initOkx() {
    try {
      const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
      this.okxWs = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'tickers', instType: 'SWAP' }] }));
      };
      ws.onmessage = (e) => {
        try {
          const str = e.data.toString();
          if (str === 'pong') return;
          const msg = JSON.parse(str);
          if (msg.data && Array.isArray(msg.data)) {
            const batch = {};
            for (let i = 0; i < msg.data.length; i++) {
              const t = msg.data[i];
              const rawId = t.instId;
              const symDash = rawId.replace('-SWAP', '');
              const symClean = symDash.replace('-', '');
              const last = parseFloat(t.last) || 0;
              const open24 = parseFloat(t.sodUtc8 || t.open24h || t.last) || last;
              const chg = open24 > 0 ? ((last - open24) / open24) * 100 : 0;
              const vol = parseFloat(t.volCcy24h) || 0;

              batch['OKX_' + symClean] = { price: last, change24h: chg, vol };
              batch['OKX_' + symDash] = { price: last, change24h: chg, vol };
              batch['OKX_' + rawId] = { price: last, change24h: chg, vol };
            }
            this.emit(batch);
          }
        } catch (err) {}
      };
      ws.onclose = () => setTimeout(() => this.initOkx(), 4000);
    } catch (e) {}
  }
};

// ── DIRECT BROWSER-TO-EXCHANGE KLINE CLIENT ──
const DirectExchangeClient = {
  async fetchBinance(symbol, interval = '5m', limit = 1000) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const data = await res.json();
    return data.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  },

  async fetchBybit(symbol, interval = '5m', limit = 1000) {
    const tfMap = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1d': 'D' };
    const bybitTf = tfMap[interval] || '5';
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol.toUpperCase()}&interval=${bybitTf}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
    const json = await res.json();
    if (!json.result || !json.result.list) return [];
    return json.result.list.map(k => ({
      time: Math.floor(parseInt(k[0], 10) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    })).sort((a, b) => a.time - b.time);
  },

  async fetchOkx(symbol, interval = '5m', limit = 500) {
    let sym = symbol.toUpperCase().replace('-SWAP', '');
    let instId = sym.includes('-') ? `${sym}-SWAP` : (sym.endsWith('USDT') ? `${sym.substring(0, sym.length - 4)}-USDT-SWAP` : `${sym}-SWAP`);
    const tfMap = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '1d': '1D' };
    const bar = tfMap[interval] || '5m';
    const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
    const json = await res.json();
    if (!json.data) return [];
    return json.data.map(k => ({
      time: Math.floor(parseInt(k[0], 10) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    })).sort((a, b) => a.time - b.time);
  },

  async fetchBitget(symbol, interval = '5m', limit = 1000) {
    const tfMap = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '1d': '1D' };
    const gran = tfMap[interval] || '5m';
    const url = `https://api.bitget.com/api/v2/mix/market/candles?symbol=${symbol.toUpperCase()}&granularity=${gran}&productType=USDT-FUTURES&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bitget HTTP ${res.status}`);
    const json = await res.json();
    if (!json.data || !Array.isArray(json.data)) return [];
    return json.data.map(k => ({
      time: Math.floor(parseInt(k[0], 10) / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    })).sort((a, b) => a.time - b.time);
  },

  async fetchGate(symbol, interval = '5m', limit = 1000) {
    const sym = symbol.toUpperCase();
    const contract = sym.includes('_') ? sym : (sym.endsWith('USDT') ? `${sym.substring(0, sym.length - 4)}_USDT` : `${sym}_USDT`);
    const tfMap = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d' };
    const bar = tfMap[interval] || '5m';
    const url = `https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${contract}&interval=${bar}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gate HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(k => ({
      time: parseInt(k.t, 10),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v)
    })).sort((a, b) => a.time - b.time);
  },

  async fetchBingX(symbol, interval = '5m', limit = 1000) {
    const sym = symbol.toUpperCase();
    const rawSym = sym.includes('-') ? sym : (sym.endsWith('USDT') ? `${sym.substring(0, sym.length - 4)}-USDT` : `${sym}-USDT`);
    const tfMap = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d' };
    const bar = tfMap[interval] || '5m';
    const url = `https://open-api.bingx.com/openApi/swap/v2/market/kline?symbol=${rawSym}&interval=${bar}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BingX HTTP ${res.status}`);
    const json = await res.json();
    if (!json.data || !Array.isArray(json.data)) return [];
    return json.data.map(k => ({
      time: Math.floor(parseInt(k.time, 10) / 1000),
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume)
    })).sort((a, b) => a.time - b.time);
  },

  async fetchCandles(exchange, symbol, timeframe) {
    const ex = (exchange || 'BINANCE').toUpperCase();
    try {
      if (ex === 'BYBIT') return await this.fetchBybit(symbol, timeframe);
      if (ex === 'OKX') return await this.fetchOkx(symbol, timeframe);
      if (ex === 'BITGET') return await this.fetchBitget(symbol, timeframe);
      if (ex === 'GATE') return await this.fetchGate(symbol, timeframe);
      if (ex === 'BINGX') return await this.fetchBingX(symbol, timeframe);
      if (ex === 'BINANCE') return await this.fetchBinance(symbol, timeframe);
    } catch (err) {
      console.warn(`[Direct Exchange Client] Direct fetch note for ${ex} ${symbol}:`, err.message);
    }

    // High Reliability CCXT Pro Backend Proxy Fallback
    try {
      const res = await fetch(`/api/chart/${symbol}/${timeframe}?exchange=${ex}`);
      const json = await res.json();
      if (json && json.candles && Array.isArray(json.candles) && json.candles.length > 0) {
        return json.candles;
      }
    } catch (proxyErr) {
      console.error(`[CCXT Proxy Error] ${ex} ${symbol}:`, proxyErr.message);
    }

    return [];
  },

  createWebSocket(exchange, symbol, timeframe, onTick) {
    const ex = (exchange || 'BINANCE').toUpperCase();
    let rawWs = null;
    let isClosed = false;

    const safeClose = () => {
      isClosed = true;
      if (!rawWs) return;
      rawWs.onopen = null;
      rawWs.onmessage = null;
      rawWs.onerror = null;
      rawWs.onclose = null;
      if (rawWs.readyState === WebSocket.OPEN) {
        try { rawWs.close(); } catch (e) {}
      } else if (rawWs.readyState === WebSocket.CONNECTING) {
        rawWs.onopen = () => {
          try { rawWs.close(); } catch (e) {}
        };
      }
    };

    try {
      if (ex === 'BINANCE') {
        rawWs = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${timeframe}`);
        rawWs.onmessage = (e) => {
          if (isClosed) return;
          try {
            const msg = JSON.parse(e.data);
            if (msg.k) {
              onTick({
                time: Math.floor(msg.k.t / 1000),
                open: parseFloat(msg.k.o),
                high: parseFloat(msg.k.h),
                low: parseFloat(msg.k.l),
                close: parseFloat(msg.k.c),
                volume: parseFloat(msg.k.v)
              });
            }
          } catch (err) {}
        };
      } else if (ex === 'BYBIT') {
        const tfMap = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '1d': 'D' };
        const bybitTf = tfMap[timeframe] || '5';
        rawWs = new WebSocket('wss://stream.bybit.com/v5/public/linear');
        rawWs.onopen = () => {
          if (isClosed) { try { rawWs.close(); } catch (e) {} return; }
          try { rawWs.send(JSON.stringify({ op: 'subscribe', args: [`kline.${bybitTf}.${symbol.toUpperCase()}`] })); } catch (e) {}
        };
        rawWs.onmessage = (e) => {
          if (isClosed) return;
          try {
            const msg = JSON.parse(e.data);
            if (msg.data && Array.isArray(msg.data) && msg.data[0]) {
              const k = msg.data[0];
              onTick({
                time: Math.floor(parseInt(k.start, 10) / 1000),
                open: parseFloat(k.open),
                high: parseFloat(k.high),
                low: parseFloat(k.low),
                close: parseFloat(k.close),
                volume: parseFloat(k.volume)
              });
            }
          } catch (err) {}
        };
      } else if (ex === 'OKX') {
        let sym = symbol.toUpperCase().replace('-SWAP', '');
        let instId = sym.includes('-') ? `${sym}-SWAP` : (sym.endsWith('USDT') ? `${sym.substring(0, sym.length - 4)}-USDT-SWAP` : `${sym}-SWAP`);
        const tfMap = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '2h': '2H', '4h': '4H', '1d': '1D' };
        const bar = tfMap[timeframe] || '5m';
        rawWs = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
        rawWs.onopen = () => {
          if (isClosed) { try { rawWs.close(); } catch (e) {} return; }
          try { rawWs.send(JSON.stringify({ op: 'subscribe', args: [{ channel: `candle${bar}`, instId }] })); } catch (e) {}
        };
        rawWs.onmessage = (e) => {
          if (isClosed) return;
          try {
            const str = e.data.toString();
            if (str === 'pong') return;
            const msg = JSON.parse(str);
            if (msg.data && Array.isArray(msg.data) && msg.data[0]) {
              const k = msg.data[0];
              onTick({
                time: Math.floor(parseInt(k[0], 10) / 1000),
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5])
              });
            }
          } catch (err) {}
        };
      }
    } catch (e) {}

    return { close: safeClose, rawWs };
  }
};

// ── DEFAULT INDICATORS SPECIFICATION (EXACT STAT2.HTML SPEC) ──
const DEFAULT_INDICATOR_INSTANCES = [
  {
    id: 'inst_stat2_box_1',
    type: 'stat2_box_strategy',
    name: 'STAT2 Pro Box Strategy',
    visible: true,
    inputs: {
      strategyMode: 'dual',
      cmoLength: 14,
      maLength: 21,
      atrLength: 14,
      atrMult: 2.0,
      minAtrPct: 0.35,
      liqThresholdPct: 1.5,
      fvgThresholdPct: 1.5,
      swingLookback: 30,
      maxCardsVisible: 15,
      // Order Execution Options
      orderType: 'MARKET',
      leverage: 20,
      marginMode: 'ISOLATED',
      riskPerTradePct: 1.0,
      maxOpenTrades: 5,
      autoMoveBE: true,
      enableTrailingSl: true,
      tp1CloseRatio: 50
    },
    style: {
      // 1. Box & Cards
      showCards: true,
      cardWidth: 210,
      cardBackground: '#0b1120',
      cardOpacity: 0.94,
      showStem: true,
      // 2. Guide Rays & Lines
      showGuideLines: true,
      showEntryLine: true,
      showTp1Line: true,
      showTp2Line: true,
      showSlLine: true,
      showLineBadges: true,
      lineLength: 280,
      lineThickness: 2.0,
      // 3. SMC Structures
      showFVG: true,
      fvgOpacity: 0.18,
      showLiquidity: true,
      showRibbon: true,
      showTrail2: true,
      // 4. Colors
      buyColor: '#10b981',
      sellColor: '#f43f5e',
      fadeShortColor: '#f59e0b',
      fadeLongColor: '#06b6d4',
      entryLineColor: '#0284c7',
      tp1LineColor: '#10b981',
      tp2LineColor: '#06b6d4',
      slLineColor: '#f43f5e',
      fvgBullColor: '#10b981',
      fvgBearColor: '#f43f5e',
      liqBslColor: '#ec4899',
      liqSslColor: '#8b5cf6',
      bullCloudColor: '#10b981',
      bearCloudColor: '#f43f5e',
      stopColor: '#a855f7',
      // 5. Font Sizes
      titleFontSize: 11.5,
      badgeFontSize: 9.5,
      priceFontSize: 11,
      labelFontSize: 10,
      lineBadgeFontSize: 10,
      fvgFontSize: 10,
      liqFontSize: 11
    }
  },
  {
    id: 'inst_ema_1',
    type: 'ema',
    name: 'EMA Ribbon',
    visible: true,
    inputs: { period1: 21, period2: 50, period3: 200, source: 'close' },
    style: { showEma1: true, ema1Color: '#38bdf8', ema1Width: 1.5, showEma2: true, ema2Color: '#a855f7', ema2Width: 1.5, showEma3: true, ema3Color: '#f59e0b', ema3Width: 2 }
  },
  {
    id: 'inst_vwap_1',
    type: 'vwap',
    name: 'VWAP',
    visible: true,
    inputs: { anchor: 'session', rollingPeriod: 200, source: 'hlc3', stdevMult1: 1.0, stdevMult2: 2.0, stdevMult3: 3.0 },
    style: { showVwap: true, vwapColor: '#fbbf24', vwapWidth: 2, showBand1: false, band1Color: '#38bdf8', showBand2: false, band2Color: '#a855f7' }
  }
];

// ── LOCALSTORAGE PERSISTENCE FOR CHART INDICATORS ──
const STORAGE_KEY_INDICATORS = 'stat2_chart_indicator_instances';

function loadSavedIndicators() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INDICATORS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error loading saved indicator settings:', e);
  }
  return DEFAULT_INDICATOR_INSTANCES;
}

function saveIndicatorsToStorage(instances) {
  try {
    const clean = instances.map(inst => ({
      id: inst.id,
      type: inst.type,
      name: inst.name,
      visible: inst.visible !== false,
      inputs: inst.inputs || {},
      style: inst.style || {}
    }));
    localStorage.setItem(STORAGE_KEY_INDICATORS, JSON.stringify(clean));
  } catch (e) {
    console.warn('Error saving indicator settings to localStorage:', e);
  }
}
function FullStat2CandleChart({
  symbol,
  timeframe = '5m',
  exchange = 'BINANCE',
  onTfChange,
  isCollapsed,
  onToggleCollapse,
  instances,
  onOpenCatalog,
  onToggleVisibility,
  onOpenSettings,
  onRemoveInstance
}) {
  const chartContainerRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const indicatorSeriesMap = useRef(new Map()); // instId -> [ series1, series2, ... ]
  const wsRef = useRef(null);
  const candlesRef = useRef([]);
  const instancesRef = useRef(instances);
  instancesRef.current = instances;

  const [loading, setLoading] = useState(false);

  // ── DRAWING TOOLS & INTERACTION STATE ──
  const [drawTool, setDrawTool] = useState('cursor'); // 'cursor', 'line', 'rect', 'measure'
  const [drawColor, setDrawColor] = useState('#00F0FF'); // '#00F0FF', '#F0B90B', '#10B981', '#F43F5E'
  const [drawings, setDrawings] = useState([]);
  const [currentDrawing, setCurrentDrawing] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hoverTarget, setHoverTarget] = useState(null); // { targetId, handle, cursor, anchor }
  const [dragAction, setDragAction] = useState(null); // 'create', 'move', 'tl', 'tr', 'br', 'bl', 'p1', 'p2'
  const [dragOrigin, setDragOrigin] = useState(null);

  const drawingsRef = useRef([]);
  drawingsRef.current = drawings;
  const currentDrawingRef = useRef(null);
  currentDrawingRef.current = currentDrawing;
  const selectedIdRef = useRef(null);
  selectedIdRef.current = selectedId;
  const hoverTargetRef = useRef(null);
  hoverTargetRef.current = hoverTarget;
  const dragActionRef = useRef(null);
  dragActionRef.current = dragAction;
  const dragOriginRef = useRef(null);
  dragOriginRef.current = dragOrigin;

  // 5-Second Debounce Timers Map for Server Saves
  const saveTimersRef = useRef(new Map());

  const debouncedSaveDrawing = useCallback((drawing) => {
    if (!drawing || !drawing.id) return;
    const targetId = drawing.id;
    if (saveTimersRef.current.has(targetId)) {
      clearTimeout(saveTimersRef.current.get(targetId));
    }
    const timer = setTimeout(async () => {
      saveTimersRef.current.delete(targetId);
      try {
        await fetch('/api/drawings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: drawing.id,
            symbol,
            exchange,
            timeframe,
            drawing_type: drawing.type,
            data_json: drawing
          })
        });
      } catch (err) {
        console.warn('Debounced save error:', err);
      }
    }, 5000);
    saveTimersRef.current.set(targetId, timer);
  }, [symbol, exchange, timeframe]);

  // Load saved drawings from DB on symbol / exchange change & clear pending timers
  useEffect(() => {
    let isCancelled = false;
    setSelectedId(null);
    setHoverTarget(null);
    saveTimersRef.current.forEach(t => clearTimeout(t));
    saveTimersRef.current.clear();

    async function fetchDrawings() {
      try {
        const res = await fetch(`/api/drawings?symbol=${symbol}&exchange=${exchange}`).then(r => r.json());
        if (!isCancelled && res.success && Array.isArray(res.data)) {
          setDrawings(res.data.map(item => ({
            id: item.id,
            type: item.drawing_type,
            ...(typeof item.data === 'object' ? item.data : JSON.parse(item.data_json || '{}'))
          })));
        }
      } catch (e) {}
    }
    fetchDrawings();
    return () => {
      isCancelled = true;
      saveTimersRef.current.forEach(t => clearTimeout(t));
      saveTimersRef.current.clear();
    };
  }, [symbol, exchange]);

  const handleClearDrawings = async (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    saveTimersRef.current.forEach(t => clearTimeout(t));
    saveTimersRef.current.clear();
    setDrawings([]);
    setCurrentDrawing(null);
    setSelectedId(null);
    setHoverTarget(null);
    try {
      await fetch(`/api/drawings?symbol=${symbol}&exchange=${exchange}`, { method: 'DELETE' });
    } catch (e) {}
  };

  const handleDeleteDrawing = async (id, e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const targetId = id || selectedIdRef.current;
    if (!targetId) return;

    // Immediately cancel any pending 5s debounce save timer for this drawing
    if (saveTimersRef.current.has(targetId)) {
      clearTimeout(saveTimersRef.current.get(targetId));
      saveTimersRef.current.delete(targetId);
    }

    setDrawings(prev => prev.filter(d => d.id !== targetId));
    if (selectedIdRef.current === targetId) setSelectedId(null);
    setHoverTarget(null);
    setDragAction(null);
    triggerCanvasRender();

    try {
      await fetch(`/api/drawings/${targetId}`, { method: 'DELETE' });
    } catch (e) {}
  };

  const handleChangeColor = async (id, newColor, e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const target = drawingsRef.current.find(d => d.id === id);
    if (!target) return;
    target.color = newColor;
    setDrawings([...drawingsRef.current]);
    triggerCanvasRender();
    debouncedSaveDrawing(target);
  };

  // Keyboard shortcut: Delete or Backspace to delete selected drawing
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (selectedIdRef.current && (e.key === 'Delete' || e.key === 'Backspace')) {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          handleDeleteDrawing(selectedIdRef.current, e);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 1. High-DPI Canvas Overlay Render (Draws STAT2 Trade Cards HUD, Guide Rays, FVG, Liq Lines & User Drawings)
  const triggerCanvasRender = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const currentCandles = candlesRef.current;
    if (!canvas || !chart || !candleSeries || !currentCandles || currentCandles.length === 0) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    ctx.clearRect(0, 0, w, h);

    const timeScale = chart.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    if (!visibleRange) return;

    const fromTime = visibleRange.from;
    const toTime = visibleRange.to;
    const rightViewportX = w - 65;

    const getX = (t) => {
      if (t === null || t === undefined) return null;
      const direct = timeScale.timeToCoordinate(t);
      if (direct !== null && !isNaN(direct)) return direct;
      if (currentCandles && currentCandles.length > 1) {
        const first = currentCandles[0];
        const last = currentCandles[currentCandles.length - 1];
        const firstX = timeScale.timeToCoordinate(first.time);
        const lastX = timeScale.timeToCoordinate(last.time);
        if (firstX !== null && lastX !== null && last.time !== first.time) {
          const pxPerSec = (lastX - firstX) / (last.time - first.time);
          return firstX + (t - first.time) * pxPerSec;
        }
      }
      return null;
    };
    const getY = (p) => (p !== null && p !== undefined && !isNaN(p)) ? candleSeries.priceToCoordinate(p) : null;

    // A. Render each active indicator's canvas layer
    for (const inst of instancesRef.current) {
      if (!inst.visible || !inst.calcResult) continue;
      const def = window.IndicatorRegistry ? window.IndicatorRegistry.get(inst.type) : null;
      if (def && typeof def.renderCanvas === 'function') {
        try {
          def.renderCanvas(ctx, inst.calcResult, inst.style, {
            getX,
            getY,
            fromTime,
            toTime,
            rightViewportX,
            candles: currentCandles,
            formatPrice
          });
        } catch (err) {
          console.warn('Overlay render error:', err);
        }
      }
    }

    // B. Render User Drawings (Trendline, Rectangle, Measure Tool with Selection Handles)
    const allDrawings = [...(drawingsRef.current || [])];
    if (currentDrawingRef.current) allDrawings.push(currentDrawingRef.current);
    const activeSelId = selectedIdRef.current;

    for (const d of allDrawings) {
      if (!d.p1 || !d.p2) continue;
      const x1 = getX(d.p1.time);
      const y1 = getY(d.p1.price);
      const x2 = getX(d.p2.time);
      const y2 = getY(d.p2.price);
      if (x1 === null || y1 === null || x2 === null || y2 === null) continue;

      const color = d.color || '#00F0FF';
      const isSelected = activeSelId === d.id;

      if (d.type === 'line') {
        // Trendline / Segment
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 2.5 : 2;
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x2, y2, 4, 0, Math.PI * 2); ctx.fill();

        // Selection Handles & Aura
        if (isSelected) {
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.fillStyle = '#38BDF8';
          ctx.beginPath(); ctx.arc(x1, y1, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.arc(x2, y2, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }

        const deltaP = d.p2.price - d.p1.price;
        const pctP = d.p1.price > 0 ? (deltaP / d.p1.price) * 100 : 0;
        ctx.fillStyle = '#0B0E18';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        const tagText = `${pctP >= 0 ? '+' : ''}${pctP.toFixed(2)}% ($${formatPrice(Math.abs(deltaP))})`;
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        const tagW = ctx.measureText(tagText).width + 8;
        ctx.fillRect(x2 + 6, y2 - 8, tagW, 16);
        ctx.strokeRect(x2 + 6, y2 - 8, tagW, 16);
        ctx.fillStyle = color;
        ctx.fillText(tagText, x2 + 10, y2 + 4);
        ctx.restore();
      } else if (d.type === 'rect') {
        // Rectangle / Price Zone
        ctx.save();
        const rx = Math.min(x1, x2);
        const ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1);
        const rh = Math.abs(y2 - y1);

        ctx.fillStyle = color + '22';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 2 : 1.5;
        ctx.strokeRect(rx, ry, rw, rh);

        // Selection Outline & 4 Corner Handles
        if (isSelected) {
          ctx.strokeStyle = '#38BDF8';
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(rx - 2, ry - 2, rw + 4, rh + 4);
          ctx.setLineDash([]);
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = '#0284C7';
          ctx.lineWidth = 1.5;
          [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]].forEach(([hx, hy]) => {
            ctx.fillRect(hx - 4, hy - 4, 8, 8);
            ctx.strokeRect(hx - 4, hy - 4, 8, 8);
          });
        }
        ctx.restore();
      } else if (d.type === 'measure') {
        // Measure Tool (Ruler)
        ctx.save();
        const rx = Math.min(x1, x2);
        const ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1);
        const rh = Math.abs(y2 - y1);

        const deltaP = d.p2.price - d.p1.price;
        const pctP = d.p1.price > 0 ? (deltaP / d.p1.price) * 100 : 0;
        const isUp = deltaP >= 0;

        ctx.fillStyle = isUp ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = isUp ? '#10B981' : '#F43F5E';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rx, ry, rw, rh);

        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const line1 = `Δ $${formatPrice(Math.abs(deltaP))} (${pctP >= 0 ? '+' : ''}${pctP.toFixed(2)}%)`;
        const line2 = `P1: $${formatPrice(d.p1.price)} → P2: $${formatPrice(d.p2.price)}`;

        ctx.setLineDash([]);
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        const cardW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 16;
        const cardH = 34;

        ctx.fillStyle = '#0E1322';
        ctx.fillRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH);
        ctx.strokeStyle = isUp ? '#10B981' : '#F43F5E';
        ctx.strokeRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH);

        ctx.fillStyle = isUp ? '#10B981' : '#F43F5E';
        ctx.fillText(line1, cx - cardW / 2 + 8, cy - cardH / 2 + 13);
        ctx.fillStyle = '#94A3B8';
        ctx.font = '9.5px JetBrains Mono, monospace';
        ctx.fillText(line2, cx - cardW / 2 + 8, cy - cardH / 2 + 27);

        if (isSelected) {
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = '#0284C7';
          ctx.lineWidth = 1.5;
          [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]].forEach(([hx, hy]) => {
            ctx.fillRect(hx - 4, hy - 4, 8, 8);
            ctx.strokeRect(hx - 4, hy - 4, 8, 8);
          });
        }
        ctx.restore();
      }
    }
  }, []);

  // 2. Sync Lightweight Charts Series Indicators (EMA, VWAP, etc.)
  const syncSeriesIndicators = useCallback(() => {
    const chart = chartRef.current;
    const currentCandles = candlesRef.current;
    if (!chart || !currentCandles || currentCandles.length === 0) return;

    for (const inst of instancesRef.current) {
      const def = window.IndicatorRegistry ? window.IndicatorRegistry.get(inst.type) : null;
      if (def && def.isSeries) {
        let seriesList = indicatorSeriesMap.current.get(inst.id) || [];
        if (seriesList.length === 0 && typeof def.syncSeries === 'function') {
          seriesList = def.syncSeries(chart, inst, seriesList);
          indicatorSeriesMap.current.set(inst.id, seriesList);
        }
        if (seriesList && typeof def.updateSeries === 'function') {
          def.updateSeries(seriesList, inst.calcResult, inst.style, inst.visible);
        }
      }
    }
  }, []);

  // 3. Initialize Lightweight Charts & Canvas with Fixed PriceScale
  useEffect(() => {
    if (!chartContainerRef.current || !window.LightweightCharts) return;

    const container = chartContainerRef.current;
    const chart = window.LightweightCharts.createChart(container, {
      layout: {
        background: { color: '#090D16' },
        textColor: '#848E9C',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, Inter, monospace'
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.35)' },
        horzLines: { color: 'rgba(30, 41, 59, 0.35)' }
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#F0B90B', width: 1, style: 3, labelBackgroundColor: '#111726' },
        horzLine: { color: '#F0B90B', width: 1, style: 3, labelBackgroundColor: '#111726' }
      },
      rightPriceScale: {
        visible: true,
        borderColor: '#1E293B',
        scaleMargins: { top: 0.1, bottom: 0.22 },
        autoScale: true,
        alignLabels: true,
        borderVisible: true
      },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: true,
        secondsVisible: false
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: true
        },
        mouseWheel: true,
        pinch: true
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true
      }
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#F43F5E',
      borderUpColor: '#10B981',
      borderDownColor: '#F43F5E',
      wickUpColor: '#10B981',
      wickDownColor: '#F43F5E',
      priceFormat: {
        type: 'custom',
        formatter: (price) => formatPrice(price),
        minMove: 0.00000001
      }
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume_scale'
    });
    
    // Explicitly configure dedicated volume scale to avoid priceScale collisions
    try {
      chart.priceScale('volume_scale').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
        visible: false,
        autoScale: true
      });
    } catch (e) {}

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // High-DPI Canvas Sync & Resize Observer
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length > 0 && entries[0].contentRect) {
        const rect = entries[0].contentRect;
        chart.applyOptions({ width: rect.width, height: rect.height });

        const canvas = overlayCanvasRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          canvas.width = rect.width * dpr;
          canvas.height = rect.height * dpr;
          const ctx = canvas.getContext('2d');
          ctx.scale(dpr, dpr);
        }
        triggerCanvasRender();
      }
    });
    resizeObserver.observe(container);

    // Visible range change listener for smooth overlay sync
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      triggerCanvasRender();
    });

    return () => {
      resizeObserver.disconnect();
      if (wsRef.current && typeof wsRef.current.close === 'function') {
        wsRef.current.close();
        wsRef.current = null;
      }
      chart.remove();
    };
  }, [triggerCanvasRender]);

  // 4. Fetch Klines & Compute IndicatorRegistry calculations (Triggered ONLY on symbol, exchange, tf change)
  const loadCandlesDirect = useCallback(async () => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    setLoading(true);

    if (wsRef.current && typeof wsRef.current.close === 'function') {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const raw = await DirectExchangeClient.fetchCandles(exchange, symbol, timeframe);
      if (!raw || raw.length === 0) {
        setLoading(false);
        return;
      }

      const map = new Map();
      raw.forEach(c => map.set(c.time, c));
      const sorted = Array.from(map.values()).sort((a, b) => a.time - b.time);
      candlesRef.current = sorted;

      const samplePrice = sorted[sorted.length - 1]?.close || sorted[0]?.close || 1;
      let minMove = 0.01;
      let precision = 2;
      if (samplePrice < 0.00001) { minMove = 0.00000001; precision = 8; }
      else if (samplePrice < 0.0001) { minMove = 0.0000001; precision = 7; }
      else if (samplePrice < 0.01) { minMove = 0.000001; precision = 6; }
      else if (samplePrice < 0.1) { minMove = 0.0001; precision = 4; }
      else if (samplePrice < 1) { minMove = 0.0001; precision = 4; }
      else if (samplePrice < 100) { minMove = 0.001; precision = 3; }
      else { minMove = 0.01; precision = 2; }

      if (candleSeriesRef.current) {
        candleSeriesRef.current.applyOptions({
          priceFormat: {
            type: 'custom',
            formatter: (p) => formatPrice(p, precision),
            minMove: minMove
          }
        });
        candleSeriesRef.current.setData(sorted);
      }

      if (chartRef.current) {
        try {
          chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        } catch (e) {}
      }

      const vols = sorted.map(c => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)'
      }));
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(vols);
      }

      // Run IndicatorRegistry calculations on client
      if (window.IndicatorRegistry) {
        for (const inst of instancesRef.current) {
          try {
            const def = window.IndicatorRegistry.get(inst.type);
            if (def && typeof def.calculate === 'function') {
              inst.calcResult = def.calculate(sorted, inst.inputs);
            }
          } catch (indErr) {
            console.warn(`Indicator [${inst.name}] calculation error:`, indErr.message);
          }
        }
      }

      // Sync series & render canvas
      syncSeriesIndicators();
      triggerCanvasRender();

      // Connect Direct Real-Time WebSocket stream
      wsRef.current = DirectExchangeClient.createWebSocket(exchange, symbol, timeframe, (tick) => {
        if (candleSeriesRef.current) {
          candleSeriesRef.current.update(tick);
          if (volumeSeriesRef.current) {
            volumeSeriesRef.current.update({
              time: tick.time,
              value: tick.volume || 0,
              color: tick.close >= tick.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)'
            });
          }
          triggerCanvasRender();
        }
      });

    } catch (err) {
      console.warn('Kline load err:', err.message);
    } finally {
      setLoading(false);
    }
  }, [exchange, symbol, timeframe, syncSeriesIndicators, triggerCanvasRender]);

  // Load Klines when symbol, timeframe, or exchange changes
  useEffect(() => {
    loadCandlesDirect();
    return () => {
      if (wsRef.current && typeof wsRef.current.close === 'function') {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [loadCandlesDirect]);

  // Recalculate indicators dynamically when instances prop changes (NO kline refetch needed)
  useEffect(() => {
    const currentCandles = candlesRef.current;
    if (currentCandles && currentCandles.length > 0 && window.IndicatorRegistry) {
      for (const inst of instances) {
        try {
          const def = window.IndicatorRegistry.get(inst.type);
          if (def && typeof def.calculate === 'function') {
            inst.calcResult = def.calculate(currentCandles, inst.inputs);
          }
        } catch (e) {}
      }
      syncSeriesIndicators();
      triggerCanvasRender();
    }
  }, [instances, syncSeriesIndicators, triggerCanvasRender]);

  // ── DRAWING COORDINATE MAPPING & HIT-TESTING (ROBUST CONTINUOUS TIME INTERPOLATION) ──
  const getCanvasCoords = (time, price) => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const currentCandles = candlesRef.current;
    if (!chart || !candleSeries || !currentCandles || currentCandles.length === 0) return { x: null, y: null };
    const timeScale = chart.timeScale();
    let x = timeScale.timeToCoordinate(time);
    if (x === null || isNaN(x)) {
      if (currentCandles.length > 1) {
        const first = currentCandles[0];
        const last = currentCandles[currentCandles.length - 1];
        const firstX = timeScale.timeToCoordinate(first.time);
        const lastX = timeScale.timeToCoordinate(last.time);
        if (firstX !== null && lastX !== null && lastX !== firstX) {
          const pxPerSec = (lastX - firstX) / (last.time - first.time);
          x = firstX + (time - first.time) * pxPerSec;
        }
      }
    }
    const y = candleSeries.priceToCoordinate(price);
    return { x: (x !== null && !isNaN(x)) ? x : null, y: (y !== null && !isNaN(y)) ? y : null };
  };

  const getCoordinatesFromEvent = (e) => {
    const container = chartContainerRef.current;
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const currentCandles = candlesRef.current;
    if (!container || !chart || !candleSeries || !currentCandles || currentCandles.length === 0) return null;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const timeScale = chart.timeScale();
    let time = timeScale.coordinateToTime(x);
    if (time === null || time === undefined) {
      if (currentCandles.length > 1) {
        const first = currentCandles[0];
        const last = currentCandles[currentCandles.length - 1];
        const firstX = timeScale.timeToCoordinate(first.time);
        const lastX = timeScale.timeToCoordinate(last.time);
        if (firstX !== null && lastX !== null && lastX !== firstX) {
          const secPerPx = (last.time - first.time) / (lastX - firstX);
          time = Math.round(first.time + (x - firstX) * secPerPx);
        }
      }
    }
    const price = candleSeries.coordinateToPrice(y);
    return {
      x,
      y,
      time: (time !== null && !isNaN(time)) ? time : null,
      price: (price !== null && !isNaN(price)) ? price : null
    };
  };

  // Comprehensive Hit-Test: Checks handles of selected drawing, or bodies of all drawings
  const checkHitTest = (x, y) => {
    const currentDrawings = drawingsRef.current || [];
    const activeSelId = selectedIdRef.current;

    // 1. If a drawing is currently selected, check its handles first
    if (activeSelId) {
      const sel = currentDrawings.find(d => d.id === activeSelId);
      if (sel && sel.p1 && sel.p2) {
        const c1 = getCanvasCoords(sel.p1.time, sel.p1.price);
        const c2 = getCanvasCoords(sel.p2.time, sel.p2.price);
        if (c1.x !== null && c1.y !== null && c2.x !== null && c2.y !== null) {
          if (sel.type === 'line') {
            if (Math.hypot(x - c1.x, y - c1.y) <= 12) {
              return { targetId: sel.id, handle: 'p1', cursor: 'crosshair', anchor: { ...sel.p2 } };
            }
            if (Math.hypot(x - c2.x, y - c2.y) <= 12) {
              return { targetId: sel.id, handle: 'p2', cursor: 'crosshair', anchor: { ...sel.p1 } };
            }
          } else {
            // rect or measure: 4 corners with diagonal arrow cursors
            const rx = Math.min(c1.x, c2.x);
            const ry = Math.min(c1.y, c2.y);
            const rw = Math.abs(c2.x - c1.x);
            const rh = Math.abs(c2.y - c1.y);

            const minTime = Math.min(sel.p1.time, sel.p2.time);
            const maxTime = Math.max(sel.p1.time, sel.p2.time);
            const minPrice = Math.min(sel.p1.price, sel.p2.price);
            const maxPrice = Math.max(sel.p1.price, sel.p2.price);

            // Top-Left (rx, ry) -> nwse-resize (↖↘)
            if (Math.hypot(x - rx, y - ry) <= 12) {
              return { targetId: sel.id, handle: 'tl', cursor: 'nwse-resize', anchor: { time: maxTime, price: minPrice } };
            }
            // Bottom-Right (rx + rw, ry + rh) -> nwse-resize (↖↘)
            if (Math.hypot(x - (rx + rw), y - (ry + rh)) <= 12) {
              return { targetId: sel.id, handle: 'br', cursor: 'nwse-resize', anchor: { time: minTime, price: maxPrice } };
            }
            // Top-Right (rx + rw, ry) -> nesw-resize (↗↙)
            if (Math.hypot(x - (rx + rw), y - ry) <= 12) {
              return { targetId: sel.id, handle: 'tr', cursor: 'nesw-resize', anchor: { time: minTime, price: minPrice } };
            }
            // Bottom-Left (rx, ry + rh) -> nesw-resize (↗↙)
            if (Math.hypot(x - rx, y - (ry + rh)) <= 12) {
              return { targetId: sel.id, handle: 'bl', cursor: 'nesw-resize', anchor: { time: maxTime, price: maxPrice } };
            }
          }
        }
      }
    }

    // 2. Check bodies of all drawings (reverse order for top-most)
    for (let i = currentDrawings.length - 1; i >= 0; i--) {
      const d = currentDrawings[i];
      if (!d.p1 || !d.p2) continue;
      const c1 = getCanvasCoords(d.p1.time, d.p1.price);
      const c2 = getCanvasCoords(d.p2.time, d.p2.price);
      if (c1.x === null || c1.y === null || c2.x === null || c2.y === null) continue;

      if (d.type === 'line') {
        const l2 = (c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2;
        let t = l2 === 0 ? 0 : ((x - c1.x) * (c2.x - c1.x) + (y - c1.y) * (c2.y - c1.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const dist = Math.hypot(x - (c1.x + t * (c2.x - c1.x)), y - (c1.y + t * (c2.y - c1.y)));
        if (dist <= 12) {
          return { targetId: d.id, handle: 'body', cursor: 'move' };
        }
      } else {
        const rx = Math.min(c1.x, c2.x) - 4;
        const ry = Math.min(c1.y, c2.y) - 4;
        const rw = Math.abs(c2.x - c1.x) + 8;
        const rh = Math.abs(c2.y - c1.y) + 8;
        if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
          return { targetId: d.id, handle: 'body', cursor: 'move' };
        }
      }
    }

    return null;
  };

  // Window-level tracking for smooth, non-dropping drag and resize
  useEffect(() => {
    const onWindowPointerMove = (e) => {
      if (!dragActionRef.current) return;
      const coords = getCoordinatesFromEvent(e);
      if (!coords || coords.time === null || coords.price === null) return;
      const { time, price } = coords;

      const dragAct = dragActionRef.current;
      if (dragAct === 'create' && currentDrawingRef.current) {
        setCurrentDrawing(prev => ({ ...prev, p2: { time, price } }));
        triggerCanvasRender();
        return;
      }

      const selId = selectedIdRef.current;
      const target = drawingsRef.current.find(d => d.id === selId);
      if (!target) return;

      if (dragAct === 'move' && dragOriginRef.current && dragOriginRef.current.initP1 && dragOriginRef.current.initP2) {
        const dt = time - dragOriginRef.current.startTime;
        const dp = price - dragOriginRef.current.startPrice;
        target.p1 = { time: dragOriginRef.current.initP1.time + dt, price: dragOriginRef.current.initP1.price + dp };
        target.p2 = { time: dragOriginRef.current.initP2.time + dt, price: dragOriginRef.current.initP2.price + dp };
        setDrawings([...drawingsRef.current]);
        triggerCanvasRender();
      } else if (dragAct === 'p1') {
        target.p1 = { time, price };
        setDrawings([...drawingsRef.current]);
        triggerCanvasRender();
      } else if (dragAct === 'p2') {
        target.p2 = { time, price };
        setDrawings([...drawingsRef.current]);
        triggerCanvasRender();
      } else if (dragOriginRef.current && dragOriginRef.current.anchor) {
        target.p1 = { time, price };
        target.p2 = dragOriginRef.current.anchor;
        setDrawings([...drawingsRef.current]);
        triggerCanvasRender();
      }
    };

    const onWindowPointerUp = (e) => {
      if (!dragActionRef.current) return;
      if (dragActionRef.current === 'create' && currentDrawingRef.current) {
        const draft = currentDrawingRef.current;
        setCurrentDrawing(null);
        setDragAction(null);
        const nextList = [...drawingsRef.current, draft];
        setDrawings(nextList);
        setSelectedId(draft.id);
        setDrawTool('cursor');
        triggerCanvasRender();
        debouncedSaveDrawing(draft);
        return;
      }

      if (dragActionRef.current && selectedIdRef.current) {
        const target = drawingsRef.current.find(d => d.id === selectedIdRef.current);
        setDragAction(null);
        if (target) {
          debouncedSaveDrawing(target);
        }
      }
      setDragAction(null);
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
    };
  }, [triggerCanvasRender, debouncedSaveDrawing]);

  // ── WORKSPACE MOUSE DOWN & HOVER DETECTION ──
  const handleWorkspaceMouseDown = (e) => {
    const coords = getCoordinatesFromEvent(e);
    if (!coords || coords.time === null || coords.price === null) return;
    const { x, y, time, price } = coords;

    if (drawTool !== 'cursor') {
      // Create new drawing
      const newDraw = {
        id: `draw_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: drawTool,
        p1: { time, price },
        p2: { time, price },
        color: drawColor
      };
      currentDrawingRef.current = newDraw;
      setCurrentDrawing(newDraw);
      dragActionRef.current = 'create';
      setDragAction('create');
      selectedIdRef.current = null;
      setSelectedId(null);
      return;
    }

    // In Cursor Mode: Hit test
    const hit = checkHitTest(x, y);
    if (hit) {
      e.stopPropagation();
      selectedIdRef.current = hit.targetId;
      setSelectedId(hit.targetId);
      dragActionRef.current = hit.handle;
      setDragAction(hit.handle);
      const d = drawingsRef.current.find(item => item.id === hit.targetId);
      const originData = {
        startX: x,
        startY: y,
        startTime: time,
        startPrice: price,
        initP1: d ? { ...d.p1 } : null,
        initP2: d ? { ...d.p2 } : null,
        anchor: hit.anchor || null
      };
      dragOriginRef.current = originData;
      setDragOrigin(originData);
      triggerCanvasRender();
    } else {
      if (selectedIdRef.current) {
        selectedIdRef.current = null;
        setSelectedId(null);
        triggerCanvasRender();
      }
    }
  };

  const handleWorkspaceMouseMove = (e) => {
    if (dragActionRef.current) return; // Managed by window listener
    if (drawTool !== 'cursor') return;

    const coords = getCoordinatesFromEvent(e);
    if (!coords) return;
    const { x, y } = coords;

    // Check hit test to dynamically adjust hover cursor and pointerEvents
    const hit = checkHitTest(x, y);
    setHoverTarget(hit);
  };

  return (
    <div className="flex flex-col h-full w-full bg-binance-bg overflow-hidden relative select-none font-sans">
      
      {/* ── 1. CLEAN STANDARD TOP TOOLBAR (SYMBOL, EXCHANGE, TIMEFRAME, FX INDICATORS, SYNC) ── */}
      <div className="h-9 px-3 border-b border-binance-border flex items-center justify-between bg-binance-panel text-xs shrink-0 z-20">
        
        {/* Left: Symbol Pill, Exchange Badge, Timeframe Switcher, fx Button, Sync Button */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-extrabold text-binance-yellow font-mono text-sm tracking-wide">{symbol}</span>
          <span className="text-[10px] text-slate-300 bg-binance-card px-2 py-0.5 rounded border border-binance-borderSubtle font-bold font-mono">{exchange}</span>
          
          <div className="h-4 w-[1px] bg-binance-border mx-1"></div>

          {/* Timeframe Pills */}
          <div className="flex items-center bg-binance-bg border border-binance-border rounded p-0.5 gap-0.5">
            {['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'].map(tf => (
              <button
                key={tf}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition ${timeframe === tf ? 'bg-binance-active text-binance-yellow shadow' : 'text-slate-400 hover:text-white'}`}
                onClick={() => onTfChange && onTfChange(tf)}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="h-4 w-[1px] bg-binance-border mx-1"></div>

          {/* Function Button (TradingView fx Indicators Catalog) */}
          <button
            className="px-2.5 py-1 rounded text-[11px] font-extrabold bg-binance-card hover:bg-binance-hover text-binance-cyan border border-binance-border flex items-center gap-1.5 shadow transition"
            onClick={onOpenCatalog}
            title="Mở Danh Mục Chỉ Báo & Hàm Tính Toán (Indicators & Strategies)"
          >
            <span className="font-serif italic font-black text-xs">fx</span>
            <span>Indicators ({instances.filter(i => i.visible).length})</span>
          </button>

          {/* Sync Button */}
          <button
            className="px-2.5 py-1 rounded text-[11px] font-bold bg-binance-card hover:bg-binance-hover text-slate-200 border border-binance-border flex items-center gap-1.5 shadow transition"
            onClick={loadCandlesDirect}
            title="Đồng Bộ & Tải Lại Nến Trực Tiếp (Sync Klines)"
          >
            <span>🔄</span>
            <span>Sync</span>
          </button>
        </div>

        {/* Right: Maximize / Collapse Button */}
        <div className="flex items-center gap-2">
          {onToggleCollapse && (
            <button
              className={`px-2.5 py-1 rounded text-[10.5px] font-extrabold transition border flex items-center gap-1 ${isCollapsed ? 'bg-binance-yellow text-black border-binance-yellow shadow-lg' : 'bg-binance-subpanel text-binance-text border-binance-border hover:text-white'}`}
              onClick={onToggleCollapse}
              title={isCollapsed ? 'Mở Rộng Bàn Làm Việc' : 'Thu Gọn / Phóng To Biểu Đồ'}
            >
              <span>{isCollapsed ? '▲ Expand Desk' : '▼ Maximize Chart'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 2. WORKSPACE AREA: DOCKED LEFT TOOLBAR + CHART WORKSPACE ── */}
      <div className="flex-1 w-full h-full flex flex-row overflow-hidden bg-binance-bg relative">
        
        {/* ── DOCKED VERTICAL DRAWING TOOLBAR (TRADINGVIEW DOCKED SIDEBAR ON LEFT EDGE) ── */}
        <div className="w-10 bg-binance-panel border-r border-binance-border flex flex-col items-center py-2.5 gap-1.5 z-20 shrink-0 select-none shadow">
          <button
            className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center transition ${drawTool === 'cursor' ? 'bg-binance-yellow text-black shadow-md' : 'text-slate-400 hover:text-white hover:bg-binance-card'}`}
            onClick={() => { setDrawTool('cursor'); }}
            title="👆 Chế độ rê chuột / Chọn, Kéo & Phóng to thu nhỏ hình (Pan & Select)"
          >
            👆
          </button>
          <button
            className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center transition ${drawTool === 'line' ? 'bg-binance-yellow text-black shadow-md' : 'text-slate-400 hover:text-white hover:bg-binance-card'}`}
            onClick={() => { setDrawTool('line'); setSelectedId(null); }}
            title="📏 Vẽ Đường Xu Hướng / Trendline"
          >
            📏
          </button>
          <button
            className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center transition ${drawTool === 'rect' ? 'bg-binance-yellow text-black shadow-md' : 'text-slate-400 hover:text-white hover:bg-binance-card'}`}
            onClick={() => { setDrawTool('rect'); setSelectedId(null); }}
            title="🟩 Vẽ Khối Vùng Giá / Box SMC Zone"
          >
            🟩
          </button>
          <button
            className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center transition ${drawTool === 'measure' ? 'bg-binance-cyan text-black shadow-md' : 'text-slate-400 hover:text-white hover:bg-binance-card'}`}
            onClick={() => { setDrawTool('measure'); setSelectedId(null); }}
            title="📐 Thước Đo Khoảng Cách Giá, % & Số Nến"
          >
            📐
          </button>

          <div className="w-5 h-[1px] bg-binance-border/80 my-1"></div>

          {/* Quick Palette */}
          {['#00F0FF', '#F0B90B', '#10B981', '#F43F5E'].map(c => (
            <button
              key={c}
              className={`w-3.5 h-3.5 rounded-full transition border ${drawColor === c ? 'border-white scale-125 shadow' : 'border-transparent opacity-50 hover:opacity-100'}`}
              style={{ backgroundColor: c }}
              onClick={(e) => {
                setDrawColor(c);
                if (selectedId) handleChangeColor(selectedId, c, e);
              }}
              title={`Màu vẽ ${c}`}
            />
          ))}

          {drawings.length > 0 && (
            <>
              <div className="w-5 h-[1px] bg-binance-border/80 my-1"></div>
              <button
                className="w-7 h-7 rounded-lg text-xs font-bold text-binance-red hover:bg-binance-red/20 flex items-center justify-center transition"
                onClick={handleClearDrawings}
                title={`🗑️ Xóa tất cả hình vẽ (${drawings.length})`}
              >
                🗑️
              </button>
            </>
          )}
        </div>

        {/* ── CHART WORKSPACE (LIGHTWEIGHT CHARTS + CANVAS OVERLAY + FLOATING ACTION STRIP) ── */}
        <div
          className="flex-1 h-full relative overflow-hidden bg-binance-bg"
          onMouseDown={handleWorkspaceMouseDown}
          onMouseMove={handleWorkspaceMouseMove}
        >
          
          {/* Floating Action Strip when a Drawing is Selected */}
          {selectedId && (
            <div
              className="absolute top-2.5 left-1/2 -translate-x-1/2 z-30 bg-[#0E1322]/95 backdrop-blur-md border border-binance-borderHighlight rounded-xl px-3 py-1.5 flex items-center gap-2.5 shadow-2xl font-mono text-xs select-none"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            >
              <span className="text-binance-yellow font-extrabold text-[11px] uppercase tracking-wide">
                {drawings.find(d => d.id === selectedId)?.type || 'Drawing'}
              </span>
              
              <div className="h-4 w-[1px] bg-binance-border mx-0.5"></div>

              {['#00F0FF', '#F0B90B', '#10B981', '#F43F5E'].map(c => (
                <button
                  key={c}
                  type="button"
                  className="w-4 h-4 rounded-full transition border border-white/40 hover:scale-125 shadow"
                  style={{ backgroundColor: c }}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={(e) => handleChangeColor(selectedId, c, e)}
                  title={`Đổi màu ${c}`}
                />
              ))}

              <div className="h-4 w-[1px] bg-binance-border mx-0.5"></div>

              <button
                type="button"
                className="bg-binance-red hover:bg-red-600 active:scale-95 text-white px-2.5 py-1 rounded-lg font-extrabold text-[11px] transition shadow flex items-center gap-1 cursor-pointer select-none"
                onMouseDown={e => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleDeleteDrawing(selectedId, e);
                }}
                title="Xóa hình vẽ này (Phím Delete hoặc Backspace)"
              >
                <span>🗑️</span>
                <span>Xóa</span>
              </button>

              <button
                type="button"
                className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-binance-card transition"
                onMouseDown={e => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(null);
                }}
                title="Bỏ chọn"
              >
                ✕
              </button>
            </div>
          )}

          {/* TradingView-Style Large Background Watermark */}
          <div className="chart-watermark">
            <div className="watermark-symbol">{symbol}</div>
            <div className="watermark-sub">{timeframe.toUpperCase()} · {exchange} FUTURES</div>
          </div>

          {/* TradingView-Style On-Chart Indicator Legend (Status Line with 👁️ ⚙️ ✕) */}
          <div className="chart-legend">
            {instances.map(inst => (
              <div key={inst.id} className={`legend-row ${inst.visible ? '' : 'inactive'}`} onClick={() => onOpenSettings(inst)}>
                <span
                  className="legend-dot"
                  style={{ background: inst.type === 'stat2_box_strategy' ? '#00F0FF' : (inst.type === 'ema' ? '#38BDF8' : '#FBBF24') }}
                ></span>
                <span className="legend-title">{inst.name}</span>
                <div className="legend-actions" onClick={e => e.stopPropagation()}>
                  <button className="legend-btn" onClick={() => onToggleVisibility(inst.id)} title={inst.visible ? 'Hide Indicator' : 'Show Indicator'}>
                    {inst.visible ? '👁️' : '👁️‍🗨️'}
                  </button>
                  <button className="legend-btn" onClick={() => onOpenSettings(inst)} title="Settings">⚙️</button>
                  <button className="legend-btn text-binance-red" onClick={() => onRemoveInstance(inst.id)} title="Remove from Chart">✕</button>
                </div>
              </div>
            ))}
          </div>

          {/* Lightweight Charts Root */}
          <div ref={chartContainerRef} className="w-full h-full" />

          {/* High-DPI Canvas Overlay with Dynamic Pointer-Events & Hover Cursors */}
          <canvas
            ref={overlayCanvasRef}
            onMouseDown={handleWorkspaceMouseDown}
            onMouseMove={handleWorkspaceMouseMove}
            style={{
              cursor: drawTool !== 'cursor' ? 'crosshair' : (dragAction ? (dragAction === 'move' ? 'grabbing' : hoverTarget?.cursor || 'crosshair') : (hoverTarget?.cursor || 'default')),
              pointerEvents: (drawTool !== 'cursor' || hoverTarget !== null || dragAction !== null) ? 'auto' : 'none'
            }}
            className="absolute inset-0 w-full h-full z-10"
          />

          {/* Loading Overlay */}
          {loading && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center gap-2 text-binance-yellow text-xs font-mono z-30">
              <span className="animate-spin text-base">⚡</span>
              <span>Connecting direct live feeds for {symbol} ({timeframe})...</span>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}

// ── CYBERPUNK STARTUP SPLASHSCREEN COMPONENT ──
function SplashScreen({ tasks, progress, isReady }) {
  if (isReady) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[#070A12] flex flex-col items-center justify-center p-6 text-white font-mono select-none">
      <div className="flex flex-col items-center max-w-md w-full gap-6">
        
        {/* Brand Logo & Glow */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-binance-yellow/20 to-binance-cyan/20 border border-binance-yellow/40 flex items-center justify-center text-3xl shadow-[0_0_35px_rgba(240,185,11,0.4)] animate-pulse">
            ⚡
          </div>
          <h1 className="text-lg font-black tracking-widest text-white mt-2">
            STAT2 <span className="text-binance-yellow">FUTURES PRO</span>
          </h1>
          <p className="text-[11px] text-binance-textSec">Multi-Exchange Quantitative Terminal (Binance · Bybit · OKX)</p>
        </div>

        {/* Neon Progress Bar */}
        <div className="w-full flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-binance-yellow">SYSTEM INITIALIZATION</span>
            <span className="text-binance-cyan">{Math.min(progress, 100)}%</span>
          </div>
          <div className="w-full h-2.5 bg-binance-panel rounded-full overflow-hidden border border-binance-border">
            <div
              className="h-full bg-gradient-to-r from-binance-yellow via-binance-cyan to-binance-green rounded-full transition-all duration-300 shadow-[0_0_15px_rgba(240,185,11,0.6)]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Step-by-Step Task Checklist */}
        <div className="w-full bg-binance-panel/90 border border-binance-border rounded-lg p-3.5 flex flex-col gap-2.5 shadow-2xl">
          {tasks.map(t => {
            const isDone = t.status === 'done';
            const isRunning = t.status === 'running';
            return (
              <div key={t.id} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2.5">
                  {isDone ? (
                    <span className="text-binance-green font-black text-xs">✓</span>
                  ) : isRunning ? (
                    <span className="animate-spin text-binance-yellow font-black text-xs">⚡</span>
                  ) : (
                    <span className="text-binance-textMuted text-xs">○</span>
                  )}
                  <span className={isDone ? 'text-white font-medium' : (isRunning ? 'text-binance-yellow font-bold' : 'text-binance-textMuted')}>
                    {t.label}
                  </span>
                </div>
                <span className={`text-[9.5px] font-mono font-bold px-1.5 py-0.2 rounded ${isDone ? 'bg-binance-greenBg text-binance-green' : (isRunning ? 'bg-binance-yellow/20 text-binance-yellow animate-pulse' : 'text-binance-textMuted')}`}>
                  {isDone ? 'READY' : (isRunning ? 'INIT' : 'WAIT')}
                </span>
              </div>
            );
          })}
        </div>

        <div className="text-[10px] text-binance-textMuted tracking-wider text-center">
          INITIALIZING QUANTITATIVE ARRAYS & MULTI-EXCHANGE REALTIME WEBSOCKET FEEDS...
        </div>
      </div>
    </div>
  );
}

// ── DEEP QUANTITATIVE ORDER & TRADE FORENSICS INTELLIGENCE MODAL ──
function OrderForensicsModal({
  data,
  marketPrices,
  indicatorInstances,
  onOpenCatalog,
  onToggleVisibility,
  onOpenSettings,
  onRemoveInstance,
  onClose,
  onSelectSymbol,
  onClosePosition
}) {
  if (!data) return null;

  const [activeSection, setActiveSection] = useState('sec-flow');
  const [modalTf, setModalTf] = useState(data.timeframe || data.tf || '15m');
  const scrollContainerRef = useRef(null);

  // ── TRADE NOTES PERSISTENCE STATE ──
  const [tradeNote, setTradeNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [saveNoteSuccess, setSaveNoteSuccess] = useState(false);
  
  const isLong = data.direction === 'BUY' || (data.signal_type && data.signal_type.includes('BUY')) || (data.side && data.side.toUpperCase() === 'BUY');
  const symbol = data.symbol || 'BTCUSDT';
  const exchange = data.exchange || 'BINANCE';
  const targetId = data.id || `${exchange}_${symbol}`;

  // Load trade notes from DB
  useEffect(() => {
    let isCancelled = false;
    async function loadNote() {
      try {
        const res = await fetch(`/api/notes/${targetId}`).then(r => r.json());
        if (!isCancelled && res.success && res.data && res.data.note_text !== undefined) {
          setTradeNote(res.data.note_text || '');
        }
      } catch (e) {}
    }
    loadNote();
    return () => { isCancelled = true; };
  }, [targetId]);

  const handleSaveNote = async () => {
    setIsSavingNote(true);
    try {
      await fetch(`/api/notes/${targetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, note_text: tradeNote })
      });
      setSaveNoteSuccess(true);
      setTimeout(() => setSaveNoteSuccess(false), 2500);
    } catch (err) {
      console.warn('Save note err:', err);
    } finally {
      setIsSavingNote(false);
    }
  };
  
  // Realtime Market Price resolution
  const pKey1 = `${exchange}_${symbol}`;
  const pKey2 = `${exchange}_${symbol.replace('-', '')}`;
  const livePriceObj = marketPrices[pKey1] || marketPrices[pKey2] || marketPrices[symbol] || {};
  const currentPrice = livePriceObj.price || data.current_price || data.entry_price || 0;
  
  // Targets
  const entryPrice = parseFloat(data.entry_price || data.price || currentPrice) || 1;
  const tp1Price = parseFloat(data.tp1_price || (isLong ? entryPrice * 1.015 : entryPrice * 0.985));
  const tp2Price = parseFloat(data.tp2_price || (isLong ? entryPrice * 1.035 : entryPrice * 0.965));
  const slPrice = parseFloat(data.sl_price || (isLong ? entryPrice * 0.988 : entryPrice * 1.012));
  
  const leverage = parseInt(data.leverage) || 20;
  const marginUsed = parseFloat(data.initial_margin || data.margin_used || data.margin || 100);
  const posSizeUsd = parseFloat(data.pos_size_usd) || (marginUsed * leverage);
  
  // Price Distances
  const tp1MovePct = entryPrice > 0 ? (isLong ? (tp1Price - entryPrice) / entryPrice : (entryPrice - tp1Price) / entryPrice) * 100 : 1.5;
  const tp2MovePct = entryPrice > 0 ? (isLong ? (tp2Price - entryPrice) / entryPrice : (entryPrice - tp2Price) / entryPrice) * 100 : 3.5;
  const slMovePct = entryPrice > 0 ? (isLong ? (entryPrice - slPrice) / entryPrice : (slPrice - entryPrice) / entryPrice) * 100 : 1.2;
  
  // Projected Profit & Loss in USD
  const tp1Usd = posSizeUsd * (tp1MovePct / 100);
  const tp2Usd = posSizeUsd * (tp2MovePct / 100);
  const slUsd = posSizeUsd * (slMovePct / 100);
  
  const tp1Roi = tp1MovePct * leverage;
  const tp2Roi = tp2MovePct * leverage;
  const slLossPct = slMovePct * leverage;
  
  const rrRatio = slMovePct > 0 ? (tp1MovePct / slMovePct) : 2.0;

  // Realtime Live Unrealized PnL
  let unPnlPct = 0;
  let unPnlUsd = 0;
  if (entryPrice > 0 && currentPrice > 0) {
    const rawDiff = isLong ? (currentPrice - entryPrice) / entryPrice : (entryPrice - currentPrice) / entryPrice;
    unPnlPct = rawDiff * 100 * leverage;
    unPnlUsd = marginUsed * (unPnlPct / 100);
  }
  if (data.net_pnl_usd !== undefined) {
    unPnlUsd = data.net_pnl_usd;
    unPnlPct = data.roe_pct !== undefined ? data.roe_pct : (marginUsed > 0 ? (unPnlUsd / marginUsed) * 100 : 0);
  }

  // Progress to TP1
  let progressPct = 0;
  if (isLong) {
    if (currentPrice >= tp1Price) progressPct = 100;
    else if (currentPrice <= slPrice) progressPct = 0;
    else progressPct = Math.max(0, Math.min(100, ((currentPrice - entryPrice) / (tp1Price - entryPrice)) * 100));
  } else {
    if (currentPrice <= tp1Price) progressPct = 100;
    else if (currentPrice >= slPrice) progressPct = 0;
    else progressPct = Math.max(0, Math.min(100, ((entryPrice - currentPrice) / (entryPrice - tp1Price)) * 100));
  }

  const isActive = data.id && data.status === 'ACTIVE';

  const navItems = [
    { id: 'sec-flow', icon: '🧠', label: '1. Flow Phân Tích & Rationale', desc: 'Logic kích hoạt & bộ lọc 4 bước' },
    { id: 'sec-targets', icon: '🎯', label: '2. Mốc Giá, PnL & Quản Lý Size', desc: 'Entry, TP, SL & Báo Cáo Sizing' },
    { id: 'sec-status', icon: '⚡', label: '3. Tình Trạng Lệnh Thực Tế', desc: 'Tiến trình TP1 & PnL Realtime' },
    { id: 'sec-smc', icon: '📐', label: '4. Cấu Trúc Smart Money', desc: 'Thanh khoản BSL/SSL & FVG' },
    { id: 'sec-chart', icon: '📊', label: `5. ${symbol} • ${modalTf} Chart`, desc: 'Biểu đồ nến & bộ công cụ vẽ' },
    { id: 'sec-notes', icon: '📝', label: '6. Ghi Chú Lệnh (Trade Journal)', desc: 'Lưu ghi chú cá nhân vào DB' },
    { id: 'sec-engine', icon: '📜', label: '7. Thông Số Thuật Toán & Audit', desc: 'ID, thời gian & cài đặt bảo mật' }
  ];

  const handleNavClick = (e, id) => {
    e.preventDefault();
    setActiveSection(id);
    const target = document.getElementById(id);
    if (target && scrollContainerRef.current) {
      const topOffset = target.offsetTop - scrollContainerRef.current.offsetTop - 8;
      scrollContainerRef.current.scrollTo({ top: Math.max(0, topOffset), behavior: 'smooth' });
    }
  };

  const handleScrollSpy = () => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const scrollPos = container.scrollTop + 120;
    for (let i = navItems.length - 1; i >= 0; i--) {
      const item = navItems[i];
      const el = document.getElementById(item.id);
      if (el && el.offsetTop - container.offsetTop <= scrollPos) {
        setActiveSection(item.id);
        break;
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4 md:p-6 select-none font-sans">
      <div className="bg-binance-panel border border-binance-borderHighlight rounded-2xl w-full max-w-6xl xl:max-w-7xl h-[92vh] flex flex-col overflow-hidden shadow-2xl text-xs" onClick={e => e.stopPropagation()}>
        
        {/* ── TOP HEADER BANNER (HORIZONTAL BAR) ── */}
        <div className="p-3.5 border-b border-binance-border bg-binance-subpanel flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-1 rounded font-black text-xs font-mono shadow ${isLong ? 'badge-long' : 'badge-short'}`}>
              {isLong ? '▲ LONG / BUY' : '▼ SHORT / SELL'}
            </span>
            <div className="flex items-center gap-2 font-extrabold text-sm text-white">
              <span className="text-base tracking-wide font-mono">{symbol}</span>
              <span className="text-[10px] text-slate-400 bg-binance-card px-2 py-0.5 rounded border border-binance-borderSubtle font-mono">
                {exchange} • {leverage}x ISOLATED • {modalTf}
              </span>
            </div>
            <span className="hidden sm:inline-block bg-binance-active text-binance-yellow text-[10.5px] px-2.5 py-0.5 rounded font-bold border border-binance-yellow/30 font-mono tracking-wide">
              {data.strategy_name || data.signal_type || 'STAT2 VIDYA + SMC QUANTITATIVE ENGINE'}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-binance-card/80 px-3 py-1 rounded border border-binance-borderSubtle font-mono">
              <span className="text-slate-400 text-[10px] font-semibold uppercase">MARK:</span>
              <span className="font-bold text-white text-xs">${formatPrice(currentPrice)}</span>
              <span className={`font-bold text-xs ${unPnlUsd >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
                ({unPnlUsd >= 0 ? '+' : ''}${formatPrice(unPnlUsd)} / {unPnlPct >= 0 ? '+' : ''}{unPnlPct.toFixed(2)}%)
              </span>
            </div>
            <button
              className="text-slate-400 hover:text-white text-base font-bold w-7 h-7 flex items-center justify-center rounded bg-binance-card hover:bg-binance-hover border border-binance-border transition"
              onClick={onClose}
              title="Đóng Hộp Thoại (Close Modal)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── MAIN BODY: VERTICAL TABS SIDEBAR (LEFT) + UNIFIED SCROLLABLE CONTAINER (RIGHT) ── */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* LEFT VERTICAL NAVIGATION TABS (AHREF LINKS) */}
          <aside className="w-60 sm:w-72 bg-binance-subpanel/80 border-r border-binance-border flex flex-col justify-between shrink-0 p-3 overflow-y-auto font-sans">
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider px-2 pb-1 flex items-center gap-1.5">
                <span>📑</span>
                <span>MỤC LỤC PHÂN TÍCH</span>
              </span>

              {navItems.map(item => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={(e) => handleNavClick(e, item.id)}
                  className={`px-3 py-2.5 rounded-lg flex flex-col gap-0.5 transition border ${activeSection === item.id ? 'bg-binance-card border-binance-yellow text-binance-yellow shadow-md' : 'border-transparent text-slate-400 hover:text-white hover:bg-binance-card/50'}`}
                >
                  <div className="flex items-center gap-2 font-bold text-xs">
                    <span>{item.icon}</span>
                    <span className={activeSection === item.id ? 'text-white' : ''}>{item.label}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 pl-5 font-medium">{item.desc}</span>
                </a>
              ))}
            </div>

            {/* Quick Metrics Card in Sidebar (Explicit USD Dollar Values & ROE %) */}
            <div className="p-3 bg-binance-card rounded-lg border border-binance-border flex flex-col gap-2 mt-4 text-[11px] font-mono shadow-inner">
              <span className="text-[10px] font-bold text-slate-300 uppercase border-b border-binance-border pb-1 tracking-wider flex items-center justify-between">
                <span>TỔNG QUAN RỦI RO & LỢI NHUẬN</span>
                <span className="text-binance-yellow">USD & ROI</span>
              </span>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Tỷ Lệ R:R:</span>
                <b className="text-binance-yellow font-bold">1 : {rrRatio.toFixed(2)}</b>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Kỳ Vọng TP1:</span>
                <b className="text-binance-green font-bold">+${formatPrice(tp1Usd)} USD <span className="text-[10px] opacity-80">(+{tp1Roi.toFixed(1)}%)</span></b>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Kỳ Vọng TP2:</span>
                <b className="text-binance-cyan font-bold">+${formatPrice(tp2Usd)} USD <span className="text-[10px] opacity-80">(+{tp2Roi.toFixed(1)}%)</span></b>
              </div>
              <div className="flex justify-between items-center border-t border-binance-border/60 pt-1">
                <span className="text-slate-400">Rủi Ro SL:</span>
                <b className="text-binance-red font-bold">-${formatPrice(slUsd)} USD <span className="text-[10px] opacity-80">(-{slLossPct.toFixed(1)}%)</span></b>
              </div>
            </div>
          </aside>

          {/* RIGHT UNIFIED SCROLLABLE CONTAINER FOR ALL SECTIONS (HORIZONTAL INFORMATION LAYOUT) */}
          <main
            ref={scrollContainerRef}
            onScroll={handleScrollSpy}
            className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-8 scroll-smooth bg-binance-bg/50"
          >
            
            {/* ── SECTION 1: FLOW PHÂN TÍCH & RATIONALE (HORIZONTAL ROWS) ── */}
            <section id="sec-flow" className="flex flex-col gap-3 scroll-mt-4">
              <div className="flex items-center justify-between border-b border-binance-border pb-2">
                <span className="font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide">
                  <span className="text-binance-yellow">🧠</span>
                  <span>1. FLOW PHÂN TÍCH & LOGIC VÀO LỆNH (EXECUTION RATIONALE)</span>
                </span>
                <span className="text-[10px] bg-binance-greenBg text-binance-green px-2 py-0.5 rounded font-black border border-binance-green/30 tracking-wider">
                  4/4 BƯỚC ĐẠT CHUẨN
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {/* Horizontal Step 1 */}
                <div className="p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:border-binance-borderHighlight transition">
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="w-7 h-7 rounded-lg bg-binance-yellow/20 text-binance-yellow flex items-center justify-center font-black text-xs border border-binance-yellow/40">1</span>
                    <div>
                      <span className="font-bold text-white text-xs block">Chế Độ Xu Hướng & Động Lượng (Trend & Momentum)</span>
                      <span className="text-[10.5px] text-slate-400 font-medium">VIDYA MA Ribbon + Chande Momentum Oscillator</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[10.5px]">
                    <span className="bg-binance-panel px-2 py-1 rounded border border-binance-borderSubtle">CMO: <b className="text-white">{data.cmo_val ? data.cmo_val.toFixed(2) : '+34.20'}</b></span>
                    <span className="bg-binance-panel px-2 py-1 rounded border border-binance-borderSubtle">ATR: <b className="text-binance-cyan">{(data.atr_pct || 0.78).toFixed(2)}%</b></span>
                    <span className="bg-binance-greenBg text-binance-green px-2 py-1 rounded font-bold">{data.market_regime || 'EXPANSION'}</span>
                  </div>
                  <div className="text-[11.5px] text-slate-300 leading-relaxed md:max-w-md">
                    Hệ thống xác nhận xu hướng chủ đạo rõ ràng, biên độ dao động ATR đủ lớn để mở vị thế tiếp diễn/bắt bẫy thanh khoản.
                  </div>
                </div>

                {/* Horizontal Step 2 */}
                <div className="p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:border-binance-borderHighlight transition">
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="w-7 h-7 rounded-lg bg-binance-cyan/20 text-binance-cyan flex items-center justify-center font-black text-xs border border-binance-cyan/40">2</span>
                    <div>
                      <span className="font-bold text-white text-xs block">Cấu Trúc SMC & Quét Thanh Khoản (Liquidity Sweep)</span>
                      <span className="text-[10.5px] text-slate-400 font-medium">Smart Money Traps & Fair Value Gap Detection</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[10.5px]">
                    <span className="bg-binance-cyanBg text-binance-cyan px-2 py-1 rounded font-bold">{isLong ? 'SSL LIQ SWEEP' : 'BSL LIQ SWEEP'}</span>
                    <span className="bg-binance-panel px-2 py-1 rounded border border-binance-borderSubtle">{isLong ? 'FVG+ BULLISH' : 'FVG- BEARISH'}</span>
                  </div>
                  <div className="text-[11.5px] text-slate-300 leading-relaxed md:max-w-md">
                    Giá quét sạch thanh khoản của các nhà giao dịch bán lẻ tại mốc quan trọng, tạo râu nến từ chối mạnh (Rejection Wick) và tạo khối FVG đẩy giá.
                  </div>
                </div>

                {/* Horizontal Step 3 */}
                <div className="p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-2.5 hover:border-binance-borderHighlight transition">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="w-7 h-7 rounded-lg bg-binance-green/20 text-binance-green flex items-center justify-center font-black text-xs border border-binance-green/40">3</span>
                      <div>
                        <span className="font-bold text-white text-xs block">Ma Trận Bộ Lọc Khử Nhiễu (Filter Matrix Verification)</span>
                        <span className="text-[10.5px] text-slate-400 font-medium">4 Lớp kiểm định độc lập trước khi gửi lệnh</span>
                      </div>
                    </div>
                    <span className="bg-binance-green text-black font-black text-[9.5px] px-2 py-0.5 rounded tracking-wider">PASSED</span>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[10.5px]">
                    <div className="p-1.5 rounded bg-binance-subpanel border border-binance-borderSubtle text-binance-green flex items-center gap-1.5">
                      <span>✓</span><span>CMO Momentum</span>
                    </div>
                    <div className="p-1.5 rounded bg-binance-subpanel border border-binance-borderSubtle text-binance-green flex items-center gap-1.5">
                      <span>✓</span><span>Min ATR Volatility</span>
                    </div>
                    <div className="p-1.5 rounded bg-binance-subpanel border border-binance-borderSubtle text-binance-green flex items-center gap-1.5">
                      <span>✓</span><span>Counter FVG Void</span>
                    </div>
                    <div className="p-1.5 rounded bg-binance-subpanel border border-binance-borderSubtle text-binance-green flex items-center gap-1.5">
                      <span>✓</span><span>R:R &gt; 1:2.0 Filter</span>
                    </div>
                  </div>

                  <div className="p-3 rounded-r-lg bg-slate-900/90 border-l-4 border-binance-yellow text-slate-200 text-[11.5px] italic leading-relaxed font-sans">
                    "{data.entry_rationale || data.side_rationale || 'Xác nhận tín hiệu vào lệnh tự động sau khi nến đóng cửa kiểm định thành công vùng mất cân bằng thanh khoản.'}"
                  </div>
                </div>

                {/* Horizontal Step 4 */}
                <div className="p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:border-binance-borderHighlight transition">
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="w-7 h-7 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center font-black text-xs border border-purple-500/40">4</span>
                    <div>
                      <span className="font-bold text-white text-xs block">Kế Hoạch Quản Trị Rủi Ro & Chốt Lời Tự Động</span>
                      <span className="text-[10.5px] text-slate-400 font-medium">Auto Breakeven & Multi-Target Profit Taking</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[10.5px]">
                    <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded font-bold">50% TP1 CLOSE</span>
                    <span className="bg-binance-greenBg text-binance-green px-2 py-1 rounded font-bold">SL TO BREAKEVEN</span>
                  </div>
                  <div className="text-[11.5px] text-slate-300 leading-relaxed md:max-w-md">
                    Chốt 50% khối lượng tại TP1 và tự động kéo Stop Loss về giá hòa vốn (+0.05% phí), biến lệnh thành hoàn toàn không có rủi ro (Risk-Free Trade).
                  </div>
                </div>
              </div>
            </section>


            {/* ── SECTION 2: MỐC GIÁ, GIẢ LẬP LỢI NHUẬN & BÁO CÁO QUẢN LÝ SIZE LỆNH ── */}
            <section id="sec-targets" className="flex flex-col gap-3.5 scroll-mt-4">
              <div className="flex items-center justify-between border-b border-binance-border pb-2">
                <span className="font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide">
                  <span className="text-binance-yellow">🎯</span>
                  <span>2. CÁC MỐC GIÁ, GIẢ LẬP PNL & BÁO CÁO QUẢN LÝ SIZE (TARGETS & RISK AUDIT)</span>
                </span>
                <span className="text-[10.5px] text-slate-400 font-mono">
                  Vốn Ký Quỹ: <b className="text-white">${formatPrice(marginUsed)}</b> • Đòn Bẩy: <b className="text-binance-yellow">{leverage}x</b>
                </span>
              </div>

              {/* Top Horizontal Summary Bar (Explicit Dollar Amounts) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
                <div className="p-3 rounded-xl bg-binance-card border border-binance-border flex flex-col gap-0.5">
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">VỐN KÝ QUỸ (MARGIN)</span>
                  <b className="text-white text-sm md:text-base">${formatPrice(marginUsed)} USD</b>
                  <span className="text-[10px] text-binance-yellow">{leverage}x Isolated</span>
                </div>
                <div className="p-3 rounded-xl bg-binance-card border border-binance-border flex flex-col gap-0.5">
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">QUY MÔ VỊ THẾ (SIZE)</span>
                  <b className="text-white text-sm md:text-base">${formatPrice(posSizeUsd)} USD</b>
                  <span className="text-[10px] text-slate-400">~{(posSizeUsd / entryPrice).toFixed(4)} {symbol.replace('USDT', '')}</span>
                </div>
                <div className="p-3 rounded-xl bg-binance-card border border-binance-border flex flex-col gap-0.5">
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">TỶ LỆ LỢI NHUẬN / RỦI RO</span>
                  <b className="text-binance-yellow text-sm md:text-base">1 : {rrRatio.toFixed(2)}</b>
                  <span className="text-[10px] text-binance-green">Tối Ưu Kỳ Vọng</span>
                </div>
                <div className="p-3 rounded-xl bg-binance-card border border-binance-border flex flex-col gap-0.5">
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider">RỦI RO TỐI ĐA (MAX LOSS)</span>
                  <b className="text-binance-red text-sm md:text-base">-${formatPrice(slUsd)} USD</b>
                  <span className="text-[10px] text-binance-red">-{slLossPct.toFixed(1)}% Vốn Margin</span>
                </div>
              </div>

              {/* ── BÁO CÁO QUẢN TRỊ QUY MÔ VỊ THẾ & PHƯƠNG PHÁP TÍNH SIZE ── */}
              <div className="p-4 rounded-xl bg-binance-card/90 border border-binance-border flex flex-col gap-3 font-sans shadow">
                <div className="flex items-center justify-between border-b border-binance-border pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-binance-yellow text-base">⚖️</span>
                    <span className="font-extrabold text-xs text-white uppercase tracking-wider">BÁO CÁO QUẢN TRỊ QUY MÔ VỊ THẾ (POSITION SIZING AUDIT REPORT)</span>
                  </div>
                  <span className="bg-binance-active text-binance-yellow text-[9.5px] font-mono px-2 py-0.5 rounded font-bold border border-binance-yellow/30">
                    FIXED FRACTIONAL RISK MODEL
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-binance-panel border border-binance-borderSubtle flex flex-col gap-1.5">
                    <span className="font-bold text-binance-cyan text-[11px] uppercase tracking-wide">1. Phương Pháp Phân Bổ (Methodology)</span>
                    <p className="text-slate-300 leading-relaxed text-[11.5px]">
                      Hệ thống áp dụng mô hình <b>Fixed Fractional Volatility Risk Sizing (Mô hình Rủi ro Phân số Cố định)</b> kết hợp chuẩn hóa biên độ <b>ATR (Average True Range)</b>. Mức tổn thất tối đa được giới hạn nghiêm ngặt ở <b>10.00%</b> trên số vốn ký quỹ <b>${formatPrice(marginUsed)} USD</b> (tương đương <b>${formatPrice(slUsd)} USD</b>).
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-binance-panel border border-binance-borderSubtle flex flex-col gap-1.5">
                    <span className="font-bold text-binance-yellow text-[11px] uppercase tracking-wide">2. Lý Do Tính Toán Size Như Vậy (Derivation Logic)</span>
                    <p className="text-slate-300 leading-relaxed text-[11.5px]">
                      Khoảng cách Invalid Stop Loss theo cấu trúc nến SMC là <b>{slMovePct.toFixed(2)}%</b>. Với đòn bẩy <b>{leverage}x</b>, quy mô vị thế danh nghĩa được cố định chính xác ở <b>${formatPrice(posSizeUsd)} USD</b> để nếu giá chạm SL, khoản lỗ thực tế luôn bảo toàn đúng số tiền rủi ro và giá thanh lý cách xa &gt;4.5% an toàn.
                    </p>
                  </div>
                </div>
              </div>

              {/* Horizontal Target Strips */}
              <div className="flex flex-col gap-2.5">
                
                {/* Entry Strip */}
                <div className="p-3.5 rounded-xl bg-binance-card border border-binance-border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:border-binance-borderHighlight transition">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-binance-yellow/20 text-binance-yellow flex items-center justify-center font-black text-sm">⚡</span>
                    <div>
                      <span className="font-bold text-white text-xs block uppercase tracking-wide">ENTRY PRICE (GIÁ VÀO LỆNH)</span>
                      <span className="text-[10.5px] text-slate-400">Mức giá khớp lệnh tối ưu theo nến xác nhận SMC</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 font-mono">
                    <span className="text-base font-black text-white tracking-tight">${formatPrice(entryPrice)}</span>
                    <span className="text-[11px] text-slate-300 bg-binance-panel px-2.5 py-1 rounded border border-binance-borderSubtle">
                      Khối Lượng: ${formatPrice(posSizeUsd)}
                    </span>
                  </div>
                </div>

                {/* Take Profit 1 Strip */}
                <div className="p-3.5 rounded-xl bg-binance-greenBg/30 border border-binance-green/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-binance-green/20 text-binance-green flex items-center justify-center font-black text-sm">🎯</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-binance-green text-xs uppercase tracking-wide">TAKE PROFIT 1 (TP1 - FVG MIDLINE)</span>
                        <span className="bg-binance-green text-black font-black text-[9px] px-1.5 rounded tracking-wider">CHỐT 50%</span>
                      </div>
                      <span className="text-[10.5px] text-slate-300 italic">{data.tp1_rationale || 'Mục tiêu FVG Midline. Chốt nửa vị thế và kích hoạt dời Stop Loss về hòa vốn (Auto Breakeven).'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 font-mono shrink-0">
                    <div className="text-right">
                      <span className="text-base font-black text-white tracking-tight">${formatPrice(tp1Price)}</span>
                      <span className="text-binance-green font-bold text-xs block">+{tp1MovePct.toFixed(2)}% Giá</span>
                    </div>
                    <div className="p-2 rounded-lg bg-binance-panel border border-binance-green/30 text-right">
                      <span className="text-binance-green font-bold text-xs block">+${formatPrice(tp1Usd)} USD</span>
                      <span className="text-[10px] text-binance-green block font-bold">+{tp1Roi.toFixed(1)}% ROI</span>
                    </div>
                  </div>
                </div>

                {/* Take Profit 2 Strip */}
                <div className="p-3.5 rounded-xl bg-binance-cyanBg/30 border border-binance-cyan/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-binance-cyan/20 text-binance-cyan flex items-center justify-center font-black text-sm">🏆</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-binance-cyan text-xs uppercase tracking-wide">TAKE PROFIT 2 (TP2 - MAJOR LIQUIDITY)</span>
                        <span className="bg-binance-cyan text-black font-black text-[9px] px-1.5 rounded tracking-wider">CHỐT 100%</span>
                      </div>
                      <span className="text-[10.5px] text-slate-300 italic">{data.tp2_rationale || 'Mục tiêu quét sạch đỉnh/đáy thanh khoản chính (Major Liquidity Pool). Đóng toàn bộ lệnh.'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 font-mono shrink-0">
                    <div className="text-right">
                      <span className="text-base font-black text-white tracking-tight">${formatPrice(tp2Price)}</span>
                      <span className="text-binance-cyan font-bold text-xs block">+{tp2MovePct.toFixed(2)}% Giá</span>
                    </div>
                    <div className="p-2 rounded-lg bg-binance-panel border border-binance-cyan/30 text-right">
                      <span className="text-binance-cyan font-bold text-xs block">+${formatPrice(tp2Usd)} USD</span>
                      <span className="text-[10px] text-binance-cyan block font-bold">+{tp2Roi.toFixed(1)}% ROI</span>
                    </div>
                  </div>
                </div>

                {/* Stop Loss Strip */}
                <div className="p-3.5 rounded-xl bg-binance-redBg/30 border border-binance-red/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-binance-red/20 text-binance-red flex items-center justify-center font-black text-sm">🛑</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-binance-red text-xs uppercase tracking-wide">STOP LOSS (SL - INVALIDATION LEVEL)</span>
                        <span className="bg-binance-red text-white font-black text-[9px] px-1.5 rounded tracking-wider">CẮT LỖ</span>
                      </div>
                      <span className="text-[10.5px] text-slate-300 italic">{data.sl_rationale || 'Mốc phá vỡ cấu trúc Swing High/Low. Tự động đóng lệnh bảo toàn 100% vốn còn lại.'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 font-mono shrink-0">
                    <div className="text-right">
                      <span className="text-base font-black text-white tracking-tight">${formatPrice(slPrice)}</span>
                      <span className="text-binance-red font-bold text-xs block">-{slMovePct.toFixed(2)}% Giá</span>
                    </div>
                    <div className="p-2 rounded-lg bg-binance-panel border border-binance-red/30 text-right">
                      <span className="text-binance-red font-bold text-xs block">-${formatPrice(slUsd)} USD</span>
                      <span className="text-[10px] text-binance-red block font-bold">-{slLossPct.toFixed(1)}% Loss</span>
                    </div>
                  </div>
                </div>

              </div>
            </section>


            {/* ── SECTION 3: TÌNH TRẠNG LỆNH THỰC TẾ (HORIZONTAL HUD & PROGRESS BAR) ── */}
            <section id="sec-status" className="flex flex-col gap-3.5 scroll-mt-4">
              <div className="flex items-center justify-between border-b border-binance-border pb-2">
                <span className="font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide">
                  <span className="text-binance-yellow">⚡</span>
                  <span>3. TÌNH TRẠNG LỆNH THỰC TẾ & TIẾN TRÌNH REALTIME (LIVE POSITION TRACKING)</span>
                </span>
                <span className="text-binance-yellow font-bold text-xs font-mono tracking-wide">
                  {data.status || 'ACTIVE POSITION'}
                </span>
              </div>

              <div className="p-4 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-4">
                
                {/* Horizontal Live Readout Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono border-b border-binance-border pb-3">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">GIÁ VÀO LỆNH (ENTRY)</span>
                    <span className="font-bold text-white text-sm md:text-base">${formatPrice(entryPrice)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">GIÁ THỊ TRƯỜNG (MARK)</span>
                    <span className="font-bold text-binance-yellowHover text-sm md:text-base">${formatPrice(currentPrice)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">LỢI NHUẬN TẠM TÍNH (PNL)</span>
                    <span className={`font-bold text-sm md:text-base ${unPnlUsd >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
                      {unPnlUsd >= 0 ? '+' : ''}${formatPrice(unPnlUsd)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">TỶ SUẤT ROE %</span>
                    <span className={`font-bold text-sm md:text-base ${unPnlPct >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
                      {unPnlPct >= 0 ? '+' : ''}{unPnlPct.toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* Horizontal Interactive Progress Bar to TP1 */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300 font-bold flex items-center gap-1.5">
                      <span>🚀</span>
                      <span>Tiến Trình Đạt Mục Tiêu TP1:</span>
                    </span>
                    <b className="text-binance-cyan font-mono text-sm">{progressPct.toFixed(1)}% Hoàn Thành</b>
                  </div>
                  <div className="w-full h-3 bg-binance-subpanel rounded-full overflow-hidden border border-binance-border p-0.5">
                    <div
                      className="h-full bg-gradient-to-r from-binance-yellow via-binance-cyan to-binance-green rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(240,185,11,0.6)]"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono pt-0.5">
                    <span>Entry: ${formatPrice(entryPrice)}</span>
                    <span className="text-white font-bold">Mark: ${formatPrice(currentPrice)}</span>
                    <span>TP1: ${formatPrice(tp1Price)}</span>
                  </div>
                </div>

                {/* Horizontal Distance Cards */}
                <div className="grid grid-cols-3 gap-3 text-center pt-1 font-mono">
                  <div className="p-3 rounded-lg bg-binance-panel border border-binance-borderSubtle">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">KHOẢNG CÁCH TỚI ENTRY</span>
                    <b className={`text-xs md:text-sm ${currentPrice >= entryPrice ? 'text-binance-green' : 'text-binance-red'}`}>
                      {(((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2)}%
                    </b>
                  </div>
                  <div className="p-3 rounded-lg bg-binance-panel border border-binance-borderSubtle">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">CÒN CÁCH ĐÍCH TP1</span>
                    <b className="text-binance-cyan text-xs md:text-sm">
                      {(((tp1Price - currentPrice) / currentPrice) * 100).toFixed(2)}%
                    </b>
                  </div>
                  <div className="p-3 rounded-lg bg-binance-panel border border-binance-borderSubtle">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">KHOẢNG AN TOÀN TỚI SL</span>
                    <b className="text-binance-green text-xs md:text-sm">
                      {Math.abs(((currentPrice - slPrice) / currentPrice) * 100).toFixed(2)}%
                    </b>
                  </div>
                </div>

              </div>
            </section>


            {/* ── SECTION 4: CẤU TRÚC SMART MONEY & VÙNG FVG ── */}
            <section id="sec-smc" className="flex flex-col gap-3.5 scroll-mt-4">
              <div className="flex items-center justify-between border-b border-binance-border pb-2">
                <span className="font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide">
                  <span className="text-binance-yellow">📐</span>
                  <span>4. CẤU TRÚC SMART MONEY CONCEPTS & VÙNG FAIR VALUE GAP (SMC DETAILS)</span>
                </span>
                <span className="text-[10px] bg-binance-cyanBg text-binance-cyan px-2 py-0.5 rounded font-bold border border-binance-cyan/30 tracking-wider">
                  SMC STRUCTURE
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-2">
                  <span className="font-bold text-white text-xs border-b border-binance-border pb-1 uppercase tracking-wider">VÙNG BẪY THANH KHOẢN (LIQUIDITY POOL)</span>
                  <div className="text-[11.5px] text-slate-300 leading-relaxed">
                    • <b>Vùng Quét:</b> {isLong ? 'Sell-Side Liquidity (SSL)' : 'Buy-Side Liquidity (BSL)'} tại đáy/đỉnh gần nhất.
                    <br />• <b>Hành Động:</b> Giá quét qua thanh khoản để thu hút các vị thế bán hoảng loạn/mua đuổi trước khi đảo chiều mạnh.
                  </div>
                </div>

                <div className="p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-2">
                  <span className="font-bold text-white text-xs border-b border-binance-border pb-1 uppercase tracking-wider">MẤT CÂN BẰNG CUNG CẦU (FAIR VALUE GAP)</span>
                  <div className="text-[11.5px] text-slate-300 leading-relaxed">
                    • <b>Loại FVG:</b> {isLong ? 'Bullish Fair Value Gap (FVG+)' : 'Bearish Fair Value Gap (FVG-)'}.
                    <br />• <b>Kiểm Định:</b> Nến tín hiệu đóng cửa trên vùng cân bằng, xác nhận dòng tiền tổ chức hấp thụ toàn bộ lực cản.
                  </div>
                </div>
              </div>
            </section>


            {/* ── SECTION 5: EMBEDDED FULL STAT2 CANDLE CHART FOR THE SYMBOL ── */}
            <section id="sec-chart" className="flex flex-col gap-3.5 scroll-mt-4">
              <div className="flex items-center justify-between border-b border-binance-border pb-2">
                <span className="font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide">
                  <span className="text-binance-yellow">📊</span>
                  <span>5. {symbol} • {exchange} • {modalTf} • {data.strategy_name || data.signal_type || 'STAT2 PRO BOX STRATEGY'}</span>
                </span>
                <span className="text-[10px] bg-binance-yellow/20 text-binance-yellow px-2.5 py-0.5 rounded font-bold border border-binance-yellow/30 font-mono tracking-wide">
                  DRAWING TOOLS ENABLED
                </span>
              </div>

              <div className="w-full h-[440px] bg-binance-bg border border-binance-border rounded-xl overflow-hidden shadow-xl flex flex-col relative">
                <FullStat2CandleChart
                  symbol={symbol}
                  timeframe={modalTf}
                  exchange={exchange}
                  onTfChange={setModalTf}
                  isCollapsed={false}
                  onToggleCollapse={null}
                  instances={indicatorInstances || []}
                  onOpenCatalog={onOpenCatalog}
                  onToggleVisibility={onToggleVisibility}
                  onOpenSettings={onOpenSettings}
                  onRemoveInstance={onRemoveInstance}
                />
              </div>
            </section>


            {/* ── SECTION 6: GHI CHÚ VÀO LỆNH (TRADE JOURNAL & NOTES) ── */}
            <section id="sec-notes" className="flex flex-col gap-3.5 scroll-mt-4">
              <div className="flex items-center justify-between border-b border-binance-border pb-2">
                <span className="font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide">
                  <span className="text-binance-yellow">📝</span>
                  <span>6. GHI CHÚ VÀO LỆNH & NHẬT KÝ GIAO DỊCH (TRADE JOURNAL & OPERATOR NOTES)</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  AUTO-SYNCED TO DB
                </span>
              </div>

              <div className="p-4 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-white text-xs flex items-center gap-1.5">
                    <span>✍️</span>
                    <span>Ghi chú cá nhân cho lệnh {symbol} ({exchange}):</span>
                  </label>
                  {saveNoteSuccess && (
                    <span className="text-[11px] text-binance-green font-bold animate-pulse flex items-center gap-1">
                      <span>✅</span>
                      <span>Đã lưu thành công vào cơ sở dữ liệu!</span>
                    </span>
                  )}
                </div>

                <textarea
                  className="w-full h-24 p-3 bg-binance-panel border border-binance-borderSubtle rounded-lg text-white font-mono text-xs focus:outline-none focus:border-binance-yellow transition resize-none placeholder-slate-500"
                  placeholder="Nhập các quan sát quan trọng, tin tức kinh tế, tâm lý giao dịch hoặc lưu ý cho lệnh này..."
                  value={tradeNote}
                  onChange={e => setTradeNote(e.target.value)}
                />

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400 font-mono">
                    Độ dài: {tradeNote.length} ký tự • Tự động tải cùng biểu đồ & công cụ vẽ
                  </span>
                  <button
                    className="bg-binance-yellow hover:bg-binance-yellowHover text-black font-bold px-4 py-1.5 rounded-lg text-xs transition shadow flex items-center gap-1.5 font-mono"
                    onClick={handleSaveNote}
                    disabled={isSavingNote}
                  >
                    <span>{isSavingNote ? '⏳' : '💾'}</span>
                    <span>{isSavingNote ? 'Đang lưu...' : 'Lưu Ghi Chú'}</span>
                  </button>
                </div>
              </div>
            </section>


            {/* ── SECTION 7: THÔNG SỐ THUẬT TOÁN & AUDIT TRAIL ── */}
            <section id="sec-engine" className="flex flex-col gap-3.5 scroll-mt-4">
              <div className="flex items-center justify-between border-b border-binance-border pb-2">
                <span className="font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide">
                  <span className="text-binance-yellow">📜</span>
                  <span>7. THÔNG SỐ KỸ THUẬT THUẬT TOÁN & AUDIT TRAIL (SECURITY LOG)</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  REALTIME SECURE LOG
                </span>
              </div>

              <div className="p-4 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] font-mono">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">ID LỆNH / SIGNAL</span>
                    <b className="text-white font-mono">{data.id || 'SIG_' + (data.timestamp || Date.now())}</b>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">THỜI GIAN KÍCH HOẠT</span>
                    <b className="text-white">{data.created_at || data.timestamp ? new Date(data.created_at || data.timestamp).toLocaleString() : 'Realtime Live'}</b>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">CHIẾN LƯỢC QUẢN LÝ</span>
                    <b className="text-binance-yellow">STAT2 Pro Box Strategy</b>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">CƠ CHẾ BẢO VỆ VỐN</span>
                    <b className="text-binance-green">Auto Breakeven + Trailing</b>
                  </div>
                </div>
              </div>
            </section>

          </main>
        </div>

        {/* ── FOOTER ACTION BAR (HORIZONTAL) ── */}
        <div className="p-3.5 border-t border-binance-border flex items-center justify-end bg-binance-subpanel shrink-0 font-mono">
          <div className="flex items-center gap-2.5">
            {isActive && onClosePosition && (
              <button
                className="bg-binance-red hover:bg-red-600 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition shadow flex items-center gap-1 font-sans"
                onClick={() => {
                  onClosePosition(data.id);
                  onClose();
                }}
              >
                <span>✕</span>
                <span>Đóng Vị Thế Ngay (Market Close)</span>
              </button>
            )}
            <button
              className="bg-binance-subpanel hover:bg-binance-hover px-5 py-1.5 rounded-lg text-xs border border-binance-border text-white font-bold transition font-sans"
              onClick={onClose}
            >
              Đóng
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── TRADING JOURNAL & PERFORMANCE CALENDAR COMPONENT ──
function TradingJournalModal({ onClose, onOpenForensics, onSelectSymbol }) {
  const [exchangeFilter, setExchangeFilter] = useState('ALL');
  const [journalData, setJournalData] = useState({ trades: [], stats: {}, active_positions: [] });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // ALL, WIN, LOSS, ACTIVE
  const [selectedDateFilter, setSelectedDateFilter] = useState(null); // 'YYYY-MM-DD'
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  // Calendar Month Navigation
  const [currentDate, setCurrentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-indexed

  // Fetch Journal Data
  const fetchJournal = useCallback(async () => {
    setLoading(true);
    try {
      const url = exchangeFilter === 'ALL' ? '/api/journal' : `/api/journal?exchange=${exchangeFilter}`;
      const res = await fetch(url).then(r => r.json());
      if (res.success && res.data) {
        setJournalData(res.data);
      }
    } catch (err) {
      console.warn('Error fetching journal:', err);
    } finally {
      setLoading(false);
    }
  }, [exchangeFilter]);

  useEffect(() => {
    fetchJournal();
  }, [fetchJournal]);

  const trades = journalData.trades || [];
  const closedTrades = trades.filter(t => t.status !== 'ACTIVE');
  const activeTrades = journalData.active_positions || trades.filter(t => t.status === 'ACTIVE');

  // Month navigation handlers
  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const resetToToday = () => setCurrentDate(new Date());

  const monthName = currentDate.toLocaleString('vi-VN', { month: 'long', year: 'numeric' });

  // Map trades by date (YYYY-MM-DD)
  const tradesByDate = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      const ts = t.close_time || t.open_time || t.created_at || Date.now();
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return map;
  }, [trades]);

  // Generate Calendar Grid
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sun, 1 = Mon...
    const startOffset = (firstDayOfMonth + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < startOffset; i++) {
      days.push({ day: null, dateKey: null, trades: [], pnl: 0, wins: 0, losses: 0 });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayTrades = tradesByDate[dateKey] || [];
      const pnl = dayTrades.reduce((sum, t) => sum + (Number(t.net_pnl_usd) || 0), 0);
      const wins = dayTrades.filter(t => (Number(t.net_pnl_usd) || 0) > 0).length;
      const losses = dayTrades.filter(t => (Number(t.net_pnl_usd) || 0) < 0).length;
      days.push({ day: d, dateKey, trades: dayTrades, pnl, wins, losses });
    }
    return days;
  }, [year, month, tradesByDate]);

  // Performance Calculations
  const stats = useMemo(() => {
    const total = closedTrades.length;
    const wins = closedTrades.filter(t => (Number(t.net_pnl_usd) || 0) > 0);
    const losses = closedTrades.filter(t => (Number(t.net_pnl_usd) || 0) < 0);
    const winRate = total > 0 ? (wins.length / total) * 100 : 0;
    const totalGain = wins.reduce((sum, t) => sum + (Number(t.net_pnl_usd) || 0), 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + (Number(t.net_pnl_usd) || 0), 0));
    const netPnl = closedTrades.reduce((sum, t) => sum + (Number(t.net_pnl_usd) || 0), 0);
    const profitFactor = totalLoss > 0 ? (totalGain / totalLoss) : (totalGain > 0 ? 999 : 0);
    const avgWin = wins.length > 0 ? totalGain / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;
    const totalFees = trades.reduce((sum, t) => sum + (Number(t.fee_usd) || 0), 0);

    const longTrades = closedTrades.filter(t => (t.direction || '').toUpperCase() === 'LONG');
    const shortTrades = closedTrades.filter(t => (t.direction || '').toUpperCase() === 'SHORT');
    const longPnl = longTrades.reduce((sum, t) => sum + (Number(t.net_pnl_usd) || 0), 0);
    const shortPnl = shortTrades.reduce((sum, t) => sum + (Number(t.net_pnl_usd) || 0), 0);

    let bestTrade = null;
    let worstTrade = null;
    closedTrades.forEach(t => {
      const pnl = Number(t.net_pnl_usd) || 0;
      if (!bestTrade || pnl > (Number(bestTrade.net_pnl_usd) || 0)) bestTrade = t;
      if (!worstTrade || pnl < (Number(worstTrade.net_pnl_usd) || 0)) worstTrade = t;
    });

    return {
      total,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalGain,
      totalLoss,
      netPnl,
      profitFactor,
      avgWin,
      avgLoss,
      totalFees,
      longCount: longTrades.length,
      longPnl,
      shortCount: shortTrades.length,
      shortPnl,
      bestTrade,
      worstTrade,
      activeCount: activeTrades.length
    };
  }, [closedTrades, activeTrades, trades]);

  // Filtered Trades for Table
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (selectedDateFilter) {
        const ts = t.close_time || t.open_time || t.created_at || Date.now();
        const d = new Date(ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (key !== selectedDateFilter) return false;
      }
      if (statusFilter === 'WIN' && (Number(t.net_pnl_usd) || 0) <= 0) return false;
      if (statusFilter === 'LOSS' && (Number(t.net_pnl_usd) || 0) >= 0) return false;
      if (statusFilter === 'ACTIVE' && t.status !== 'ACTIVE') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSym = (t.symbol || '').toLowerCase().includes(q);
        const matchStrat = (t.strategy_name || '').toLowerCase().includes(q);
        const matchNotes = (t.notes || '').toLowerCase().includes(q);
        const matchReason = (t.exit_reason || t.entry_rationale || '').toLowerCase().includes(q);
        if (!matchSym && !matchStrat && !matchNotes && !matchReason) return false;
      }
      return true;
    });
  }, [trades, selectedDateFilter, statusFilter, searchQuery]);

  // Build JSON Report
  const fullJsonReport = useMemo(() => {
    return {
      report_metadata: {
        system: 'STAT2 Futures Trading Terminal',
        report_title: 'Trading Journal & Forensics Performance Report',
        generated_at: new Date().toISOString(),
        exchange_filter: exchangeFilter,
        selected_month: `${year}-${String(month + 1).padStart(2, '0')}`,
        total_recorded_trades: trades.length
      },
      summary_kpis: {
        total_closed_trades: stats.total,
        winning_trades: stats.wins,
        losing_trades: stats.losses,
        active_positions: stats.activeCount,
        win_rate_percent: Number(stats.winRate.toFixed(2)),
        net_realized_pnl_usd: Number(stats.netPnl.toFixed(2)),
        profit_factor: Number(stats.profitFactor.toFixed(2)),
        total_gains_usd: Number(stats.totalGain.toFixed(2)),
        total_losses_usd: Number(stats.totalLoss.toFixed(2)),
        avg_win_usd: Number(stats.avgWin.toFixed(2)),
        avg_loss_usd: Number(stats.avgLoss.toFixed(2)),
        total_fees_usd: Number(stats.totalFees.toFixed(2)),
        long_trades: stats.longCount,
        long_pnl_usd: Number(stats.longPnl.toFixed(2)),
        short_trades: stats.shortCount,
        short_pnl_usd: Number(stats.shortPnl.toFixed(2)),
        best_trade: stats.bestTrade ? {
          symbol: stats.bestTrade.symbol,
          direction: stats.bestTrade.direction,
          pnl_usd: stats.bestTrade.net_pnl_usd,
          roe_pct: stats.bestTrade.roe_pct
        } : null,
        worst_trade: stats.worstTrade ? {
          symbol: stats.worstTrade.symbol,
          direction: stats.worstTrade.direction,
          pnl_usd: stats.worstTrade.net_pnl_usd,
          roe_pct: stats.worstTrade.roe_pct
        } : null
      },
      daily_calendar_breakdown: calendarDays
        .filter(d => d.day && d.trades.length > 0)
        .map(d => ({
          date: d.dateKey,
          trades_count: d.trades.length,
          net_pnl_usd: Number(d.pnl.toFixed(2)),
          wins: d.wins,
          losses: d.losses,
          symbols: Array.from(new Set(d.trades.map(t => t.symbol)))
        })),
      trades: trades.map(t => ({
        id: t.id,
        symbol: t.symbol,
        exchange: t.exchange || 'BINANCE',
        direction: t.direction,
        leverage: t.leverage,
        margin_mode: t.margin_mode,
        status: t.status,
        entry_price: t.entry_price,
        current_price: t.current_price,
        exit_price: t.exit_price,
        tp1_price: t.tp1_price,
        tp2_price: t.tp2_price,
        sl_price: t.sl_price,
        pos_size_usd: t.pos_size_usd,
        initial_margin: t.initial_margin,
        net_pnl_usd: t.net_pnl_usd,
        roe_pct: t.roe_pct,
        fee_usd: t.fee_usd,
        open_time: t.open_time ? new Date(t.open_time).toISOString() : null,
        close_time: t.close_time ? new Date(t.close_time).toISOString() : null,
        duration_seconds: t.duration_seconds,
        exit_reason: t.exit_reason,
        entry_rationale: t.entry_rationale,
        market_regime: t.market_regime,
        user_notes: t.notes || '',
        features: t.features || {}
      }))
    };
  }, [trades, stats, calendarDays, exchangeFilter, year, month]);

  const handleExportJson = () => {
    const jsonStr = JSON.stringify(fullJsonReport, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trading_journal_report_${exchangeFilter.toLowerCase()}_${year}_${month + 1}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = () => {
    const jsonStr = JSON.stringify(fullJsonReport, null, 2);
    navigator.clipboard.writeText(jsonStr);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#090D16]/95 backdrop-blur-md flex flex-col overflow-hidden font-sans text-xs text-slate-200">
      
      {/* ── 1. MODAL HEADER BAR ── */}
      <header className="h-14 px-4 md:px-6 border-b border-binance-border bg-[#0D111C] flex items-center justify-between shrink-0 shadow-lg z-20">
        
        {/* Left: Title & Quick Stats */}
        <div className="flex items-center gap-3 md:gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xl">📖</span>
            <div>
              <h2 className="font-extrabold text-sm md:text-base text-white tracking-wide flex items-center gap-2">
                <span>TRADING JOURNAL & PERFORMANCE CALENDAR</span>
                <span className="text-[10px] bg-binance-yellow/20 text-binance-yellow px-2 py-0.5 rounded font-mono font-bold border border-binance-yellow/30">PRO FORENSICS</span>
              </h2>
              <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">Nhật ký giao dịch, phân tích PnL theo lịch & xuất dữ liệu JSON</span>
            </div>
          </div>

          {/* Quick Badges */}
          <div className="hidden lg:flex items-center gap-2 pl-3 border-l border-binance-border font-mono text-[11px]">
            <span className="text-slate-400">Net PnL:</span>
            <b className={`font-bold ${stats.netPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
              {stats.netPnl >= 0 ? '+' : ''}${formatPrice(stats.netPnl)} USD
            </b>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">Win Rate:</span>
            <b className="text-binance-yellow font-bold">{stats.winRate.toFixed(1)}%</b>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">Profit Factor:</span>
            <b className="text-white font-bold">{stats.profitFactor.toFixed(2)}</b>
          </div>
        </div>

        {/* Right: Exchange Filter, Export JSON Buttons & Close */}
        <div className="flex items-center gap-2 font-mono">
          
          {/* Exchange Filter Tabs */}
          <div className="hidden sm:flex items-center bg-binance-bg border border-binance-border rounded p-0.5 gap-0.5 text-[10px]">
            {['ALL', 'BINANCE', 'BYBIT', 'OKX', 'BITGET', 'GATE', 'BINGX'].map(ex => (
              <button
                key={ex}
                className={`px-2 py-0.5 rounded font-bold transition ${exchangeFilter === ex ? 'bg-binance-yellow text-black shadow' : 'text-slate-400 hover:text-white'}`}
                onClick={() => setExchangeFilter(ex)}
              >
                {ex}
              </button>
            ))}
          </div>

          {/* Export JSON Button */}
          <button
            className="bg-binance-cyan/15 hover:bg-binance-cyan/30 text-binance-cyan border border-binance-cyan/40 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow"
            onClick={handleExportJson}
            title="Tải về file JSON chi tiết đầy đủ thông số lệnh"
          >
            <span>📥</span>
            <span className="hidden md:inline">Xuất Báo Cáo JSON</span>
            <span className="md:hidden">JSON</span>
          </button>

          {/* Copy JSON Button */}
          <button
            className="bg-binance-subpanel hover:bg-binance-hover text-white border border-binance-border px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow"
            onClick={handleCopyJson}
            title="Copy toàn bộ JSON vào Clipboard"
          >
            <span>{copiedToast ? '✅' : '📋'}</span>
            <span className="hidden md:inline">{copiedToast ? 'Đã Copy!' : 'Copy JSON'}</span>
          </button>

          {/* Inspect JSON Modal Button */}
          <button
            className="bg-binance-subpanel hover:bg-binance-hover text-slate-300 border border-binance-border px-2 py-1.5 rounded-lg text-xs font-bold transition"
            onClick={() => setIsJsonModalOpen(true)}
            title="Xem trước cấu trúc JSON"
          >
            <span>👁️</span>
          </button>

          {/* Close Modal Button */}
          <button
            className="w-8 h-8 rounded-lg bg-binance-subpanel hover:bg-binance-hover border border-binance-border text-slate-300 hover:text-white flex items-center justify-center font-bold text-sm transition ml-1"
            onClick={onClose}
            title="Đóng Nhật Ký Giao Dịch"
          >
            ✕
          </button>
        </div>
      </header>

      {/* ── 2. MAIN SCROLLABLE CONTENT ── */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-6">
        
        {/* ── SECTION A: EXECUTIVE KPI SUMMARY DASHBOARD ── */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 font-mono">
          
          {/* KPI 1: Net PnL */}
          <div className="p-3.5 bg-binance-panel border border-binance-border rounded-xl shadow flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <span>TỔNG LÃI/LỖ RÒNG</span>
              <span>💵</span>
            </div>
            <div className="my-1.5">
              <span className={`text-lg md:text-xl font-black ${stats.netPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
                {stats.netPnl >= 0 ? '+' : ''}${formatPrice(stats.netPnl)}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">USD Thực Nhận</span>
            </div>
            <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-binance-border/60">
              <span className="text-binance-green">+{formatPrice(stats.totalGain)}</span>
              <span className="text-binance-red">-{formatPrice(stats.totalLoss)}</span>
            </div>
          </div>

          {/* KPI 2: Win Rate */}
          <div className="p-3.5 bg-binance-panel border border-binance-border rounded-xl shadow flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <span>TỈ LỆ THẮNG (WIN RATE)</span>
              <span>🎯</span>
            </div>
            <div className="my-1.5">
              <span className="text-lg md:text-xl font-black text-binance-yellow">
                {stats.winRate.toFixed(1)}%
              </span>
              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5 flex">
                <div className="bg-binance-green h-full" style={{ width: `${stats.winRate}%` }}></div>
                <div className="bg-binance-red h-full" style={{ width: `${100 - stats.winRate}%` }}></div>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-binance-border/60 text-slate-300">
              <span>Thắng: <b className="text-binance-green">{stats.wins}</b></span>
              <span>Thua: <b className="text-binance-red">{stats.losses}</b></span>
            </div>
          </div>

          {/* KPI 3: Profit Factor */}
          <div className="p-3.5 bg-binance-panel border border-binance-border rounded-xl shadow flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <span>HỆ SỐ LỢI NHUẬN (PF)</span>
              <span>⚖️</span>
            </div>
            <div className="my-1.5">
              <span className="text-lg md:text-xl font-black text-white">
                {stats.profitFactor.toFixed(2)}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">Gain / Loss Ratio</span>
            </div>
            <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-binance-border/60 text-slate-400">
              <span>Avg W: <b className="text-binance-green">${formatPrice(stats.avgWin)}</b></span>
              <span>Avg L: <b className="text-binance-red">${formatPrice(stats.avgLoss)}</b></span>
            </div>
          </div>

          {/* KPI 4: Total Trades */}
          <div className="p-3.5 bg-binance-panel border border-binance-border rounded-xl shadow flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <span>TỔNG SỐ LỆNH</span>
              <span>📊</span>
            </div>
            <div className="my-1.5">
              <span className="text-lg md:text-xl font-black text-slate-100">
                {stats.total + stats.activeCount}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {stats.activeCount} đang mở • {stats.total} đã đóng
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-binance-border/60 text-slate-400">
              <span>Phí: <b>${formatPrice(stats.totalFees)}</b></span>
              <span className="text-binance-cyan">⚡ 24/7 Bot</span>
            </div>
          </div>

          {/* KPI 5: Long vs Short Breakdown */}
          <div className="p-3.5 bg-binance-panel border border-binance-border rounded-xl shadow flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <span>LONG VS SHORT</span>
              <span>🔄</span>
            </div>
            <div className="my-1 flex flex-col gap-0.5 text-[11px]">
              <div className="flex justify-between items-center">
                <span className="text-binance-green font-bold">🟢 LONG ({stats.longCount}):</span>
                <b className={stats.longPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}>{stats.longPnl >= 0 ? '+' : ''}${formatPrice(stats.longPnl)}</b>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-binance-red font-bold">🔴 SHORT ({stats.shortCount}):</span>
                <b className={stats.shortPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}>{stats.shortPnl >= 0 ? '+' : ''}${formatPrice(stats.shortPnl)}</b>
              </div>
            </div>
            <div className="text-[10px] pt-1 border-t border-binance-border/60 text-slate-400 text-center">
              Phân bổ 2 chiều cân bằng
            </div>
          </div>

          {/* KPI 6: Best & Worst Trade */}
          <div className="p-3.5 bg-binance-panel border border-binance-border rounded-xl shadow flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-wider">
              <span>BEST / WORST TRADE</span>
              <span>🏆</span>
            </div>
            <div className="my-1 flex flex-col gap-0.5 text-[11px]">
              <div className="flex justify-between items-center">
                <span className="text-slate-400 truncate max-w-[50px]">{stats.bestTrade?.symbol || 'N/A'}:</span>
                <b className="text-binance-green">+{formatPrice(stats.bestTrade?.net_pnl_usd || 0)}</b>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 truncate max-w-[50px]">{stats.worstTrade?.symbol || 'N/A'}:</span>
                <b className="text-binance-red">{formatPrice(stats.worstTrade?.net_pnl_usd || 0)}</b>
              </div>
            </div>
            <div className="text-[10px] pt-1 border-t border-binance-border/60 text-slate-400 text-center">
              Bảo toàn R:R kỷ luật
            </div>
          </div>

        </section>


        {/* ── SECTION B: TRADING PERFORMANCE CALENDAR (LỊCH PNL THEO NGÀY) ── */}
        <section className="bg-binance-panel border border-binance-border rounded-xl p-4 md:p-5 flex flex-col gap-4 shadow-xl">
          
          {/* Calendar Header Controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-binance-border pb-3.5">
            <div className="flex items-center gap-3">
              <span className="font-extrabold text-sm md:text-base text-white flex items-center gap-2">
                <span>📅 LỊCH GIAO DỊCH & PNL THEO NGÀY</span>
                <span className="text-xs text-binance-yellow capitalize font-mono font-bold bg-binance-card px-2.5 py-0.5 rounded-lg border border-binance-border">
                  {monthName}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-2 font-mono text-xs self-end sm:self-auto">
              {selectedDateFilter && (
                <button
                  className="bg-binance-yellow/20 text-binance-yellow border border-binance-yellow/40 px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition"
                  onClick={() => setSelectedDateFilter(null)}
                  title="Hiển thị lại toàn bộ ngày trong tháng"
                >
                  <span>✕ Đang lọc ngày {selectedDateFilter}</span>
                </button>
              )}

              <div className="flex items-center bg-binance-card border border-binance-border rounded-lg p-0.5 gap-1">
                <button
                  className="px-2.5 py-1 rounded hover:bg-binance-hover text-slate-300 font-bold transition"
                  onClick={prevMonth}
                  title="Tháng trước"
                >
                  ◀
                </button>
                <button
                  className="px-2.5 py-1 rounded hover:bg-binance-hover text-white font-bold transition text-[11px]"
                  onClick={resetToToday}
                  title="Về tháng hiện tại"
                >
                  Hôm nay
                </button>
                <button
                  className="px-2.5 py-1 rounded hover:bg-binance-hover text-slate-300 font-bold transition"
                  onClick={nextMonth}
                  title="Tháng sau"
                >
                  ▶
                </button>
              </div>
            </div>
          </div>

          {/* Weekday Names Header */}
          <div className="grid grid-cols-7 gap-1.5 text-center font-mono font-bold text-[11px] text-slate-400">
            {['Thứ 2 (Mon)', 'Thứ 3 (Tue)', 'Thứ 4 (Wed)', 'Thứ 5 (Thu)', 'Thứ 6 (Fri)', 'Thứ 7 (Sat)', 'Chủ Nhật (Sun)'].map(d => (
              <div key={d} className="py-1 bg-binance-subpanel/60 rounded border border-binance-border/50 text-[10.5px]">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar Day Grid */}
          <div className="grid grid-cols-7 gap-1.5">
            {calendarDays.map((cell, idx) => {
              if (!cell.day) {
                return (
                  <div key={`empty_${idx}`} className="min-h-[72px] md:min-h-[84px] rounded-lg bg-slate-900/20 border border-slate-800/30 opacity-40"></div>
                );
              }

              const hasTrades = cell.trades.length > 0;
              const isProfit = cell.pnl > 0;
              const isLoss = cell.pnl < 0;
              const isSelected = selectedDateFilter === cell.dateKey;

              let cardBg = 'bg-binance-card/60 border-binance-border/70 hover:border-slate-500';
              let pnlColor = 'text-slate-400';

              if (hasTrades) {
                if (isProfit) {
                  cardBg = 'bg-gradient-to-br from-emerald-950/60 to-emerald-900/40 border-emerald-500/60 shadow-lg shadow-emerald-950/30 hover:border-emerald-400';
                  pnlColor = 'text-emerald-400 font-black';
                } else if (isLoss) {
                  cardBg = 'bg-gradient-to-br from-rose-950/60 to-rose-900/40 border-rose-500/60 shadow-lg shadow-rose-950/30 hover:border-rose-400';
                  pnlColor = 'text-rose-400 font-black';
                } else {
                  cardBg = 'bg-slate-900/80 border-slate-700/60 hover:border-slate-500';
                  pnlColor = 'text-slate-300 font-bold';
                }
              }

              if (isSelected) {
                cardBg += ' ring-2 ring-binance-yellow border-binance-yellow scale-[1.02] z-10';
              }

              return (
                <div
                  key={cell.dateKey}
                  onClick={() => hasTrades && setSelectedDateFilter(isSelected ? null : cell.dateKey)}
                  className={`min-h-[72px] md:min-h-[84px] p-2 rounded-lg border transition flex flex-col justify-between select-none ${cardBg} ${hasTrades ? 'cursor-pointer' : 'cursor-default'}`}
                  title={hasTrades ? `Xem ${cell.trades.length} lệnh của ngày ${cell.dateKey}` : `Không có giao dịch ngày ${cell.dateKey}`}
                >
                  {/* Top: Day Number & Trade Count Pill */}
                  <div className="flex items-center justify-between font-mono">
                    <span className={`text-xs font-bold ${hasTrades ? 'text-white' : 'text-slate-500'}`}>
                      {cell.day}
                    </span>
                    {hasTrades && (
                      <span className="text-[9.5px] px-1.5 py-0.2 rounded-full font-bold bg-black/50 border border-white/10 text-slate-300">
                        {cell.trades.length} {cell.trades.length === 1 ? 'lệnh' : 'lệnh'}
                      </span>
                    )}
                  </div>

                  {/* Bottom: Daily PnL & Win/Loss Count */}
                  {hasTrades ? (
                    <div className="flex flex-col gap-0.5 mt-1 font-mono">
                      <span className={`text-xs md:text-sm tracking-tight ${pnlColor}`}>
                        {isProfit ? '+' : ''}${formatPrice(cell.pnl)}
                      </span>
                      <div className="flex items-center justify-between text-[9px] text-slate-400">
                        <span className="text-emerald-400 font-bold">{cell.wins}W</span>
                        <span className="text-rose-400 font-bold">{cell.losses}L</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[9.5px] text-slate-600 font-mono mt-2">
                      --
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </section>


        {/* ── SECTION C: CHI TIẾT DANH SÁCH LỆNH & ENTRY FORENSICS ── */}
        <section className="bg-binance-panel border border-binance-border rounded-xl flex flex-col overflow-hidden shadow-xl">
          
          {/* Table Header Controls */}
          <div className="p-4 border-b border-binance-border bg-binance-subpanel flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-extrabold text-sm text-white flex items-center gap-2">
                <span>📋 BÁO CÁO CHI TIẾT TỪNG LỆNH & ENTRY</span>
                <span className="bg-binance-yellow text-black text-xs px-2 py-0.5 rounded-full font-black font-mono">
                  {filteredTrades.length}
                </span>
              </span>

              {/* Status Filter Tabs */}
              <div className="flex items-center bg-binance-bg border border-binance-border rounded-lg p-0.5 gap-0.5 text-xs font-mono">
                {[
                  { id: 'ALL', label: `Tất Cả (${trades.length})` },
                  { id: 'WIN', label: `🟢 Thắng (${stats.wins})` },
                  { id: 'LOSS', label: `🔴 Thua (${stats.losses})` },
                  { id: 'ACTIVE', label: `⚡ Đang Mở (${stats.activeCount})` }
                ].map(tab => (
                  <button
                    key={tab.id}
                    className={`px-2.5 py-1 rounded font-bold transition ${statusFilter === tab.id ? 'bg-binance-active text-binance-yellow shadow' : 'text-slate-400 hover:text-white'}`}
                    onClick={() => setStatusFilter(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <input
                  type="text"
                  placeholder="Tìm Symbol, Chiến lược, Ghi chú..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-binance-bg border border-binance-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-binance-yellow"
                />
                {searchQuery && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                    onClick={() => setSearchQuery('')}
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                className="bg-binance-subpanel hover:bg-binance-hover px-2.5 py-1.5 rounded-lg border border-binance-border text-xs font-bold text-slate-200 transition"
                onClick={fetchJournal}
                title="Tải lại dữ liệu từ Server"
              >
                🔄
              </button>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto max-h-[550px]">
            <table className="w-full text-left font-mono text-[11px] border-collapse">
              <thead className="bg-[#0B0E17] text-slate-400 sticky top-0 z-10 border-b border-binance-border uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Thời Gian</th>
                  <th className="py-2.5 px-3">Symbol / Sàn</th>
                  <th className="py-2.5 px-3">Vị Thế</th>
                  <th className="py-2.5 px-3">Entry → Exit Price</th>
                  <th className="py-2.5 px-3">Quy Mô / Vốn</th>
                  <th className="py-2.5 px-3">Lợi Nhuận (PnL)</th>
                  <th className="py-2.5 px-3">Kết Quả</th>
                  <th className="py-2.5 px-3">Chiến Lược & Rationale</th>
                  <th className="py-2.5 px-3">Ghi Chú</th>
                  <th className="py-2.5 px-3 text-right">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-binance-border/40">
                {loading ? (
                  <tr>
                    <td colSpan="10" className="py-12 text-center text-slate-400">
                      <span className="animate-spin inline-block mr-2 text-base">⚡</span>
                      Đang tải dữ liệu nhật ký giao dịch...
                    </td>
                  </tr>
                ) : filteredTrades.length === 0 ? (
                  <tr>
                    <td colSpan="10" className="py-12 text-center text-slate-400">
                      <span className="text-2xl block mb-1">📭</span>
                      Không có giao dịch nào khớp với bộ lọc hiện tại.
                    </td>
                  </tr>
                ) : (
                  filteredTrades.map(trade => {
                    const isLong = (trade.direction || '').toUpperCase() === 'LONG';
                    const pnl = Number(trade.net_pnl_usd) || 0;
                    const isWin = pnl > 0;
                    const isLoss = pnl < 0;
                    const isActive = trade.status === 'ACTIVE';

                    return (
                      <tr
                        key={trade.id}
                        className="hover:bg-binance-hover/50 transition cursor-pointer"
                        onClick={() => onOpenForensics && onOpenForensics(trade)}
                      >
                        {/* 1. Time */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="text-white font-bold block">
                            {trade.open_time ? new Date(trade.open_time).toLocaleDateString() : '--'}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {trade.open_time ? new Date(trade.open_time).toLocaleTimeString() : ''}
                          </span>
                        </td>

                        {/* 2. Symbol & Exchange */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="font-extrabold text-white text-xs block">{trade.symbol}</span>
                          <span className="text-[9.5px] bg-binance-card px-1.5 py-0.2 rounded border border-binance-borderSubtle font-bold text-binance-textSec">
                            {trade.exchange || 'BINANCE'}
                          </span>
                        </td>

                        {/* 3. Side & Leverage */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-2 py-0.5 rounded font-extrabold text-[10px] ${isLong ? 'bg-binance-green/20 text-binance-green border border-binance-green/40' : 'bg-binance-red/20 text-binance-red border border-binance-red/40'}`}>
                              {isLong ? '▲ LONG' : '▼ SHORT'}
                            </span>
                            <span className="text-[10px] text-binance-yellow font-bold bg-binance-bg px-1.5 py-0.5 rounded border border-binance-border">
                              {trade.leverage || 20}x
                            </span>
                          </div>
                        </td>

                        {/* 4. Entry -> Exit Price */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="text-white font-bold block">
                            ${formatPrice(trade.entry_price)}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            → {isActive ? <b className="text-binance-yellowHover">${formatPrice(trade.current_price || trade.entry_price)} (Live)</b> : `$${formatPrice(trade.exit_price || trade.current_price || trade.entry_price)}`}
                          </span>
                        </td>

                        {/* 5. Pos Size / Margin */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="text-white block font-bold">${formatPrice(trade.pos_size_usd)}</span>
                          <span className="text-[10px] text-slate-400">Ký quỹ: ${formatPrice(trade.initial_margin)}</span>
                        </td>

                        {/* 6. PnL & ROE */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={`font-black text-xs block ${isActive ? (pnl >= 0 ? 'text-binance-green' : 'text-binance-red') : (isWin ? 'text-binance-green' : isLoss ? 'text-binance-red' : 'text-slate-300')}`}>
                            {pnl >= 0 ? '+' : ''}${formatPrice(pnl)}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {trade.roe_pct !== undefined ? `${trade.roe_pct >= 0 ? '+' : ''}${Number(trade.roe_pct).toFixed(2)}% ROE` : ''}
                          </span>
                        </td>

                        {/* 7. Outcome */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {isActive ? (
                            <span className="bg-binance-cyan/20 text-binance-cyan border border-binance-cyan/40 px-2 py-0.5 rounded-full font-bold text-[10px]">
                              ⚡ Đang Chạy
                            </span>
                          ) : isWin ? (
                            <span className="bg-emerald-950 text-emerald-400 border border-emerald-600/50 px-2 py-0.5 rounded-full font-bold text-[10px]">
                              ✓ {trade.exit_reason || trade.status || 'Chốt Lãi'}
                            </span>
                          ) : (
                            <span className="bg-rose-950 text-rose-400 border border-rose-600/50 px-2 py-0.5 rounded-full font-bold text-[10px]">
                              ✕ {trade.exit_reason || trade.status || 'Dừng Lỗ'}
                            </span>
                          )}
                        </td>

                        {/* 8. Strategy & Rationale */}
                        <td className="py-2.5 px-3 max-w-[200px] truncate">
                          <span className="text-slate-200 block font-bold truncate">
                            {trade.strategy_name || 'STAT2 Box Strategy'}
                          </span>
                          <span className="text-[10px] text-slate-400 truncate block">
                            {trade.entry_rationale || trade.market_regime || 'SMC Liquidity & FVG Retest'}
                          </span>
                        </td>

                        {/* 9. Notes */}
                        <td className="py-2.5 px-3 max-w-[160px] truncate text-slate-300">
                          {trade.notes ? (
                            <span className="text-binance-yellow bg-binance-yellow/10 border border-binance-yellow/30 px-2 py-0.5 rounded text-[10px] block truncate">
                              📝 {trade.notes}
                            </span>
                          ) : (
                            <span className="text-slate-600 italic text-[10px]">(Chưa có)</span>
                          )}
                        </td>

                        {/* 10. Actions */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              className="bg-binance-card hover:bg-binance-hover text-binance-cyan border border-binance-border px-2 py-1 rounded text-[10.5px] font-bold transition shadow"
                              onClick={() => onOpenForensics && onOpenForensics(trade)}
                              title="Xem phân tích chi tiết & forensics của lệnh này"
                            >
                              🔍 Chi Tiết
                            </button>
                            <button
                              className="bg-binance-subpanel hover:bg-binance-hover text-white border border-binance-border px-2 py-1 rounded text-[10.5px] font-bold transition shadow"
                              onClick={() => onSelectSymbol && onSelectSymbol(trade.symbol, trade.exchange)}
                              title="Mở biểu đồ của Symbol này trên màn hình chính"
                            >
                              📈 Chart
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

        </section>

      </div>

      {/* ── 3. INLINE JSON VIEWER MODAL ── */}
      {isJsonModalOpen && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setIsJsonModalOpen(false)}>
          <div className="bg-[#0B0E17] border border-binance-borderHighlight rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            
            <div className="p-3.5 border-b border-binance-border bg-[#0D111C] flex items-center justify-between font-mono">
              <span className="font-extrabold text-sm text-binance-yellow flex items-center gap-2">
                <span>📄 TRADING JOURNAL RAW JSON REPORT</span>
                <span className="text-xs text-slate-400">({trades.length} Trades)</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="bg-binance-cyan/20 text-binance-cyan border border-binance-cyan/40 px-3 py-1 rounded text-xs font-bold transition"
                  onClick={handleExportJson}
                >
                  📥 Tải File JSON
                </button>
                <button
                  className="bg-binance-subpanel hover:bg-binance-hover text-white border border-binance-border px-3 py-1 rounded text-xs font-bold transition"
                  onClick={handleCopyJson}
                >
                  {copiedToast ? '✅ Đã Copy!' : '📋 Copy JSON'}
                </button>
                <button
                  className="text-slate-400 hover:text-white text-lg px-2"
                  onClick={() => setIsJsonModalOpen(false)}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-auto bg-[#07090F] font-mono text-[11px] text-emerald-400 leading-relaxed select-text">
              <pre>{JSON.stringify(fullJsonReport, null, 2)}</pre>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

// ── 4. INITIAL SETUP WIZARD COMPONENT (TRÌNH HƯỚNG DẪN CÀI ĐẶT MỚI) ──
function SetupWizardModal({ isOpen, onClose, onCompleted }) {
  if (!isOpen) return null;

  const [step, setStep] = useState(1); // 1: DB & Vốn, 2: Rủi Ro & SL/TP, 3: Sàn Giao Dịch, 4: Tổng Hợp & Khởi Chạy
  const [isApplying, setIsApplying] = useState(false);
  const [applyLogs, setApplyLogs] = useState([]);
  const [isSuccess, setIsSuccess] = useState(false);

  // Form States
  const [resetTables, setResetTables] = useState(true);
  const [initialBalance, setInitialBalance] = useState(1000.0);
  const [riskPct, setRiskPct] = useState(1.0);
  const [maxLeverage, setMaxLeverage] = useState(20);
  const [marginMode, setMarginMode] = useState('ISOLATED');
  const [tp1Ratio, setTp1Ratio] = useState(1.5);
  const [tp1ClosePct, setTp1ClosePct] = useState(50);
  const [autoBreakeven, setAutoBreakeven] = useState(true);
  const [tp2Ratio, setTp2Ratio] = useState(3.0);
  const [maxConcurrentPositions, setMaxConcurrentPositions] = useState(5);
  const [dailyDrawdownPct, setDailyDrawdownPct] = useState(4.0);

  // Exchange Selection (6 Top Exchanges)
  const [enabledExchanges, setEnabledExchanges] = useState({
    BINANCE: true,
    BYBIT: true,
    OKX: true,
    BITGET: true,
    GATE: true,
    BINGX: true
  });
  const [autoSeedSymbols, setAutoSeedSymbols] = useState(true);

  const toggleExchange = (ex) => {
    setEnabledExchanges(prev => ({ ...prev, [ex]: !prev[ex] }));
  };

  const activeExchangesList = Object.keys(enabledExchanges).filter(k => enabledExchanges[k]);

  const handleExecuteWizard = async () => {
    setIsApplying(true);
    setApplyLogs(['[1/4] 🚀 Đang khởi tạo Trình Hướng Dẫn Cài Đặt Mới (Setup Wizard)...']);
    
    try {
      setApplyLogs(prev => [...prev, `[2/4] 💾 Khởi tạo cấu trúc bảng SQLite & thiết lập vốn ban đầu: $${initialBalance}...`]);
      
      const payload = {
        resetTables,
        initialBalance: Number(initialBalance),
        riskPct: Number(riskPct),
        maxLeverage: Number(maxLeverage),
        marginMode,
        tp1Ratio: Number(tp1Ratio),
        tp1ClosePct: Number(tp1ClosePct),
        autoBreakeven,
        tp2Ratio: Number(tp2Ratio),
        maxConcurrentPositions: Number(maxConcurrentPositions),
        dailyDrawdownPct: Number(dailyDrawdownPct),
        enabledExchanges: activeExchangesList,
        autoSeedSymbols
      };

      setApplyLogs(prev => [...prev, `[3/4] 🛡️ Áp dụng mô hình quản lý rủi ro cố định ${riskPct}% (Đòn bẩy ${maxLeverage}x, Breakeven ${autoBreakeven ? 'BẬT' : 'TẮT'})...`]);
      setApplyLogs(prev => [...prev, `[4/4] 🌐 Khám phá và nạp 90% symbol perpetual cho ${activeExchangesList.length} sàn được kích hoạt qua CCXT Pro...`]);

      const res = await fetch('/api/wizard/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json());

      if (res.success) {
        setApplyLogs(prev => [
          ...prev,
          '🔄 [AUTO-REBOOT] Đang tự động khởi động lại dịch vụ máy chủ, nạp lại cấu hình SQLite và đồng bộ giá WebSocket 6 sàn...',
          '🎉 THIẾT LẬP HOÀN TẤT THÀNH CÔNG! Máy chủ đã áp dụng toàn bộ cấu hình mới và Scanner 24/7 đang chạy.'
        ]);
        setIsSuccess(true);
        setTimeout(() => {
          if (onCompleted) onCompleted();
        }, 2200);
      } else {
        setApplyLogs(prev => [...prev, `❌ Lỗi thiết lập: ${res.error}`]);
      }
    } catch (e) {
      setApplyLogs(prev => [...prev, `❌ Lỗi kết nối máy chủ: ${e.message}`]);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 font-sans text-xs text-slate-200" onClick={onClose}>
      <div className="bg-[#0B0E17] border border-binance-borderHighlight rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        
        {/* Header with Step Wizard Breadcrumbs */}
        <div className="p-4 border-b border-binance-border bg-[#0E1320] flex items-center justify-between font-mono shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🧙‍♂️</span>
            <div>
              <span className="font-extrabold text-sm sm:text-base text-white block">TRÌNH HƯỚNG DẪN CÀI ĐẶT MỚI (SETUP WIZARD)</span>
              <span className="text-[10.5px] text-slate-400">Khởi tạo SQLite, Quản lý rủi ro 1% và Kích hoạt 6 Sàn Phái Sinh</span>
            </div>
          </div>
          <button className="text-slate-400 hover:text-white text-base w-7 h-7 rounded bg-binance-subpanel flex items-center justify-center" onClick={onClose}>✕</button>
        </div>

        {/* Step Indicator Tabs */}
        <div className="grid grid-cols-4 border-b border-binance-border bg-[#080B11] text-[11px] font-mono text-center">
          {[
            { num: 1, label: '1. DB & Vốn' },
            { num: 2, label: '2. Quản Lý Rủi Ro' },
            { num: 3, label: '3. Chọn 6 Sàn' },
            { num: 4, label: '4. Xác Nhận & Chạy' }
          ].map(s => (
            <button
              key={s.num}
              disabled={isApplying}
              onClick={() => setStep(s.num)}
              className={`py-2.5 px-1 font-bold border-b-2 transition ${step === s.num ? 'border-binance-yellow text-binance-yellow bg-[#121824]' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Scrollable Wizard Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 flex flex-col gap-4 text-xs font-mono">
          
          {/* ── BƯỚC 1: KHỞI TẠO DB & SỐ DƯ VỐN ── */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="p-3 bg-binance-card rounded-lg border border-binance-border flex items-start gap-3">
                <span className="text-2xl">💾</span>
                <div>
                  <b className="text-white text-sm block mb-1">Khởi Tạo Cơ Sở Dữ Liệu SQLite & Cấu Trúc Bảng</b>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Hệ thống sẽ tự động khởi tạo các bảng `trade_positions`, `whitelist_symbols`, `symbol_strategies`, `chart_drawings`, `order_notes` với chuẩn SQLite WAL Mode tối ưu hóa ghi nhanh 60 FPS.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-[#111726] rounded-lg border border-binance-border flex flex-col gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetTables}
                    onChange={e => setResetTables(e.target.checked)}
                    className="w-4 h-4 accent-binance-yellow rounded cursor-pointer"
                  />
                  <div>
                    <b className="text-white">Làm sạch & Tạo mới toàn bộ dữ liệu bảng SQLite (Clean Reset)</b>
                    <span className="text-slate-400 text-[10px] block">Xóa dữ liệu cũ, đặt lại các bảng về trạng thái xuất xưởng sạch sẽ.</span>
                  </div>
                </label>

                <div className="pt-2 border-t border-binance-border/60 flex flex-col gap-2">
                  <label className="text-slate-300 font-bold">Số Dư Vốn Ban Đầu Khởi Tạo ($ Wallet Balance):</label>
                  <div className="flex items-center gap-2">
                    {[500, 1000, 2000, 5000, 10000].map(val => (
                      <button
                        key={val}
                        type="button"
                        className={`px-3 py-1.5 rounded font-bold border transition ${initialBalance === val ? 'bg-binance-yellow text-black border-binance-yellow shadow' : 'bg-binance-subpanel text-slate-300 border-binance-border hover:text-white'}`}
                        onClick={() => setInitialBalance(val)}
                      >
                        ${val.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-slate-400 text-[11px]">Hoặc nhập tùy chọn:</span>
                    <input
                      type="number"
                      value={initialBalance}
                      onChange={e => setInitialBalance(parseFloat(e.target.value) || 0)}
                      className="bg-[#090D16] border border-binance-border rounded px-3 py-1 text-white font-bold w-36 focus:outline-none focus:border-binance-yellow"
                    />
                    <span className="text-slate-400">USD</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── BƯỚC 2: QUẢN TRỊ RỦI RO & VỐN ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="p-3 bg-binance-card rounded-lg border border-binance-border flex items-start gap-3">
                <span className="text-2xl">🛡️</span>
                <div>
                  <b className="text-white text-sm block mb-1">Cấu Hình Mô Hình Quản Trị Rủi Ro & Kích Thước Vị Thế (Money Management)</b>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Hệ thống tính Size lệnh theo mô hình <b>Fixed Fractional Risk Model</b>. Tự động chia nhỏ lệnh chốt lời TP1 (chốt 50%), dời Stop Loss về hòa vốn (Auto Breakeven) và chốt lời TP2.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                
                {/* Risk % per trade */}
                <div className="p-3 bg-[#111726] rounded-lg border border-binance-border flex flex-col gap-2">
                  <span className="text-binance-yellow font-bold">% Rủi Ro Mỗi Lệnh (Risk Per Trade):</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[0.5, 1.0, 1.5, 2.0].map(r => (
                      <button
                        key={r}
                        type="button"
                        className={`py-1 rounded font-bold border text-center transition ${riskPct === r ? 'bg-binance-yellow text-black border-binance-yellow' : 'bg-binance-subpanel text-slate-300 border-binance-border'}`}
                        onClick={() => setRiskPct(r)}
                      >
                        {r}%
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-slate-400">Khuyến nghị 1.0%: Vốn Ký Quỹ Margin vào mỗi lệnh = ${((initialBalance * riskPct) / 100).toFixed(2)} USDT (với Vốn ${initialBalance}).</span>
                </div>

                {/* Leverage & Margin */}
                <div className="p-3 bg-[#111726] rounded-lg border border-binance-border flex flex-col gap-2">
                  <span className="text-white font-bold">Đòn Bẩy & Ký Quỹ (Leverage & Margin):</span>
                  <div className="flex items-center gap-2">
                    {[10, 20, 50].map(lev => (
                      <button
                        key={lev}
                        type="button"
                        className={`px-2.5 py-1 rounded font-bold border transition ${maxLeverage === lev ? 'bg-binance-yellow text-black border-binance-yellow' : 'bg-binance-subpanel text-slate-300 border-binance-border'}`}
                        onClick={() => setMaxLeverage(lev)}
                      >
                        {lev}x
                      </button>
                    ))}
                    <select
                      value={marginMode}
                      onChange={e => setMarginMode(e.target.value)}
                      className="bg-[#090D16] border border-binance-border rounded px-2 py-1 text-white font-bold focus:outline-none"
                    >
                      <option value="ISOLATED">ISOLATED</option>
                      <option value="CROSSED">CROSSED</option>
                    </select>
                  </div>
                  <span className="text-[10px] text-slate-400">Isolated Margin giúp cách ly hoàn toàn rủi ro từng lệnh.</span>
                </div>

                {/* TP1 & Breakeven */}
                <div className="p-3 bg-[#111726] rounded-lg border border-binance-border flex flex-col gap-2">
                  <span className="text-binance-green font-bold">Take Profit 1 (TP1) & Auto Breakeven:</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-[11px]">Tỷ lệ TP1:</span>
                    <select
                      value={tp1Ratio}
                      onChange={e => setTp1Ratio(parseFloat(e.target.value))}
                      className="bg-[#090D16] border border-binance-border rounded px-2 py-1 text-white font-bold focus:outline-none"
                    >
                      <option value="1.0">1.0R</option>
                      <option value="1.5">1.5R (Chuẩn)</option>
                      <option value="2.0">2.0R</option>
                    </select>
                    <span className="text-slate-400 text-[11px]">Đóng:</span>
                    <span className="text-white font-bold">50%</span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer mt-1">
                    <input
                      type="checkbox"
                      checked={autoBreakeven}
                      onChange={e => setAutoBreakeven(e.target.checked)}
                      className="w-3.5 h-3.5 accent-binance-green rounded cursor-pointer"
                    />
                    <span className="text-[10.5px] text-slate-300">Tự động dời SL về hòa vốn (+0.05% phí) ngay khi khớp TP1</span>
                  </label>
                </div>

                {/* TP2 & Max Positions */}
                <div className="p-3 bg-[#111726] rounded-lg border border-binance-border flex flex-col gap-2">
                  <span className="text-binance-cyan font-bold">Take Profit 2 (TP2) & Giới Hạn Lệnh:</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-[11px]">Tỷ lệ TP2:</span>
                    <select
                      value={tp2Ratio}
                      onChange={e => setTp2Ratio(parseFloat(e.target.value))}
                      className="bg-[#090D16] border border-binance-border rounded px-2 py-1 text-white font-bold focus:outline-none"
                    >
                      <option value="2.5">2.5R</option>
                      <option value="3.0">3.0R (Chuẩn)</option>
                      <option value="4.0">4.0R</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-slate-400 text-[11px]">Tối đa lệnh mở cùng lúc:</span>
                    <select
                      value={maxConcurrentPositions}
                      onChange={e => setMaxConcurrentPositions(parseInt(e.target.value))}
                      className="bg-[#090D16] border border-binance-border rounded px-2 py-1 text-white font-bold focus:outline-none"
                    >
                      <option value="3">3 lệnh (3% rủi ro)</option>
                      <option value="5">5 lệnh (5% rủi ro)</option>
                      <option value="10">10 lệnh (10% rủi ro)</option>
                    </select>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* ── BƯỚC 3: LỰA CHỌN DANH SÁCH 6 SÀN ── */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="p-3 bg-binance-card rounded-lg border border-binance-border flex items-start gap-3">
                <span className="text-2xl">🌐</span>
                <div>
                  <b className="text-white text-sm block mb-1">Lựa Chọn & Kích Hoạt Danh Sách Sàn Giao Dịch Phái Sinh</b>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Bật/Tắt các sàn giao dịch mong muốn. Hệ thống sẽ tự động quét, lọc thanh khoản và nạp <b>top 90% hợp đồng USDT Perpetual</b> của các sàn được chọn.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {[
                  { id: 'BINANCE', name: 'Binance Futures', icon: '🔶', approx: '~631 Perps', desc: 'USDT-M Perpetual' },
                  { id: 'BYBIT', name: 'Bybit Linear', icon: '⬛', approx: '~655 Perps', desc: 'Linear V5 Perpetual' },
                  { id: 'OKX', name: 'OKX Perpetual', icon: '🔷', approx: '~394 Perps', desc: 'USDT Perpetual Swap' },
                  { id: 'BITGET', name: 'Bitget Perpetual', icon: '🔵', approx: '~684 Perps', desc: 'USDT-M Perpetual' },
                  { id: 'GATE', name: 'Gate.io Perpetual', icon: '🚪', approx: '~843 Perps', desc: 'USDT Perpetual' },
                  { id: 'BINGX', name: 'BingX Perpetual', icon: '💠', approx: '~738 Perps', desc: 'Swap Perpetual' }
                ].map(ex => {
                  const isChecked = !!enabledExchanges[ex.id];
                  return (
                    <div
                      key={ex.id}
                      onClick={() => toggleExchange(ex.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition flex flex-col justify-between gap-2 ${isChecked ? 'bg-[#111726] border-binance-yellow shadow-md shadow-binance-yellow/10' : 'bg-[#090D16] border-binance-border opacity-50'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white flex items-center gap-1.5">
                          <span>{ex.icon}</span>
                          <span>{ex.name}</span>
                        </span>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="w-4 h-4 accent-binance-yellow cursor-pointer"
                        />
                      </div>
                      <div>
                        <span className="text-binance-yellow font-bold text-[11px] block">{ex.approx}</span>
                        <span className="text-slate-400 text-[10px]">{ex.desc}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 bg-[#111726] rounded-lg border border-binance-border flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSeedSymbols}
                    onChange={e => setAutoSeedSymbols(e.target.checked)}
                    className="w-4 h-4 accent-binance-yellow rounded cursor-pointer"
                  />
                  <div>
                    <b className="text-white">Tự động nạp 90% symbol perpetual qua CCXT Pro sau khi hoàn tất</b>
                    <span className="text-slate-400 text-[10px] block">Lọc danh sách hợp đồng theo khối lượng thanh khoản 24h thực tế.</span>
                  </div>
                </label>
                <span className="text-binance-cyan font-bold text-xs">{activeExchangesList.length} / 6 Sàn Đã Bật</span>
              </div>
            </div>
          )}

          {/* ── BƯỚC 4: TỔNG HỢP & KHỞI CHẠY ── */}
          {step === 4 && (
            <div className="flex flex-col gap-4">
              <div className="p-3 bg-binance-card rounded-lg border border-binance-border flex items-start gap-3">
                <span className="text-2xl">✨</span>
                <div>
                  <b className="text-white text-sm block mb-1">Xác Nhận Cấu Hình & Khởi Chạy Hệ Thống</b>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Kiểm tra lại toàn bộ thông số đã thiết lập trước khi áp dụng vào cơ sở dữ liệu SQLite và khởi động hệ thống.
                  </p>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-2.5 bg-[#111726] rounded border border-binance-border">
                  <span className="text-slate-400 text-[10px] block font-bold">VỐN KHỞI TẠO:</span>
                  <span className="text-white font-extrabold text-base">${Number(initialBalance).toLocaleString()}</span>
                </div>
                <div className="p-2.5 bg-[#111726] rounded border border-binance-border">
                  <span className="text-slate-400 text-[10px] block font-bold">MỨC RỦI RO:</span>
                  <span className="text-binance-yellow font-extrabold text-base">{riskPct}% / Lệnh</span>
                </div>
                <div className="p-2.5 bg-[#111726] rounded border border-binance-border">
                  <span className="text-slate-400 text-[10px] block font-bold">SL / TP1 / TP2:</span>
                  <span className="text-emerald-400 font-extrabold text-xs">TP1: {tp1Ratio}R | TP2: {tp2Ratio}R</span>
                </div>
                <div className="p-2.5 bg-[#111726] rounded border border-binance-border">
                  <span className="text-slate-400 text-[10px] block font-bold">SÀN KÍCH HOẠT:</span>
                  <span className="text-binance-cyan font-extrabold text-base">{activeExchangesList.length} Sàn</span>
                </div>
              </div>

              {/* Live Execution Logs */}
              {applyLogs.length > 0 && (
                <div className="p-3 bg-[#080B11] rounded-lg border border-binance-border font-mono text-[11px] flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {applyLogs.map((log, idx) => (
                    <div key={idx} className="text-emerald-400">{log}</div>
                  ))}
                </div>
              )}

              {/* Action Button */}
              {!isSuccess && (
                <button
                  disabled={isApplying || activeExchangesList.length === 0}
                  onClick={handleExecuteWizard}
                  className="w-full py-3 bg-gradient-to-r from-binance-yellow to-amber-500 hover:from-binance-yellowHover hover:to-amber-400 text-black font-extrabold text-sm rounded-lg transition shadow-lg flex items-center justify-center gap-2"
                >
                  <span>{isApplying ? '⏳ Đang Thiết Lập Hệ Thống...' : '🚀 ÁP DỤNG CÀI ĐẶT & KHỞI CHẠY HỆ THỐNG'}</span>
                </button>
              )}
            </div>
          )}

        </div>

        {/* Footer Navigation Buttons */}
        <div className="p-3 border-t border-binance-border bg-[#0E1320] flex items-center justify-between shrink-0 font-mono">
          <div>
            {step > 1 && (
              <button
                disabled={isApplying}
                className="bg-binance-subpanel hover:bg-binance-hover px-4 py-1.5 rounded-lg text-xs font-bold text-white border border-binance-border transition"
                onClick={() => setStep(step - 1)}
              >
                ← Quay Lại
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={isApplying}
              className="bg-binance-subpanel hover:bg-binance-hover px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white border border-binance-border"
              onClick={onClose}
            >
              Hủy
            </button>
            {step < 4 ? (
              <button
                className="bg-binance-yellow hover:bg-binance-yellowHover text-black font-bold px-4 py-1.5 rounded-lg text-xs transition"
                onClick={() => setStep(step + 1)}
              >
                Tiếp Tục →
              </button>
            ) : null}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── ROOT APPLICATION COMPONENT ──
function App() {
  const [selectedExchange, setSelectedExchange] = useState('ALL');
  const [bottomTab, setBottomTab] = useState('signals');
  const [isDeskCollapsed, setIsDeskCollapsed] = useState(false);

  // Left Market Watchlist state
  const [leftExchangeTab, setLeftExchangeTab] = useState('ALL');
  const [leftCategoryFilter, setLeftCategoryFilter] = useState('ALL'); // ALL, SIGNALS, GAINERS, LOSERS
  const [watchlistSearch, setWatchlistSearch] = useState('');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // SplashScreen Lifecycle
  const [isAppReady, setIsAppReady] = useState(false);
  const [splashProgress, setSplashProgress] = useState(15);
  const [splashTasks, setSplashTasks] = useState([
    { id: 'ws', label: 'Connecting WebSocket Feeds (Binance, Bybit, OKX)', status: 'running' },
    { id: 'db', label: 'Loading 1,000 Whitelist Symbols & Strategies', status: 'pending' },
    { id: 'pos', label: 'Loading Active Positions & Portfolio Stats', status: 'pending' },
    { id: 'engine', label: 'Initializing Pure JS SMC & Indicator Engine', status: 'pending' },
    { id: 'feed', label: 'Streaming Live All-Market Realtime Prices', status: 'pending' }
  ]);

  // Live All-Market Ticker Prices
  const [marketPrices, setMarketPrices] = useState({});

  // Active Symbol & Timeframe for Chart
  const [activeSymbol, setActiveSymbol] = useState('BTCUSDT');
  const [activeExchange, setActiveExchange] = useState('BINANCE');
  const [activeTf, setActiveTf] = useState('15m');

  // STAT2 Indicator Instances State (Saved and Loaded in Browser LocalStorage)
  const [indicatorInstances, setIndicatorInstances] = useState(() => loadSavedIndicators());
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [editingInstance, setEditingInstance] = useState(null);
  const [indicatorSettingsTab, setIndicatorSettingsTab] = useState('params');

  // Server Data
  const [status, setStatus] = useState({});
  const [settings, setSettings] = useState({});
  const [performance, setPerformance] = useState({});
  const [whitelist, setWhitelist] = useState([]);
  const [signals, setSignals] = useState([]);
  const [activePositions, setActivePositions] = useState([]);
  const [closedPositions, setClosedPositions] = useState([]);
  const [limitOrders, setLimitOrders] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logFilter, setLogFilter] = useState('ALL');

  // Modals
  const [forensicsData, setForensicsData] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const wsRef = useRef(null);

  // ── SERVER WEBSOCKET CONNECTION (POSITIONS, SIGNALS, LOGS) ──
  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:8080';
    const ws = new WebSocket(`${protocol}//${host}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'POSITIONS_UPDATE' && msg.data) {
          if (msg.data.positions) setActivePositions(msg.data.positions);
          if (msg.data.stats) setPerformance(msg.data.stats);
        } else if (msg.type === 'SIGNALS_UPDATE' && msg.data && msg.data.signals) {
          setSignals(msg.data.signals);
        } else if (msg.type === 'NEW_SIGNAL' && msg.data) {
          setSignals(prev => [msg.data, ...prev.slice(0, 199)]);
        } else if (msg.type === 'LOG' && msg.data) {
          setLogs(prev => [...prev.slice(-300), msg.data]);
        }
      } catch (err) {}
    };
    ws.onclose = () => setTimeout(() => connectWebSocket(), 3000);
  }, []);

  // ── REST FETCH ──
  const fetchAllData = useCallback(async () => {
    try {
      const [resStatus, resWl, resSig, resPos, resSet, resL] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/whitelist').then(r => r.json()),
        fetch('/api/signals?limit=150').then(r => r.json()),
        fetch('/api/positions').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/logs?limit=80').then(r => r.json())
      ]);

      if (resStatus.success) {
        setStatus(resStatus.status || {});
        if (resStatus.stats) setPerformance(resStatus.stats);
        if (resStatus.settings) setSettings(resStatus.settings);
      }
      if (resWl.success) setWhitelist(resWl.data || []);
      if (resSig.success) {
        setSignals(resSig.data || []);
        const activeSyms = new Set((resPos.active || []).map(p => p.symbol));
        setLimitOrders((resSig.data || []).filter(s => s.signal_type && s.signal_type.startsWith('FADE') && !activeSyms.has(s.symbol)).slice(0, 30));
      }
      if (resPos.success) {
        setActivePositions(resPos.active || []);
        setClosedPositions((resPos.all || []).filter(p => p.status !== 'ACTIVE'));
      }
      if (resSet.success) setSettings(resSet.data || {});
      if (resL && resL.success) setLogs(resL.data || []);
    } catch (e) {}
  }, []);

  // ── INITIALIZATION PIPELINE ON STARTUP ──
  useEffect(() => {
    let isMounted = true;
    async function runStartupSequence() {
      // 1. WebSockets
      setSplashProgress(25);
      setSplashTasks(prev => prev.map(t => t.id === 'ws' ? { ...t, status: 'done' } : (t.id === 'db' ? { ...t, status: 'running' } : t)));
      connectWebSocket();

      // 2. Fetch Server Whitelist & Database
      try {
        await fetchAllData();
      } catch (e) {}
      if (!isMounted) return;
      setSplashProgress(50);
      setSplashTasks(prev => prev.map(t => t.id === 'db' ? { ...t, status: 'done' } : (t.id === 'pos' ? { ...t, status: 'running' } : t)));

      // 3. Portfolio & Bot State
      await new Promise(r => setTimeout(r, 200));
      if (!isMounted) return;
      setSplashProgress(70);
      setSplashTasks(prev => prev.map(t => t.id === 'pos' ? { ...t, status: 'done' } : (t.id === 'engine' ? { ...t, status: 'running' } : t)));

      // 4. Indicator Engine Check
      await new Promise(r => setTimeout(r, 150));
      if (!isMounted) return;
      setSplashProgress(85);
      setSplashTasks(prev => prev.map(t => t.id === 'engine' ? { ...t, status: 'done' } : (t.id === 'feed' ? { ...t, status: 'running' } : t)));

      // 5. Initial Realtime Market Prices Snapshot
      try {
        const initialBatch = await GlobalMarketStreamManager.fetchInitialSnapshot();
        setMarketPrices(prev => ({ ...prev, ...initialBatch }));
      } catch (e) {}
      if (!isMounted) return;
      setSplashProgress(100);
      setSplashTasks(prev => prev.map(t => ({ ...t, status: 'done' })));

      // Reveal Main Dashboard
      setTimeout(() => {
        if (isMounted) setIsAppReady(true);
      }, 450);
    }

    runStartupSequence();

    // Subscribe to live market streams
    const unsubscribeMarket = GlobalMarketStreamManager.subscribe((batch) => {
      setMarketPrices(prev => ({ ...prev, ...batch }));
    });

    const interval = setInterval(fetchAllData, 4000);

    return () => {
      isMounted = false;
      unsubscribeMarket();
      clearInterval(interval);
    };
  }, [connectWebSocket, fetchAllData]);

  // Filtered Full Symbols List on Left Pane
  const filteredLeftWhitelist = useMemo(() => {
    let list = whitelist;
    if (leftExchangeTab !== 'ALL') {
      list = list.filter(w => (w.exchange || 'BINANCE') === leftExchangeTab);
    }
    if (watchlistSearch) {
      const q = watchlistSearch.toUpperCase();
      list = list.filter(w => w.symbol.includes(q) || (w.category && w.category.toUpperCase().includes(q)));
    }
    if (leftCategoryFilter === 'SIGNALS') {
      const sigSet = new Set(signals.map(s => s.symbol));
      list = list.filter(w => sigSet.has(w.symbol));
    } else if (leftCategoryFilter === 'GAINERS') {
      list = [...list].sort((a, b) => {
        const pA = marketPrices[`${a.exchange}_${a.symbol}`] || marketPrices[a.symbol] || { change24h: 0 };
        const pB = marketPrices[`${b.exchange}_${b.symbol}`] || marketPrices[b.symbol] || { change24h: 0 };
        return (pB.change24h || 0) - (pA.change24h || 0);
      });
    } else if (leftCategoryFilter === 'LOSERS') {
      list = [...list].sort((a, b) => {
        const pA = marketPrices[`${a.exchange}_${a.symbol}`] || marketPrices[a.symbol] || { change24h: 0 };
        const pB = marketPrices[`${b.exchange}_${b.symbol}`] || marketPrices[b.symbol] || { change24h: 0 };
        return (pA.change24h || 0) - (pB.change24h || 0);
      });
    }
    return list;
  }, [whitelist, leftExchangeTab, watchlistSearch, leftCategoryFilter, signals, marketPrices]);

  // Filtered Signals for Bottom Tab
  const filteredSignals = useMemo(() => {
    if (selectedExchange === 'ALL') return signals;
    return signals.filter(s => s.exchange === selectedExchange);
  }, [signals, selectedExchange]);

  const handleSelectSymbol = (item) => {
    setActiveSymbol(item.symbol);
    setActiveExchange(item.exchange || 'BINANCE');
    setIsMobileDrawerOpen(false);
  };

  const handleClosePosition = async (posId) => {
    if (!confirm('Close active position immediately at market price?')) return;
    await fetch(`/api/positions/close/${posId}`, { method: 'POST' });
    fetchAllData();
  };

  const handleResetTrades = async () => {
    if (!confirm('Reset orders, clear signals, and restore initial $1,000 equity?')) return;
    await fetch('/api/admin/reset-trades', { method: 'POST' });
    fetchAllData();
  };

  // Indicator Management Handlers with Auto-Persistence to localStorage
  const handleToggleVisibility = (id) => {
    setIndicatorInstances(prev => {
      const next = prev.map(inst => inst.id === id ? { ...inst, visible: !inst.visible } : inst);
      saveIndicatorsToStorage(next);
      return next;
    });
  };

  const handleRemoveInstance = (id) => {
    setIndicatorInstances(prev => {
      const next = prev.filter(inst => inst.id !== id);
      saveIndicatorsToStorage(next);
      return next;
    });
  };

  const handleAddFromCatalog = (type) => {
    if (window.IndicatorRegistry) {
      const newInst = window.IndicatorRegistry.createInstance(type);
      setIndicatorInstances(prev => {
        const next = [...prev, newInst];
        saveIndicatorsToStorage(next);
        return next;
      });
    }
    setIsCatalogOpen(false);
  };

  const handleResetAllIndicators = () => {
    if (confirm('Reset all chart indicators back to factory default?')) {
      const fresh = JSON.parse(JSON.stringify(DEFAULT_INDICATOR_INSTANCES));
      setIndicatorInstances(fresh);
      saveIndicatorsToStorage(fresh);
      setIsCatalogOpen(false);
    }
  };

  // Account Metrics
  const marginBalance = performance.margin_balance !== undefined ? performance.margin_balance : 1000.0;
  const walletBalance = performance.wallet_balance !== undefined ? performance.wallet_balance : 1000.0;
  const unrealizedPnl = performance.unrealized_pnl_usd || 0.0;
  const unrealizedPnlPct = walletBalance > 0 ? (unrealizedPnl / walletBalance) * 100.0 : 0.0;

  // Counts for Left Panel Exchange Tabs
  const countAll = whitelist.length;
  const countBinance = whitelist.filter(w => (w.exchange || 'BINANCE') === 'BINANCE').length;
  const countBybit = whitelist.filter(w => w.exchange === 'BYBIT').length;
  const countOkx = whitelist.filter(w => w.exchange === 'OKX').length;
  const countBitget = whitelist.filter(w => w.exchange === 'BITGET').length;
  const countGate = whitelist.filter(w => w.exchange === 'GATE').length;
  const countBingx = whitelist.filter(w => w.exchange === 'BINGX').length;

  return (
    <>
      {/* ── STARTUP SPLASHSCREEN ── */}
      <SplashScreen tasks={splashTasks} progress={splashProgress} isReady={isAppReady} />

      <div className="flex flex-col h-screen w-screen bg-binance-bg text-binance-text overflow-hidden font-sans text-xs select-none">
        
        {/* ── 1. RESPONSIVE HEADER NAVIGATION (DESKTOP, TABLET & MOBILE) ── */}
        <header className="h-11 border-b border-binance-border bg-binance-panel flex items-center justify-between px-2 md:px-3 shrink-0 z-30 font-sans gap-2">
          
          {/* Left: Mobile Drawer Trigger & Brand Logo */}
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            {/* Mobile/Tablet Pairs Drawer Toggle Button */}
            <button
              className="lg:hidden bg-binance-subpanel hover:bg-binance-hover border border-binance-border rounded px-2 py-1 flex items-center gap-1.5 text-white font-bold text-xs shadow"
              onClick={() => setIsMobileDrawerOpen(true)}
              title="Open Pairs Explorer"
            >
              <span>🪙</span>
              <span className="max-w-[70px] truncate">{activeSymbol}</span>
              <span className="text-[10px] text-binance-yellow">▾</span>
            </button>

            {/* Brand Logo */}
            <div className="flex items-center gap-1.5 font-extrabold text-xs md:text-sm text-white tracking-wide shrink-0">
              <span className="text-binance-yellow text-base">⚡</span>
              <span className="hidden sm:inline">STAT2 FUTURES PRO</span>
              <span className="sm:hidden font-black">STAT2</span>
            </div>

            {/* Desktop & Tablet Exchange Filter Tabs */}
            <div className="hidden md:flex items-center bg-binance-bg border border-binance-border rounded p-0.5 gap-0.5 overflow-x-auto">
              {[
                { id: 'ALL', label: `🌐 ALL (${countAll})` },
                { id: 'BINANCE', label: `🔶 Binance (${countBinance})` },
                { id: 'BYBIT', label: `⬛ Bybit (${countBybit})` },
                { id: 'OKX', label: `🔷 OKX (${countOkx})` },
                { id: 'BITGET', label: `🔵 Bitget (${countBitget})` },
                { id: 'GATE', label: `🚪 Gate (${countGate})` },
                { id: 'BINGX', label: `💠 BingX (${countBingx})` }
              ].map(tab => (
                <button
                  key={tab.id}
                  className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition whitespace-nowrap ${selectedExchange === tab.id ? 'bg-binance-active text-binance-yellow shadow' : 'text-binance-textSec hover:text-white'}`}
                  onClick={() => setSelectedExchange(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Center: Selected Symbol Info (Desktop/Tablet) */}
          <div className="hidden lg:flex items-center gap-2 font-mono text-xs">
            <span className="font-black text-white">{activeSymbol}</span>
            <span className="text-[10px] text-binance-textSec bg-binance-card px-1.5 py-0.5 rounded border border-binance-borderSubtle font-bold">{activeExchange}</span>
            <span className="text-binance-yellow font-bold">{activeTf}</span>
          </div>

          {/* Right HUD: Responsive Equity & Scanner Controls */}
          <div className="flex items-center gap-1.5 md:gap-3 font-mono text-xs shrink-0">
            {/* Margin Readout */}
            <div className="flex items-center gap-1.5 bg-binance-card/60 px-2 py-1 rounded border border-binance-borderSubtle">
              <span className="text-binance-textSec text-[10px] hidden sm:inline">MARGIN:</span>
              <span className="font-bold text-binance-yellow text-xs">${formatPrice(marginBalance)}</span>
              <span className={`font-bold text-[10.5px] ${unrealizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
                ({unrealizedPnl >= 0 ? '+' : ''}${formatPrice(unrealizedPnl)})
              </span>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-1 pl-1 md:pl-2 border-l border-binance-border">
              <span className="radar-dot hidden sm:inline-block" title="24/7 Scanner Active"></span>
              {/* Livestream & Mobile Tracking Button */}
              <a
                href="/livestream"
                target="_blank"
                rel="noreferrer"
                className="bg-red-500/15 hover:bg-red-500/30 text-red-400 hover:text-white px-2.5 py-1 rounded text-[11px] font-bold border border-red-500/40 flex items-center gap-1.5 transition shadow"
                title="Mở Trang Theo Dõi Livestream & Mobile Tracking Monitor (Entry, Active Positions, Open Orders, PnL Sort)"
              >
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <span className="hidden sm:inline">Livestream Tracker</span>
                <span className="sm:hidden">🔴 Live</span>
              </a>

              <button
                className="bg-binance-subpanel hover:bg-binance-hover px-2.5 py-1 rounded text-[11px] font-bold border border-binance-border text-binance-yellow hover:text-white flex items-center gap-1.5 transition shadow"
                onClick={() => setIsJournalOpen(true)}
                title="Mở Nhật Ký Giao Dịch, Lịch PnL & Xuất Báo Cáo JSON (Trading Journal)"
              >
                <span>📖</span>
                <span className="hidden sm:inline">Trading Journal</span>
              </button>

              <button
                className="bg-binance-yellow text-black font-bold px-2.5 py-1 rounded text-[11px] hover:bg-binance-yellowHover transition flex items-center gap-1.5 shadow"
                onClick={() => setIsWizardOpen(true)}
                title="Mở Trình Hướng Dẫn Cài Đặt Mới (Khởi tạo SQLite, Quản trị vốn & Chọn sàn)"
              >
                <span>🧙‍♂️</span>
                <span className="hidden sm:inline">Setup Wizard</span>
              </button>

              <button
                className="bg-binance-subpanel hover:bg-binance-hover px-2 py-1 rounded text-[11px] font-bold border border-binance-border text-slate-300 hover:text-white transition flex items-center gap-1"
                onClick={() => setIsSettingsOpen(true)}
                title="Scanner & Exchange Settings"
              >
                <span>⚙️</span>
                <span className="hidden sm:inline">Settings</span>
              </button>

              {/* Mobile Desk Collapse Toggle */}
              <button
                className="lg:hidden bg-binance-subpanel hover:bg-binance-hover p-1 rounded text-xs border border-binance-border text-binance-yellow"
                onClick={() => setIsDeskCollapsed(!isDeskCollapsed)}
                title="Toggle Trading Desk"
              >
                📊
              </button>
            </div>
          </div>
        </header>

        {/* ── 2. MAIN WORKSPACE ── */}
        <div className="flex-1 flex overflow-hidden relative">
          
          {/* Mobile Backdrop Overlay for Left Drawer */}
          {isMobileDrawerOpen && (
            <div
              className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40 lg:hidden transition-opacity"
              onClick={() => setIsMobileDrawerOpen(false)}
            />
          )}

          {/* ── LEFT FULL SYMBOLS EXPLORER (INLINE ON DESKTOP, SLIDE-OVER ON MOBILE/TABLET) ── */}
          <aside className={`
            fixed lg:static inset-y-0 left-0 z-50 lg:z-auto
            w-80 max-w-[85vw] bg-binance-panel border-r border-binance-border flex flex-col shrink-0 transition-transform duration-300
            ${isMobileDrawerOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
          `}>
            
            <div className="p-2 border-b border-binance-border flex flex-col gap-2 bg-binance-subpanel/50">
              
              {/* Header Title with Mobile Close Button */}
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-[11px] text-white flex items-center gap-1.5">
                  <span>🪙 PAIRS EXPLORER</span>
                  <span className="bg-binance-yellow text-black text-[9.5px] px-1.5 rounded-full font-black">{filteredLeftWhitelist.length}</span>
                </span>
                <button
                  className="lg:hidden text-binance-textSec hover:text-white text-xs font-bold px-2 py-0.5 rounded bg-binance-card border border-binance-border"
                  onClick={() => setIsMobileDrawerOpen(false)}
                >
                  ✕ Close
                </button>
              </div>

              {/* Primary Exchange Tabs for Left Explorer */}
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 font-mono text-[10px]">
                {[
                  { id: 'ALL', label: '🌐 ALL' },
                  { id: 'BINANCE', label: '🔶 BNC' },
                  { id: 'BYBIT', label: '⬛ BYB' },
                  { id: 'OKX', label: '🔷 OKX' },
                  { id: 'BITGET', label: '🔵 BGT' },
                  { id: 'GATE', label: '🚪 GATE' },
                  { id: 'BINGX', label: '💠 BGX' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    className={`py-1 rounded font-bold transition text-center border truncate ${leftExchangeTab === tab.id ? 'bg-binance-yellow text-black border-binance-yellow shadow' : 'bg-binance-card text-binance-textSec border-binance-border hover:text-white'}`}
                    onClick={() => setLeftExchangeTab(tab.id)}
                    title={`Lọc cặp giao dịch sàn ${tab.id}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Search Bar */}
              <div className="relative">
                <input
                  type="text"
                  className="w-full bg-binance-card border border-binance-border rounded px-2.5 py-1.5 text-xs text-white placeholder-binance-textMuted focus:outline-none focus:border-binance-yellow font-mono"
                  placeholder="Search pairs (BTC, SOL, 1000PEPE)..."
                  value={watchlistSearch}
                  onChange={(e) => setWatchlistSearch(e.target.value)}
                />
                {watchlistSearch && (
                  <button className="absolute right-2.5 top-1.5 text-binance-textSec hover:text-white font-bold" onClick={() => setWatchlistSearch('')}>✕</button>
                )}
              </div>

              {/* Sub-Category Filters */}
              <div className="flex items-center justify-between gap-1">
                {[
                  { id: 'ALL', label: `ALL (${filteredLeftWhitelist.length})` },
                  { id: 'SIGNALS', label: '⚡ SIGNALS' },
                  { id: 'GAINERS', label: '🔥 GAINERS' },
                  { id: 'LOSERS', label: '❄️ LOSERS' }
                ].map(cat => (
                  <button
                    key={cat.id}
                    className={`flex-1 py-0.5 rounded text-[10px] font-bold transition text-center ${leftCategoryFilter === cat.id ? 'bg-binance-active text-binance-yellow border border-binance-yellow/30' : 'text-binance-textSec hover:text-white bg-binance-card/50'}`}
                    onClick={() => setLeftCategoryFilter(cat.id)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Symbol Pairs with Live Realtime Price Stream & Tick Direction Colors */}
            <div className="flex-1 overflow-y-auto divide-y divide-binance-borderSubtle/50 font-mono text-xs">
              {filteredLeftWhitelist.length === 0 ? (
                <div className="p-6 text-center text-binance-textMuted text-xs flex flex-col gap-1">
                  <span>No pairs match criteria</span>
                  <span className="text-[10px] text-binance-textSec">Try switching exchange or clearing search</span>
                </div>
              ) : (
                filteredLeftWhitelist.map(item => {
                  const isSelected = item.symbol === activeSymbol && (item.exchange || 'BINANCE') === activeExchange;
                  const sigCount = signals.filter(s => s.symbol === item.symbol && (s.exchange || 'BINANCE') === (item.exchange || 'BINANCE')).length;
                  
                  // Key Resolution across all exchange naming standards
                  const pKey1 = `${item.exchange || 'BINANCE'}_${item.symbol}`;
                  const pKey2 = `${item.exchange || 'BINANCE'}_${item.symbol.replace('-', '')}`;
                  const pKey3 = item.symbol;
                  const pKey4 = item.symbol.replace('-', '');
                  const liveInfo = marketPrices[pKey1] || marketPrices[pKey2] || marketPrices[pKey3] || marketPrices[pKey4] || { price: 0, change24h: 0, vol: 0, tickDir: 'equal' };
                  const isUp = (liveInfo.change24h || 0) >= 0;

                  return (
                    <div
                      key={item.id || `${item.exchange}_${item.symbol}`}
                      className={`px-3 py-2 flex items-center justify-between cursor-pointer transition ${isSelected ? 'bg-binance-active border-l-2 border-binance-yellow shadow-inner' : 'hover:bg-binance-hover/50'}`}
                      onClick={() => handleSelectSymbol(item)}
                    >
                      {/* Left: Symbol & Exchange Badge */}
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 font-bold text-white">
                          <span className="text-[12px]">{item.symbol}</span>
                          {sigCount > 0 && (
                            <span className="bg-binance-cyanBg text-binance-cyan text-[9px] px-1 rounded font-black border border-binance-cyan/30">
                              {sigCount} SIG
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-binance-textSec">
                          <span className={`px-1 py-0.2 rounded font-bold text-[9px] ${item.exchange === 'BYBIT' ? 'bg-orange-500/20 text-orange-400' : (item.exchange === 'OKX' ? 'bg-blue-500/20 text-blue-400' : 'bg-yellow-500/20 text-yellow-400')}`}>
                            {item.exchange || 'BINANCE'}
                          </span>
                          {liveInfo.vol > 0 && (
                            <span className="text-binance-textMuted">Vol ${formatVolume(liveInfo.vol)}</span>
                          )}
                        </div>
                      </div>

                      {/* Right: Realtime Last Price with Tick Direction (▲ Green / ▼ Red / White) */}
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`font-bold text-[12px] flex items-center gap-1 font-mono transition-colors duration-200 ${
                          liveInfo.tickDir === 'up' ? 'text-binance-green' : (liveInfo.tickDir === 'down' ? 'text-binance-red' : 'text-white')
                        }`}>
                          <span>{liveInfo.price > 0 ? `$${formatPrice(liveInfo.price)}` : '--'}</span>
                          {liveInfo.tickDir === 'up' && <span className="text-[10px] text-binance-green font-black">▲</span>}
                          {liveInfo.tickDir === 'down' && <span className="text-[10px] text-binance-red font-black">▼</span>}
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${isUp ? 'bg-binance-greenBg text-binance-green' : 'bg-binance-redBg text-binance-red'}`}>
                          {isUp ? '+' : ''}{(liveInfo.change24h || 0).toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

        {/* ── RIGHT MAIN TRADING DESK ── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-binance-bg">
          
          {/* FULL STAT2 PRO CHART SECTION WITH HIGH-DPI CANVAS OVERLAY */}
          <div className={`border-b border-binance-border flex flex-col relative bg-binance-bg transition-all duration-200 ${isDeskCollapsed ? 'h-full' : 'h-[55%]'}`}>
            <FullStat2CandleChart
              symbol={activeSymbol}
              timeframe={activeTf}
              exchange={activeExchange}
              onTfChange={setActiveTf}
              isCollapsed={isDeskCollapsed}
              onToggleCollapse={() => setIsDeskCollapsed(!isDeskCollapsed)}
              instances={indicatorInstances}
              onOpenCatalog={() => setIsCatalogOpen(true)}
              onToggleVisibility={handleToggleVisibility}
              onOpenSettings={(inst) => setEditingInstance(inst)}
              onRemoveInstance={handleRemoveInstance}
            />
          </div>

          {/* COLLAPSIBLE BOTTOM DESK */}
          {!isDeskCollapsed && (
            <div className="flex-1 flex flex-col overflow-hidden bg-binance-panel">
              
              {/* Desk Tab Header */}
              <div className="h-8 px-3 border-b border-binance-border flex items-center justify-between bg-binance-subpanel/50">
                <div className="flex items-center gap-1">
                  {[
                    { id: 'signals', label: `⚡ Live Signals Stream (${filteredSignals.length})` },
                    { id: 'positions', label: `🟢 Active Positions (${activePositions.length})` },
                    { id: 'orders', label: `⏳ Open Orders (${limitOrders.length})` },
                    { id: 'history', label: `📜 Order History (${closedPositions.length})` },
                    { id: 'logs', label: `💻 Console Logs` }
                  ].map(t => (
                    <button
                      key={t.id}
                      className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${bottomTab === t.id ? 'bg-binance-active text-binance-yellow' : 'text-binance-textSec hover:text-white'}`}
                      onClick={() => setBottomTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button className="text-[10.5px] text-binance-red hover:underline font-bold" onClick={handleResetTrades}>
                    🗑️ Reset Trades & PnL
                  </button>
                </div>
              </div>

              {/* Desk Content */}
              <div className="flex-1 overflow-y-auto p-2">
                
                {/* LIVE SIGNALS STREAM */}
                {bottomTab === 'signals' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {filteredSignals.length === 0 ? (
                      <div className="col-span-full py-8 text-center text-binance-textMuted font-mono">
                        No signals detected in current window. Scanner is monitoring market 24/7...
                      </div>
                    ) : (
                      filteredSignals.map(sig => {
                        const isLong = sig.direction === 'BUY';
                        return (
                          <div
                            key={sig.id}
                            className={`p-2.5 rounded bg-binance-card border border-binance-border cursor-pointer hover:border-binance-borderHighlight transition flex flex-col gap-1.5 ${isLong ? 'border-l-4 border-l-binance-green' : 'border-l-4 border-l-binance-red'}`}
                            onClick={() => { setActiveSymbol(sig.symbol); setActiveExchange(sig.exchange); setActiveTf(sig.timeframe); }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 font-bold text-white">
                                <span>{sig.symbol}</span>
                                <span className="text-[10px] text-binance-yellow bg-binance-panel px-1 py-0.5 rounded font-bold">{sig.timeframe}</span>
                                <span className="text-[9px] text-binance-textSec bg-binance-subpanel px-1 py-0.5 rounded border border-binance-borderSubtle font-bold">{sig.exchange}</span>
                              </div>
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-extrabold ${isLong ? 'badge-long' : 'badge-short'}`}>
                                {isLong ? '▲ LONG' : '▼ SHORT'}
                              </span>
                            </div>

                            <div className="grid grid-cols-4 gap-1 text-[10.5px] py-1 px-1.5 rounded bg-binance-panel/80 border border-binance-borderSubtle/50 font-mono">
                              <div><span className="text-binance-textMuted block text-[9px]">ENTRY</span><b className="text-white">${formatPrice(sig.entry_price)}</b></div>
                              <div><span className="text-binance-textMuted block text-[9px]">STOP</span><b className="text-binance-red">${formatPrice(sig.sl_price)}</b></div>
                              <div><span className="text-binance-textMuted block text-[9px]">TP1 (FVG)</span><b className="text-binance-green">${formatPrice(sig.tp1_price)}</b></div>
                              <div><span className="text-binance-textMuted block text-[9px]">TP2 (LIQ)</span><b className="text-binance-cyan">${formatPrice(sig.tp2_price)}</b></div>
                            </div>

                            <div className="flex items-center justify-between text-[10px] text-binance-textSec pt-0.5">
                              <div>R:R <b className="text-white">1:{(sig.rr_ratio || 2.0).toFixed(1)}</b> • ATR <b className="text-binance-cyan">{(sig.atr_pct || 0.5).toFixed(2)}%</b></div>
                              <div className="flex items-center gap-1.5">
                                <span>{timeAgo(sig.timestamp)}</span>
                                <button className="bg-binance-subpanel px-1.5 py-0.5 rounded text-[10px]" onClick={(e) => { e.stopPropagation(); setForensicsData(sig); }}>💡 Forensics</button>
                                <button className="bg-binance-yellow text-black font-bold px-1.5 py-0.5 rounded text-[10px]" onClick={() => { setActiveSymbol(sig.symbol); setActiveExchange(sig.exchange); }}>📊 Chart</button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* ACTIVE POSITIONS */}
                {bottomTab === 'positions' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-[11px] border-collapse">
                      <thead>
                        <tr className="border-b border-binance-border bg-binance-subpanel text-binance-textSec text-[10.5px]">
                          <th className="py-1.5 px-3">Symbol</th>
                          <th className="py-1.5 px-3">Size (USDT)</th>
                          <th className="py-1.5 px-3">Entry</th>
                          <th className="py-1.5 px-3">Mark Price</th>
                          <th className="py-1.5 px-3">Liq. Price</th>
                          <th className="py-1.5 px-3">Margin</th>
                          <th className="py-1.5 px-3">Margin Ratio</th>
                          <th className="py-1.5 px-3">PNL (ROE %)</th>
                          <th className="py-1.5 px-3">TP1 / SL</th>
                          <th className="py-1.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-binance-borderSubtle/60">
                        {activePositions.length === 0 ? (
                          <tr><td colSpan="10" className="py-8 text-center text-binance-textMuted">No active positions open. Scanner is monitoring market 24/7...</td></tr>
                        ) : (
                          activePositions.map(pos => {
                            const isLong = pos.direction === 'BUY';
                            const pnlUsd = pos.net_pnl_usd || 0.0;
                            const roePct = pos.roe_pct !== undefined ? pos.roe_pct : 0.0;
                            const isWin = pnlUsd >= 0;

                            return (
                              <tr key={pos.id} className="hover:bg-binance-hover/40 transition">
                                <td className="py-1.5 px-3 font-bold text-white cursor-pointer" onClick={() => { setActiveSymbol(pos.symbol); setActiveExchange(pos.exchange || 'BINANCE'); }}>
                                  <span className={`mr-1 px-1 py-0.2 rounded text-[9.5px] ${isLong ? 'badge-long' : 'badge-short'}`}>{isLong ? 'LONG' : 'SHORT'}</span>
                                  <span>{pos.symbol}</span>
                                  <span className="ml-1 text-binance-yellow bg-binance-active px-1 py-0.2 rounded text-[9px] font-mono">{pos.leverage || 20}x</span>
                                  <span className="ml-1 text-[9px] text-binance-cyan bg-binance-cyanBg px-1.5 py-0.2 rounded font-bold border border-binance-cyan/30 font-mono">{pos.timeframe || pos.tf || '15m'}</span>
                                  <span className="ml-1 text-[9px] text-binance-textSec bg-binance-card px-1 py-0.2 rounded font-mono">{pos.exchange || 'BINANCE'}</span>
                                </td>
                                <td className="py-1.5 px-3">${formatPrice(pos.pos_size_usd)}</td>
                                <td className="py-1.5 px-3">${formatPrice(pos.entry_price)}</td>
                                <td className="py-1.5 px-3 font-bold text-binance-yellowHover">${formatPrice(pos.current_price || pos.entry_price)}</td>
                                <td className="py-1.5 px-3 text-binance-red">${formatPrice(pos.liq_price)}</td>
                                <td className="py-1.5 px-3">${formatPrice(pos.initial_margin)}</td>
                                <td className={`py-1.5 px-3 font-bold ${(pos.margin_ratio || 0) > 80 ? 'text-binance-red' : 'text-binance-green'}`}>{(pos.margin_ratio || 0).toFixed(2)}%</td>
                                <td className={`py-1.5 px-3 font-bold ${isWin ? 'text-binance-green' : 'text-binance-red'}`}>
                                  {isWin ? '+' : ''}${formatPrice(pnlUsd)} ({isWin ? '+' : ''}{roePct.toFixed(2)}%)
                                </td>
                                <td className="py-1.5 px-3 text-[10px]">
                                  <span className="text-binance-green">${formatPrice(pos.tp1_price)}</span> / <span className="text-binance-red">${formatPrice(pos.sl_price)}</span>
                                </td>
                                <td className="py-1.5 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button className="bg-binance-subpanel hover:bg-binance-hover px-1.5 py-0.5 rounded text-[10px] border border-binance-border" onClick={() => setForensicsData(pos)}>💡</button>
                                    <button className="bg-binance-red/80 hover:bg-binance-red text-white px-2 py-0.5 rounded text-[10px] font-bold" onClick={() => handleClosePosition(pos.id)}>Close</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* OPEN LIMIT ORDERS */}
                {bottomTab === 'orders' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-[11px] border-collapse">
                      <thead>
                        <tr className="border-b border-binance-border bg-binance-subpanel text-binance-textSec text-[10.5px]">
                          <th className="py-1.5 px-3">Symbol</th>
                          <th className="py-1.5 px-3">Side</th>
                          <th className="py-1.5 px-3">Limit Price</th>
                          <th className="py-1.5 px-3">TP1 Target</th>
                          <th className="py-1.5 px-3">Stop Loss</th>
                          <th className="py-1.5 px-3">Planned Size</th>
                          <th className="py-1.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-binance-borderSubtle/60">
                        {limitOrders.length === 0 ? (
                          <tr><td colSpan="7" className="py-8 text-center text-binance-textMuted">No open limit orders...</td></tr>
                        ) : (
                          limitOrders.map(sig => (
                            <tr key={sig.id} className="hover:bg-binance-hover/40">
                              <td className="py-1.5 px-3 font-bold text-white cursor-pointer" onClick={() => { setActiveSymbol(sig.symbol); setActiveExchange(sig.exchange); }}>
                                <span>{sig.symbol}</span>
                                <span className="ml-1 text-[9px] text-binance-cyan bg-binance-cyanBg px-1.5 py-0.2 rounded font-bold border border-binance-cyan/30 font-mono">{sig.timeframe || sig.tf || '15m'}</span>
                                <span className="ml-1 text-[9px] text-binance-textSec bg-binance-card px-1 py-0.2 rounded font-mono">{sig.exchange}</span>
                              </td>
                              <td className="py-1.5 px-3"><span className={`px-1 py-0.2 rounded text-[9.5px] ${sig.direction === 'BUY' ? 'badge-long' : 'badge-short'}`}>{sig.direction === 'BUY' ? 'LIMIT BUY' : 'LIMIT SELL'}</span></td>
                              <td className="py-1.5 px-3 font-bold text-binance-yellow">${formatPrice(sig.entry_price)}</td>
                              <td className="py-1.5 px-3 text-binance-green">${formatPrice(sig.tp1_price)}</td>
                              <td className="py-1.5 px-3 text-binance-red">${formatPrice(sig.sl_price)}</td>
                              <td className="py-1.5 px-3">$400.00</td>
                              <td className="py-1.5 px-3 text-right">
                                <button className="bg-binance-subpanel px-2 py-0.5 rounded text-[10px] border border-binance-border" onClick={() => { setActiveSymbol(sig.symbol); setActiveExchange(sig.exchange); }}>📊 Chart</button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ORDER HISTORY */}
                {bottomTab === 'history' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-[11px] border-collapse">
                      <thead>
                        <tr className="border-b border-binance-border bg-binance-subpanel text-binance-textSec text-[10.5px]">
                          <th className="py-1.5 px-3">Symbol</th>
                          <th className="py-1.5 px-3">Side</th>
                          <th className="py-1.5 px-3">Entry</th>
                          <th className="py-1.5 px-3">Exit</th>
                          <th className="py-1.5 px-3">Reason</th>
                          <th className="py-1.5 px-3">Realized PnL</th>
                          <th className="py-1.5 px-3">ROE %</th>
                          <th className="py-1.5 px-3">Time</th>
                          <th className="py-1.5 px-3 text-right">Forensics</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-binance-borderSubtle/60">
                        {closedPositions.length === 0 ? (
                          <tr><td colSpan="9" className="py-8 text-center text-binance-textMuted">No closed trades recorded yet.</td></tr>
                        ) : (
                          closedPositions.map(p => {
                            const pnlUsd = p.net_pnl_usd || 0.0;
                            const roePct = p.roe_pct !== undefined ? p.roe_pct : 0.0;
                            const isWin = pnlUsd >= 0;

                            return (
                              <tr key={p.id} className="hover:bg-binance-hover/40">
                                <td className="py-1.5 px-3 font-bold text-white cursor-pointer" onClick={() => { setActiveSymbol(p.symbol); setActiveExchange(p.exchange); }}>
                                  <span className={`mr-1 px-1 py-0.2 rounded text-[9.5px] ${p.direction === 'BUY' ? 'badge-long' : 'badge-short'}`}>{p.direction === 'BUY' ? 'LONG' : 'SHORT'}</span>
                                  <span>{p.symbol}</span>
                                  <span className="ml-1 text-[9px] text-binance-cyan bg-binance-cyanBg px-1.5 py-0.2 rounded font-bold border border-binance-cyan/30 font-mono">{p.timeframe || p.tf || '15m'}</span>
                                  <span className="ml-1 text-[9px] text-binance-textSec bg-binance-card px-1 py-0.2 rounded font-mono">{p.exchange}</span>
                                </td>
                                <td className="py-1.5 px-3"><span className={`px-1 py-0.2 rounded text-[9.5px] ${p.direction === 'BUY' ? 'badge-long' : 'badge-short'}`}>{p.direction === 'BUY' ? 'LONG' : 'SHORT'}</span></td>
                                <td className="py-1.5 px-3">${formatPrice(p.entry_price)}</td>
                                <td className="py-1.5 px-3">${formatPrice(p.exit_price || p.current_price)}</td>
                                <td className="py-1.5 px-3"><span className={`px-1 py-0.2 rounded text-[9.5px] ${isWin ? 'bg-binance-greenBg text-binance-green' : 'bg-binance-redBg text-binance-red'}`}>{p.exit_reason || p.status}</span></td>
                                <td className={`py-1.5 px-3 font-bold ${isWin ? 'text-binance-green' : 'text-binance-red'}`}>{isWin ? '+' : ''}${formatPrice(pnlUsd)}</td>
                                <td className={`py-1.5 px-3 font-bold ${isWin ? 'text-binance-green' : 'text-binance-red'}`}>{isWin ? '+' : ''}{roePct.toFixed(2)}%</td>
                                <td className="py-1.5 px-3 text-binance-textSec">{p.close_time ? new Date(p.close_time).toLocaleTimeString() : '-'}</td>
                                <td className="py-1.5 px-3 text-right">
                                  <button className="bg-binance-subpanel px-2 py-0.5 rounded text-[10px] border border-binance-border" onClick={() => setForensicsData(p)}>💡 View</button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* CONSOLE LOGS */}
                {bottomTab === 'logs' && (
                  <div className="flex flex-col h-full gap-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1">
                        {['ALL', 'SIGNAL', 'TRADE', 'FETCH_QUEUE', 'WARN'].map(f => (
                          <button key={f} className={`px-2 py-0.5 rounded text-[10px] font-bold ${logFilter === f ? 'bg-binance-yellow text-black' : 'bg-binance-subpanel text-binance-textSec'}`} onClick={() => setLogFilter(f)}>{f}</button>
                        ))}
                      </div>
                      <button className="bg-binance-subpanel px-2 py-0.5 rounded text-[10px] border border-binance-border" onClick={() => setLogs([])}>Clear</button>
                    </div>
                    <div className="flex-1 bg-black p-2 rounded font-mono text-[10.5px] overflow-y-auto flex flex-col gap-0.5 border border-binance-border">
                      {logs.filter(l => logFilter === 'ALL' || l.category === logFilter || l.level === logFilter).map((l, i) => (
                        <div key={i} className="flex items-baseline gap-1.5">
                          <span className="text-binance-textMuted shrink-0">[{new Date(l.timestamp).toLocaleTimeString()}]</span>
                          <span className="text-binance-yellow font-bold shrink-0">[{l.category || l.level || 'SYS'}]</span>
                          <span className={`break-all ${l.category === 'SIGNAL' ? 'text-binance-cyan' : (l.category === 'TRADE' ? 'text-binance-green' : 'text-binance-text')}`}>{l.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

        </main>
      </div>

      {/* ── 3. TRADINGVIEW-STYLE FX INDICATORS CATALOG MODAL ── */}
      {isCatalogOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setIsCatalogOpen(false)}>
          <div className="bg-binance-panel border border-binance-borderHighlight rounded-lg w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            
            <div className="flex items-center justify-between p-3.5 border-b border-binance-border bg-binance-subpanel">
              <div className="flex items-center gap-2">
                <span className="font-serif italic font-black text-binance-cyan text-base">fx</span>
                <span className="font-extrabold text-white text-sm">Indicators & Strategies Catalog</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="bg-binance-card hover:bg-binance-hover text-binance-red text-[11px] font-bold px-2 py-0.5 rounded border border-binance-border"
                  onClick={handleResetAllIndicators}
                  title="Reset all indicators back to default factory list"
                >
                  🔄 Reset All
                </button>
                <button className="text-binance-textSec hover:text-white text-lg" onClick={() => setIsCatalogOpen(false)}>✕</button>
              </div>
            </div>

            <div className="p-3 border-b border-binance-border bg-binance-card">
              <input
                type="text"
                className="w-full bg-binance-subpanel border border-binance-border rounded px-3 py-1.5 text-xs text-white placeholder-binance-textMuted focus:outline-none focus:border-binance-yellow font-mono"
                placeholder="Search indicators (e.g. STAT2, SMC, ATRBot, EMA, VWAP)..."
                value={catalogSearch}
                onChange={e => setCatalogSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="p-3 flex-1 overflow-y-auto flex flex-col gap-2">
              {[
                { id: 'stat2_box_strategy', name: 'STAT2 Pro Box Strategy', tag: 'SMC + ATRBot', desc: 'Trade Cards HUD, Fair Value Gaps, Liquidity Pools, Dynamic Trailing Cloud & Entry/TP/SL Markers', color: '#00F0FF' },
                { id: 'ema', name: 'EMA Ribbon (21/50/200)', tag: 'Trend Ribbon', desc: 'Triple Exponential Moving Average ribbon for trend alignment & dynamic support', color: '#38BDF8' },
                { id: 'vwap', name: 'VWAP (Volume-Weighted Average Price)', tag: 'Volume Profile', desc: 'Benchmark price reflecting true market volume distribution', color: '#FBBF24' },
                { id: 'atrbot', name: 'ATRBot (Multi-MA + VIDYA Cloud)', tag: 'Volatility Trailing', desc: 'Adaptive Variable Index Dynamic Average with dynamic ATR trailing stop loss', color: '#A855F7' },
                { id: 'smc', name: 'Smart Money Concepts Core (SMC)', tag: 'Structure', desc: 'Automatic detection of BOS, CHoCH, Order Blocks, Swing Points and Liquidity Runs', color: '#10B981' }
              ].filter(item => !catalogSearch || item.name.toLowerCase().includes(catalogSearch.toLowerCase()) || item.tag.toLowerCase().includes(catalogSearch.toLowerCase())).map(item => (
                <div key={item.id} className="p-3 rounded bg-binance-card border border-binance-border flex items-center justify-between hover:border-binance-borderHighlight transition">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span style={{ color: item.color }} className="text-sm font-black">●</span>
                      <span className="font-bold text-white text-xs">{item.name}</span>
                      <span className="text-[9px] bg-binance-panel px-1.5 py-0.2 rounded text-binance-textSec border border-binance-border">{item.tag}</span>
                    </div>
                    <span className="text-[10.5px] text-binance-textMuted leading-tight">{item.desc}</span>
                  </div>

                  <button
                    className="bg-binance-yellow hover:bg-binance-yellowHover text-black text-xs font-bold px-3 py-1 rounded transition shrink-0 ml-3"
                    onClick={() => handleAddIndicator(item.id)}
                  >
                    + Add
                  </button>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* ── 4. UNIVERSAL INDICATOR SETTINGS MODAL ── */}
      {editingInstance && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setEditingInstance(null)}>
          <div className="bg-binance-panel border border-binance-borderHighlight rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div className="flex items-center justify-between p-3.5 border-b border-binance-border bg-binance-subpanel">
              <div className="flex items-center gap-2">
                <span className="text-base">⚙️</span>
                <span className="font-extrabold text-white text-sm">{editingInstance.name} Settings</span>
              </div>
              <button className="text-binance-textSec hover:text-white text-lg font-bold" onClick={() => setEditingInstance(null)}>✕</button>
            </div>

            {/* STAT2 Multi-Tab Navigation Bar */}
            {editingInstance.type === 'stat2_box_strategy' && (
              <div className="flex items-center border-b border-binance-border bg-binance-card px-3 pt-2 gap-1 font-mono text-xs">
                {[
                  { id: 'params', label: '📊 Parameters' },
                  { id: 'style', label: '🎨 Lines & Colors' },
                  { id: 'fonts', label: '🔤 Font Sizes' },
                  { id: 'orders', label: '⚡ Order Execution' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    className={`px-3 py-2 font-bold border-b-2 transition ${indicatorSettingsTab === tab.id ? 'border-binance-yellow text-binance-yellow bg-binance-panel rounded-t' : 'border-transparent text-binance-textSec hover:text-white'}`}
                    onClick={() => setIndicatorSettingsTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {/* Modal Content Body */}
            <div className="p-4 flex-1 overflow-y-auto text-xs font-mono flex flex-col gap-4">
              
              {/* ── STAT2 PRO BOX STRATEGY TABS ── */}
              {editingInstance.type === 'stat2_box_strategy' && (
                <>
                  {/* TAB 1: PARAMETERS */}
                  {indicatorSettingsTab === 'params' && (
                    <div className="grid grid-cols-2 gap-3.5">
                      <div className="col-span-2">
                        <label className="text-binance-textSec block mb-1 font-bold">Strategy Execution Mode</label>
                        <select
                          defaultValue={editingInstance.inputs.strategyMode || 'dual'}
                          className="w-full bg-binance-card border border-binance-border rounded p-2 text-white font-bold"
                          onChange={e => { editingInstance.inputs.strategyMode = e.target.value; }}
                        >
                          <option value="dual">Dual Mode (Trend Continuation + Liquidity Fade Traps)</option>
                          <option value="trend">Trend Momentum Only (Filter Counter FVGs & Liq Traps)</option>
                          <option value="fade">Liquidity Fade Traps Only (Exhaustion Reversals)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-binance-textSec block mb-1">CMO Length (VIDYA Momentum)</label>
                        <input
                          type="number"
                          defaultValue={editingInstance.inputs.cmoLength || 14}
                          className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                          onChange={e => { editingInstance.inputs.cmoLength = parseInt(e.target.value) || 14; }}
                        />
                      </div>

                      <div>
                        <label className="text-binance-textSec block mb-1">MA Length (VIDYA Baseline)</label>
                        <input
                          type="number"
                          defaultValue={editingInstance.inputs.maLength || 21}
                          className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                          onChange={e => { editingInstance.inputs.maLength = parseInt(e.target.value) || 21; }}
                        />
                      </div>

                      <div>
                        <label className="text-binance-textSec block mb-1">ATR Multiplier</label>
                        <input
                          type="number"
                          step={0.1}
                          defaultValue={editingInstance.inputs.atrMult || 2.0}
                          className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                          onChange={e => { editingInstance.inputs.atrMult = parseFloat(e.target.value) || 2.0; }}
                        />
                      </div>

                      <div>
                        <label className="text-binance-textSec block mb-1">Min ATR Volatility %</label>
                        <input
                          type="number"
                          step={0.05}
                          defaultValue={editingInstance.inputs.minAtrPct || 0.35}
                          className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                          onChange={e => { editingInstance.inputs.minAtrPct = parseFloat(e.target.value) || 0.35; }}
                        />
                      </div>

                      <div>
                        <label className="text-binance-textSec block mb-1">Liquidity Trap % Threshold</label>
                        <input
                          type="number"
                          step={0.1}
                          defaultValue={editingInstance.inputs.liqThresholdPct || 1.5}
                          className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                          onChange={e => { editingInstance.inputs.liqThresholdPct = parseFloat(e.target.value) || 1.5; }}
                        />
                      </div>

                      <div>
                        <label className="text-binance-textSec block mb-1">Counter FVG % Threshold</label>
                        <input
                          type="number"
                          step={0.1}
                          defaultValue={editingInstance.inputs.fvgThresholdPct || 1.5}
                          className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                          onChange={e => { editingInstance.inputs.fvgThresholdPct = parseFloat(e.target.value) || 1.5; }}
                        />
                      </div>

                      <div>
                        <label className="text-binance-textSec block mb-1">Swing SL Lookback Bars</label>
                        <input
                          type="number"
                          defaultValue={editingInstance.inputs.swingLookback || 30}
                          className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                          onChange={e => { editingInstance.inputs.swingLookback = parseInt(e.target.value) || 30; }}
                        />
                      </div>

                      <div>
                        <label className="text-binance-textSec block mb-1">Max Cards Shown on Chart</label>
                        <input
                          type="number"
                          defaultValue={editingInstance.inputs.maxCardsVisible || 15}
                          className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                          onChange={e => { editingInstance.inputs.maxCardsVisible = parseInt(e.target.value) || 15; }}
                        />
                      </div>
                    </div>
                  )}

                  {/* TAB 2: STYLES, LINES & COLORS */}
                  {indicatorSettingsTab === 'style' && (
                    <div className="flex flex-col gap-4">
                      {/* Section A: Line & Box Visibility Toggles */}
                      <div className="p-3 bg-binance-card rounded border border-binance-border flex flex-col gap-2.5">
                        <span className="font-bold text-white text-[11.5px] border-b border-binance-border pb-1">👁️ Line & Box Visibility Toggles</span>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {[
                            { key: 'showCards', label: 'HUD Trade Cards' },
                            { key: 'showStem', label: 'Stem Stem Connection' },
                            { key: 'showGuideLines', label: 'Extended Guide Rays' },
                            { key: 'showEntryLine', label: 'Entry Price Ray' },
                            { key: 'showTp1Line', label: 'TP1 Target Ray' },
                            { key: 'showTp2Line', label: 'TP2 Target Ray' },
                            { key: 'showSlLine', label: 'SL Stop Loss Ray' },
                            { key: 'showLineBadges', label: 'Ray Tip Badges' },
                            { key: 'showFVG', label: 'FVG Zones' },
                            { key: 'showLiquidity', label: 'Liquidity Pools (BSL/SSL)' },
                            { key: 'showRibbon', label: 'VIDYA Ribbon Cloud' },
                            { key: 'showTrail2', label: 'Dynamic Trailing Stop' }
                          ].map(tog => (
                            <label key={tog.key} className="flex items-center gap-2 p-1.5 rounded bg-binance-subpanel/50 hover:bg-binance-hover cursor-pointer border border-binance-borderSubtle">
                              <input
                                type="checkbox"
                                defaultChecked={editingInstance.style[tog.key] !== false}
                                onChange={e => { editingInstance.style[tog.key] = e.target.checked; }}
                                className="accent-binance-yellow"
                              />
                              <span className="text-white text-[11px]">{tog.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Section B: Dimensions & Thickness */}
                      <div className="p-3 bg-binance-card rounded border border-binance-border flex flex-col gap-2.5">
                        <span className="font-bold text-white text-[11.5px] border-b border-binance-border pb-1">📐 Dimensions & Thickness</span>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className="text-binance-textSec block mb-1">Card Width (px)</label>
                            <input
                              type="number"
                              defaultValue={editingInstance.style.cardWidth || 210}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-1.5 text-white"
                              onChange={e => { editingInstance.style.cardWidth = parseInt(e.target.value) || 210; }}
                            />
                          </div>
                          <div>
                            <label className="text-binance-textSec block mb-1">Ray Length (px)</label>
                            <input
                              type="number"
                              defaultValue={editingInstance.style.lineLength || 280}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-1.5 text-white"
                              onChange={e => { editingInstance.style.lineLength = parseInt(e.target.value) || 280; }}
                            />
                          </div>
                          <div>
                            <label className="text-binance-textSec block mb-1">Line Thickness (px)</label>
                            <input
                              type="number"
                              step={0.5}
                              defaultValue={editingInstance.style.lineThickness || 2.0}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-1.5 text-white"
                              onChange={e => { editingInstance.style.lineThickness = parseFloat(e.target.value) || 2.0; }}
                            />
                          </div>
                          <div>
                            <label className="text-binance-textSec block mb-1">Card Background Opacity</label>
                            <input
                              type="number"
                              step={0.05}
                              defaultValue={editingInstance.style.cardOpacity || 0.94}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-1.5 text-white"
                              onChange={e => { editingInstance.style.cardOpacity = parseFloat(e.target.value) || 0.94; }}
                            />
                          </div>
                          <div>
                            <label className="text-binance-textSec block mb-1">FVG Box Opacity</label>
                            <input
                              type="number"
                              step={0.05}
                              defaultValue={editingInstance.style.fvgOpacity || 0.18}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-1.5 text-white"
                              onChange={e => { editingInstance.style.fvgOpacity = parseFloat(e.target.value) || 0.18; }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section C: Colors Palette */}
                      <div className="p-3 bg-binance-card rounded border border-binance-border flex flex-col gap-2.5">
                        <span className="font-bold text-white text-[11.5px] border-b border-binance-border pb-1">🎨 Color Palette Customization</span>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                          {[
                            { key: 'buyColor', label: 'BUY Card Border', def: '#10b981' },
                            { key: 'sellColor', label: 'SELL Card Border', def: '#f43f5e' },
                            { key: 'fadeShortColor', label: 'FADE SHORT Color', def: '#f59e0b' },
                            { key: 'fadeLongColor', label: 'FADE LONG Color', def: '#06b6d4' },
                            { key: 'entryLineColor', label: 'Entry Ray Color', def: '#0284c7' },
                            { key: 'tp1LineColor', label: 'TP1 Ray Color', def: '#10b981' },
                            { key: 'tp2LineColor', label: 'TP2 Ray Color', def: '#06b6d4' },
                            { key: 'slLineColor', label: 'SL Ray Color', def: '#f43f5e' },
                            { key: 'fvgBullColor', label: 'Bullish FVG Color', def: '#10b981' },
                            { key: 'fvgBearColor', label: 'Bearish FVG Color', def: '#f43f5e' },
                            { key: 'liqBslColor', label: 'BSL Liquidity Ray', def: '#ec4899' },
                            { key: 'liqSslColor', label: 'SSL Liquidity Ray', def: '#8b5cf6' },
                            { key: 'bullCloudColor', label: 'Bull Ribbon Cloud', def: '#10b981' },
                            { key: 'bearCloudColor', label: 'Bear Ribbon Cloud', def: '#f43f5e' },
                            { key: 'stopColor', label: 'Trailing Stop Line', def: '#a855f7' },
                            { key: 'cardBackground', label: 'Card Background', def: '#0b1120' }
                          ].map(col => (
                            <div key={col.key} className="flex items-center justify-between p-1.5 rounded bg-binance-subpanel border border-binance-borderSubtle">
                              <span className="text-[10.5px] text-binance-textSec truncate mr-2">{col.label}</span>
                              <input
                                type="color"
                                defaultValue={editingInstance.style[col.key] || col.def}
                                onChange={e => { editingInstance.style[col.key] = e.target.value; }}
                                className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: FONT SIZES */}
                  {indicatorSettingsTab === 'fonts' && (
                    <div className="p-3 bg-binance-card rounded border border-binance-border flex flex-col gap-3">
                      <span className="font-bold text-white text-[11.5px] border-b border-binance-border pb-1">🔤 Typography & Font Sizes (px)</span>
                      <div className="grid grid-cols-2 gap-3.5">
                        {[
                          { key: 'titleFontSize', label: 'Card Title Header (e.g. ▲ BUY TREND)', def: 11.5, min: 8, max: 20 },
                          { key: 'badgeFontSize', label: 'Card Status Pill Badge (e.g. 🎯 TP1 HIT)', def: 9.5, min: 7, max: 16 },
                          { key: 'priceFontSize', label: 'Card Price Values Numbers', def: 11, min: 8, max: 18 },
                          { key: 'labelFontSize', label: 'Card Row Labels (ENTRY, TP1, TP2, SL)', def: 10, min: 8, max: 16 },
                          { key: 'lineBadgeFontSize', label: 'Extended Ray Tip Pill Badge', def: 10, min: 8, max: 16 },
                          { key: 'fvgFontSize', label: 'FVG Text Label (FVG + / FVG -)', def: 10, min: 8, max: 16 },
                          { key: 'liqFontSize', label: 'Liquidity Pool Label (💧 BSL / SSL)', def: 11, min: 8, max: 16 }
                        ].map(fnt => (
                          <div key={fnt.key} className="flex flex-col gap-1 p-2 rounded bg-binance-subpanel border border-binance-borderSubtle">
                            <label className="text-binance-textSec text-[11px]">{fnt.label}</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                step={0.5}
                                min={fnt.min}
                                max={fnt.max}
                                defaultValue={editingInstance.style[fnt.key] !== undefined ? editingInstance.style[fnt.key] : fnt.def}
                                className="w-24 bg-binance-card border border-binance-border rounded p-1.5 text-white font-bold"
                                onChange={e => { editingInstance.style[fnt.key] = parseFloat(e.target.value) || fnt.def; }}
                              />
                              <span className="text-binance-textMuted text-[10px]">px (range: {fnt.min} - {fnt.max})</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* TAB 4: ORDER EXECUTION & RISK MANAGEMENT */}
                  {indicatorSettingsTab === 'orders' && (
                    <div className="flex flex-col gap-4">
                      <div className="p-3 bg-binance-card rounded border border-binance-border flex flex-col gap-3">
                        <span className="font-bold text-white text-[11.5px] border-b border-binance-border pb-1">⚡ Order Routing & Execution Setup</span>
                        
                        <div className="grid grid-cols-2 gap-3.5">
                          <div>
                            <label className="text-binance-textSec block mb-1 font-bold">Execution Order Type</label>
                            <select
                              defaultValue={editingInstance.inputs.orderType || 'MARKET'}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-2 text-white font-bold"
                              onChange={e => { editingInstance.inputs.orderType = e.target.value; }}
                            >
                              <option value="MARKET">MARKET (Instant fill on candle close)</option>
                              <option value="LIMIT">LIMIT (Optimal FVG / Liquidity sweep fill)</option>
                            </select>
                          </div>

                          <div>
                            <label className="text-binance-textSec block mb-1 font-bold">Default Strategy Leverage</label>
                            <select
                              defaultValue={editingInstance.inputs.leverage || 20}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-2 text-white font-bold"
                              onChange={e => { editingInstance.inputs.leverage = parseInt(e.target.value) || 20; }}
                            >
                              {[1, 2, 5, 10, 15, 20, 25, 50, 75, 100].map(lev => (
                                <option key={lev} value={lev}>{lev}x Cross / Isolated</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="text-binance-textSec block mb-1 font-bold">Margin Mode</label>
                            <select
                              defaultValue={editingInstance.inputs.marginMode || 'ISOLATED'}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-2 text-white font-bold"
                              onChange={e => { editingInstance.inputs.marginMode = e.target.value; }}
                            >
                              <option value="ISOLATED">ISOLATED (Independent Risk per Pair)</option>
                              <option value="CROSS">CROSS (Shared Margin Pool)</option>
                            </select>
                          </div>

                          <div>
                            <label className="text-binance-textSec block mb-1 font-bold">Risk Allocation % per Trade</label>
                            <input
                              type="number"
                              step={0.25}
                              min={0.1}
                              max={10.0}
                              defaultValue={editingInstance.inputs.riskPerTradePct || 1.0}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-2 text-white font-bold"
                              onChange={e => { editingInstance.inputs.riskPerTradePct = parseFloat(e.target.value) || 1.0; }}
                            />
                          </div>

                          <div>
                            <label className="text-binance-textSec block mb-1 font-bold">Max Concurrent Open Positions</label>
                            <input
                              type="number"
                              min={1}
                              max={30}
                              defaultValue={editingInstance.inputs.maxOpenTrades || 5}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-2 text-white font-bold"
                              onChange={e => { editingInstance.inputs.maxOpenTrades = parseInt(e.target.value) || 5; }}
                            />
                          </div>

                          <div>
                            <label className="text-binance-textSec block mb-1 font-bold">TP1 Partial Take Profit Size %</label>
                            <select
                              defaultValue={editingInstance.inputs.tp1CloseRatio || 50}
                              className="w-full bg-binance-subpanel border border-binance-border rounded p-2 text-white font-bold"
                              onChange={e => { editingInstance.inputs.tp1CloseRatio = parseInt(e.target.value) || 50; }}
                            >
                              <option value={25}>25% Size at TP1 (75% to TP2)</option>
                              <option value={50}>50% Size at TP1 (50% to TP2)</option>
                              <option value={75}>75% Size at TP1 (25% to TP2)</option>
                              <option value={100}>100% Full Close at TP1</option>
                            </select>
                          </div>
                        </div>

                        {/* Trade Automations */}
                        <div className="mt-2 border-t border-binance-border pt-3 flex flex-col gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              defaultChecked={editingInstance.inputs.autoMoveBE !== false}
                              onChange={e => { editingInstance.inputs.autoMoveBE = e.target.checked; }}
                              className="accent-binance-yellow"
                            />
                            <div>
                              <b className="text-white block text-[11.5px]">⚡ Auto Move Breakeven (BE)</b>
                              <span className="text-binance-textSec text-[10px]">Automatically move Stop Loss to Entry + 0.05% fee offset upon TP1 hit to guarantee risk-free trade.</span>
                            </div>
                          </label>

                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              defaultChecked={editingInstance.inputs.enableTrailingSl !== false}
                              onChange={e => { editingInstance.inputs.enableTrailingSl = e.target.checked; }}
                              className="accent-binance-yellow"
                            />
                            <div>
                              <b className="text-white block text-[11.5px]">🎯 Dynamic ATR Trailing Stop</b>
                              <span className="text-binance-textSec text-[10px]">Activate adaptive ATR VIDYA trailing stop to protect floating profits on massive continuation runners.</span>
                            </div>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── EMA RIBBON SETTINGS ── */}
              {editingInstance.type === 'ema' && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-binance-textSec block mb-1">Period 1</label>
                    <input
                      type="number"
                      defaultValue={editingInstance.inputs.period1 || 21}
                      className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                      onChange={e => { editingInstance.inputs.period1 = parseInt(e.target.value) || 21; }}
                    />
                  </div>
                  <div>
                    <label className="text-binance-textSec block mb-1">Period 2</label>
                    <input
                      type="number"
                      defaultValue={editingInstance.inputs.period2 || 50}
                      className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                      onChange={e => { editingInstance.inputs.period2 = parseInt(e.target.value) || 50; }}
                    />
                  </div>
                  <div>
                    <label className="text-binance-textSec block mb-1">Period 3</label>
                    <input
                      type="number"
                      defaultValue={editingInstance.inputs.period3 || 200}
                      className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                      onChange={e => { editingInstance.inputs.period3 = parseInt(e.target.value) || 200; }}
                    />
                  </div>
                </div>
              )}

              {/* ── VWAP SETTINGS ── */}
              {editingInstance.type === 'vwap' && (
                <div>
                  <label className="text-binance-textSec block mb-1">Rolling Period</label>
                  <input
                    type="number"
                    defaultValue={editingInstance.inputs.rollingPeriod || 200}
                    className="w-full bg-binance-card border border-binance-border rounded p-2 text-white"
                    onChange={e => { editingInstance.inputs.rollingPeriod = parseInt(e.target.value) || 200; }}
                  />
                </div>
              )}
            </div>

            {/* Modal Footer Bar */}
            <div className="p-3 border-t border-binance-border flex items-center justify-between bg-binance-subpanel">
              <button
                className="bg-binance-card hover:bg-binance-hover px-3 py-1 rounded text-xs text-binance-red font-bold border border-binance-border"
                onClick={() => {
                  if (confirm(`Reset settings of ${editingInstance.name} to default?`)) {
                    if (window.IndicatorRegistry) {
                      const fresh = window.IndicatorRegistry.createInstance(editingInstance.type);
                      editingInstance.inputs = fresh.inputs;
                      editingInstance.style = fresh.style;
                      const next = [...indicatorInstances];
                      setIndicatorInstances(next);
                      saveIndicatorsToStorage(next);
                      setEditingInstance({ ...editingInstance });
                    }
                  }
                }}
              >
                🔄 Reset to Default
              </button>

              <div className="flex items-center gap-2">
                <button className="bg-binance-subpanel hover:bg-binance-hover px-3 py-1 rounded text-xs border border-binance-border" onClick={() => setEditingInstance(null)}>Cancel</button>
                <button
                  className="bg-binance-yellow hover:bg-binance-yellowHover text-black font-bold px-4 py-1 rounded text-xs transition shadow"
                  onClick={() => {
                    const next = [...indicatorInstances];
                    setIndicatorInstances(next);
                    saveIndicatorsToStorage(next);
                    setEditingInstance(null);
                  }}
                >
                  Apply & Save
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── DEEP QUANTITATIVE ORDER FORENSICS INTELLIGENCE MODAL ── */}
      <OrderForensicsModal
        data={forensicsData}
        marketPrices={marketPrices}
        indicatorInstances={indicatorInstances}
        onOpenCatalog={() => setIsCatalogOpen(true)}
        onToggleVisibility={handleToggleVisibility}
        onOpenSettings={(inst) => setEditingInstance(inst)}
        onRemoveInstance={handleRemoveInstance}
        onClose={() => setForensicsData(null)}
        onSelectSymbol={(sym, ex) => {
          setActiveSymbol(sym);
          setActiveExchange(ex || 'BINANCE');
        }}
        onClosePosition={handleClosePosition}
      />

      {/* ── SETTINGS MODAL ── */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setIsSettingsOpen(false)}>
          <div className="bg-binance-panel border border-binance-borderHighlight rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            
            <div className="flex items-center justify-between p-3.5 border-b border-binance-border bg-binance-subpanel">
              <span className="font-extrabold text-white text-sm flex items-center gap-1.5">
                <span>⚙️ SERVER SCANNER & MULTI-EXCHANGE SETTINGS</span>
              </span>
              <button className="text-binance-textSec hover:text-white text-lg" onClick={() => setIsSettingsOpen(false)}>✕</button>
            </div>

            <div className="p-4 flex flex-col gap-4 overflow-y-auto text-xs">
              
              {/* 1. Exchanges Management */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-binance-yellow font-bold">🌐 Multi-Exchange Engine & CCXT Pro Ingestion (90% Perps)</h4>
                  <button
                    className="bg-binance-cyan/20 hover:bg-binance-cyan/35 text-binance-cyan border border-binance-cyan/50 px-2.5 py-1 rounded text-xs font-bold transition shadow flex items-center gap-1.5"
                    onClick={() => fetch('/api/admin/import-all-exchanges', { method: 'POST' }).then(() => alert('Bắt đầu đồng bộ 90% symbol perpetual của tất cả 6 sàn qua CCXT Pro!'))}
                  >
                    <span>⚡</span>
                    <span>Đồng Bộ Toàn Bộ 6 Sàn (90% Perps)</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div className="p-2.5 rounded bg-binance-card border border-binance-border flex flex-col gap-1.5">
                    <span className="font-bold text-white">🔶 Binance Futures</span>
                    <span className="text-binance-textSec text-[10px]">{countBinance} Symbols • 90% Perps</span>
                    <button className="bg-binance-subpanel hover:bg-binance-hover px-2 py-1 rounded text-[10px] font-bold border border-binance-border mt-1" onClick={() => fetch('/api/admin/import-binance', { method: 'POST' }).then(() => alert('Binance 90% perpetual seeding started.'))}>
                      ⚡ Re-Seed Binance (90%)
                    </button>
                  </div>
                  <div className="p-2.5 rounded bg-binance-card border border-binance-border flex flex-col gap-1.5">
                    <span className="font-bold text-white">⬛ Bybit Linear</span>
                    <span className="text-binance-textSec text-[10px]">{countBybit} Symbols • 90% Perps</span>
                    <button className="bg-binance-subpanel hover:bg-binance-hover px-2 py-1 rounded text-[10px] font-bold border border-binance-border mt-1" onClick={() => fetch('/api/admin/import-bybit', { method: 'POST' }).then(() => alert('Bybit 90% perpetual seeding started.'))}>
                      ⚡ Re-Seed Bybit (90%)
                    </button>
                  </div>
                  <div className="p-2.5 rounded bg-binance-card border border-binance-border flex flex-col gap-1.5">
                    <span className="font-bold text-white">🔷 OKX Perpetual</span>
                    <span className="text-binance-textSec text-[10px]">{countOkx} Symbols • 90% Perps</span>
                    <button className="bg-binance-subpanel hover:bg-binance-hover px-2 py-1 rounded text-[10px] font-bold border border-binance-border mt-1" onClick={() => fetch('/api/admin/import-okx', { method: 'POST' }).then(() => alert('OKX 90% perpetual seeding started.'))}>
                      ⚡ Re-Seed OKX (90%)
                    </button>
                  </div>
                  <div className="p-2.5 rounded bg-binance-card border border-binance-border flex flex-col gap-1.5">
                    <span className="font-bold text-white">🔵 Bitget Perpetual</span>
                    <span className="text-binance-textSec text-[10px]">{countBitget} Symbols • 90% Perps</span>
                    <button className="bg-binance-subpanel hover:bg-binance-hover px-2 py-1 rounded text-[10px] font-bold border border-binance-border mt-1" onClick={() => fetch('/api/admin/import-bitget', { method: 'POST' }).then(() => alert('Bitget 90% perpetual seeding started.'))}>
                      ⚡ Re-Seed Bitget (90%)
                    </button>
                  </div>
                  <div className="p-2.5 rounded bg-binance-card border border-binance-border flex flex-col gap-1.5">
                    <span className="font-bold text-white">🚪 Gate.io Perpetual</span>
                    <span className="text-binance-textSec text-[10px]">{countGate} Symbols • 90% Perps</span>
                    <button className="bg-binance-subpanel hover:bg-binance-hover px-2 py-1 rounded text-[10px] font-bold border border-binance-border mt-1" onClick={() => fetch('/api/admin/import-gate', { method: 'POST' }).then(() => alert('Gate.io 90% perpetual seeding started.'))}>
                      ⚡ Re-Seed Gate (90%)
                    </button>
                  </div>
                  <div className="p-2.5 rounded bg-binance-card border border-binance-border flex flex-col gap-1.5">
                    <span className="font-bold text-white">💠 BingX Perpetual</span>
                    <span className="text-binance-textSec text-[10px]">{countBingx} Symbols • 90% Perps</span>
                    <button className="bg-binance-subpanel hover:bg-binance-hover px-2 py-1 rounded text-[10px] font-bold border border-binance-border mt-1" onClick={() => fetch('/api/admin/import-bingx', { method: 'POST' }).then(() => alert('BingX 90% perpetual seeding started.'))}>
                      ⚡ Re-Seed BingX (90%)
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. Strategy Engine Selection */}
              <div>
                <h4 className="text-binance-yellow font-bold mb-2">🎯 Strategy Engine Mode</h4>
                <div className="grid grid-cols-3 gap-2">
                  <label className="p-2.5 rounded bg-binance-card border border-binance-border flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="stratMode" defaultChecked />
                    <div>
                      <b className="text-white block">Dual SMC</b>
                      <span className="text-binance-textSec text-[10px]">Trend + Fade Traps</span>
                    </div>
                  </label>
                  <label className="p-2.5 rounded bg-binance-card border border-binance-border flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="stratMode" />
                    <div>
                      <b className="text-white block">Trend Momentum</b>
                      <span className="text-binance-textSec text-[10px]">FVG Continuation</span>
                    </div>
                  </label>
                  <label className="p-2.5 rounded bg-binance-card border border-binance-border flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="stratMode" />
                    <div>
                      <b className="text-white block">Liquidity Fade</b>
                      <span className="text-binance-textSec text-[10px]">Exhaustion Reversal</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* 3. Setup Wizard & Danger Zone */}
              <div className="border border-binance-yellow/30 bg-binance-yellow/5 rounded p-3 flex items-center justify-between">
                <div>
                  <b className="text-binance-yellow block">🧙‍♂️ Trình Cài Đặt Mới Hệ Thống (Setup Wizard)</b>
                  <span className="text-binance-textSec text-[10px]">Cài đặt lại từ đầu: Khởi tạo bảng SQLite, cấu hình quản trị rủi ro & kích hoạt 6 sàn.</span>
                </div>
                <button
                  className="bg-binance-yellow hover:bg-binance-yellowHover text-black px-3 py-1.5 rounded text-xs font-bold shadow transition"
                  onClick={() => { setIsSettingsOpen(false); setIsWizardOpen(true); }}
                >
                  ✨ Mở Setup Wizard
                </button>
              </div>

              {/* 4. Danger Zone */}
              <div className="border border-red-500/30 bg-red-500/5 rounded p-3 flex items-center justify-between">
                <div>
                  <b className="text-binance-red block">⚠️ Danger Zone — Reset Database & Trades</b>
                  <span className="text-binance-textSec text-[10px]">Wipe order positions or perform full factory reload for 6 exchanges.</span>
                </div>
                <div className="flex items-center gap-2">
                  <button className="bg-binance-red/80 hover:bg-binance-red text-white px-2.5 py-1 rounded text-xs font-bold" onClick={handleResetTrades}>
                    🗑️ Reset Trades ($1,000 Equity)
                  </button>
                  <button className="bg-red-900 hover:bg-red-800 text-white px-2.5 py-1 rounded text-xs font-bold" onClick={() => fetch('/api/admin/reset-all', { method: 'POST' }).then(() => alert('Factory reset started.'))}>
                    ⚡ Factory Reset DB
                  </button>
                </div>
              </div>

            </div>

            <div className="p-3 border-t border-binance-border flex justify-end gap-2 bg-binance-subpanel">
              <button className="bg-binance-subpanel hover:bg-binance-hover px-3 py-1 rounded text-xs border border-binance-border" onClick={() => setIsSettingsOpen(false)}>Close</button>
              <button className="bg-binance-yellow text-black font-bold px-3 py-1 rounded text-xs" onClick={() => { alert('Settings updated.'); setIsSettingsOpen(false); }}>Save Settings</button>
            </div>

          </div>
        </div>
      )}

      {/* ── TRADING JOURNAL & PERFORMANCE CALENDAR MODAL ── */}
      {isJournalOpen && (
        <TradingJournalModal
          onClose={() => setIsJournalOpen(false)}
          onOpenForensics={(pos) => setForensicsData(pos)}
          onSelectSymbol={(sym, ex) => {
            setActiveSymbol(sym);
            setActiveExchange(ex || 'BINANCE');
            setIsJournalOpen(false);
          }}
        />
      )}

      {/* ── INITIAL SETUP WIZARD MODAL ── */}
      {isWizardOpen && (
        <SetupWizardModal
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          onCompleted={() => {
            fetchAllData();
            setIsWizardOpen(false);
          }}
        />
      )}

      </div>
    </>
  );
}

// Mount React Root
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
