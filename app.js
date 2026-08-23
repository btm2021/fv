/**
 * SMC FVG, VSR & Dual ATR Bot Real-Time Engine (Pure JavaScript - stat2.js)
 * Standalone client-side direct live Binance Futures calculation, exchangeInfo dynamic symbol search, 24h ticker caching & WebSocket streaming
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'smc_stat2_settings_v4';
  const TICKER_CACHE_TTL = 60000; // 60 seconds cache to avoid spamming Binance API

  const HOT_SYMBOLS = new Set([
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
    'ADAUSDT', 'AVAXUSDT', 'SUIUSDT', 'NEARUSDT', 'LINKUSDT', 'PEPEUSDT',
    'APTUSDT', 'ARBUSDT', 'OPUSDT', 'LTCUSDT', 'TIAUSDT', 'INJUSDT',
    'FTMUSDT', 'IMXUSDT', '1000PEPEUSDT', '1000SHIBUSDT', '1000BONKUSDT',
    'WIFUSDT', 'RENDERUSDT', 'FETUSDT', 'TAOUSDT'
  ]);

  const MEME_SYMBOLS = new Set([
    'DOGEUSDT', 'PEPEUSDT', '1000PEPEUSDT', '1000SHIBUSDT', '1000BONKUSDT',
    '1000FLOKIUSDT', 'WIFUSDT', 'BOMEUSDT', 'NEIROUSDT', 'MEMEUSDT', '1000CATUSDT'
  ]);

  const L1_SYMBOLS = new Set([
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'AVAXUSDT',
    'NEARUSDT', 'SUIUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'DOTUSDT',
    'POLUSDT', 'SEIUSDT', 'INJUSDT', 'FTMUSDT', 'ATOMUSDT', 'ALGOUSDT'
  ]);

  const YAHOO_MARKETS = {
    forex: [
      'EURUSD=X', 'GBPUSD=X', 'JPY=X', 'CHF=X', 'AUDUSD=X', 'CAD=X', 'NZDUSD=X',
      'EURGBP=X', 'EURJPY=X', 'EURCHF=X', 'EURAUD=X', 'EURCAD=X', 'GBPJPY=X',
      'GBPCHF=X', 'GBPAUD=X', 'AUDJPY=X', 'AUDCAD=X', 'AUDNZD=X', 'CADJPY=X',
      'CHFJPY=X', 'NZDJPY=X'
    ],
    stocks: [
      'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'GOOG', 'BRK-B',
      'JPM', 'V', 'MA', 'WMT', 'LLY', 'XOM', 'JNJ', 'ORCL', 'COST', 'NFLX',
      'AMD', 'CRM', 'ADBE', 'INTC', 'QCOM', 'MU', 'AMAT', 'CSCO', 'IBM', 'UBER',
      'ABNB', 'SHOP', 'PLTR', 'COIN', 'BAC', 'GS', 'MS', 'WFC', 'KO', 'PEP',
      'MCD', 'NKE', 'DIS', 'PFE', 'MRK', 'UNH', 'CVX', 'CAT', 'BA', 'GE'
    ],
    indices: [
      '^GSPC', '^DJI', '^IXIC', '^RUT', '^VIX',
      '^FTSE', '^GDAXI', '^FCHI', '^N225', '^HSI'
    ],
    commodities: [
      'GC=F', 'SI=F', 'CL=F', 'BZ=F', 'NG=F',
      'HG=F', 'PL=F', 'PA=F', 'ZC=F', 'ZW=F'
    ]
  };

  const SYMBOL_NAMES = {
    // Forex
    'EURUSD=X': 'EUR/USD', 'GBPUSD=X': 'GBP/USD', 'JPY=X': 'USD/JPY', 'CHF=X': 'USD/CHF',
    'AUDUSD=X': 'AUD/USD', 'CAD=X': 'USD/CAD', 'NZDUSD=X': 'NZD/USD', 'EURGBP=X': 'EUR/GBP',
    'EURJPY=X': 'EUR/JPY', 'EURCHF=X': 'EUR/CHF', 'EURAUD=X': 'EUR/AUD', 'EURCAD=X': 'EUR/CAD',
    'GBPJPY=X': 'GBP/JPY', 'GBPCHF=X': 'GBP/CHF', 'GBPAUD=X': 'GBP/AUD', 'AUDJPY=X': 'AUD/JPY',
    'AUDCAD=X': 'AUD/CAD', 'AUDNZD=X': 'AUD/NZD', 'CADJPY=X': 'CAD/JPY', 'CHFJPY=X': 'CHF/JPY',
    'NZDJPY=X': 'NZD/JPY',

    // Stocks
    'AAPL': 'Apple Inc.', 'MSFT': 'Microsoft Corp.', 'NVDA': 'NVIDIA Corp.', 'AMZN': 'Amazon.com Inc.',
    'GOOGL': 'Alphabet Class A', 'META': 'Meta Platforms', 'TSLA': 'Tesla Inc.', 'AVGO': 'Broadcom Inc.',
    'GOOG': 'Alphabet Class C', 'BRK-B': 'Berkshire Hathaway', 'JPM': 'JPMorgan Chase', 'V': 'Visa Inc.',
    'MA': 'Mastercard Inc.', 'WMT': 'Walmart Inc.', 'LLY': 'Eli Lilly & Co.', 'XOM': 'Exxon Mobil',
    'JNJ': 'Johnson & Johnson', 'ORCL': 'Oracle Corp.', 'COST': 'Costco Wholesale', 'NFLX': 'Netflix Inc.',
    'AMD': 'Advanced Micro Devices', 'CRM': 'Salesforce Inc.', 'ADBE': 'Adobe Inc.', 'INTC': 'Intel Corp.',
    'QCOM': 'Qualcomm Inc.', 'MU': 'Micron Technology', 'AMAT': 'Applied Materials', 'CSCO': 'Cisco Systems',
    'IBM': 'IBM Corp.', 'UBER': 'Uber Tech.', 'ABNB': 'Airbnb Inc.', 'SHOP': 'Shopify Inc.',
    'PLTR': 'Palantir Tech.', 'COIN': 'Coinbase Global', 'BAC': 'Bank of America', 'GS': 'Goldman Sachs',
    'MS': 'Morgan Stanley', 'WFC': 'Wells Fargo', 'KO': 'Coca-Cola Co.', 'PEP': 'PepsiCo Inc.',
    'MCD': 'McDonald\'s Corp.', 'NKE': 'Nike Inc.', 'DIS': 'Walt Disney', 'PFE': 'Pfizer Inc.',
    'MRK': 'Merck & Co.', 'UNH': 'UnitedHealth Group', 'CVX': 'Chevron Corp.', 'CAT': 'Caterpillar Inc.',
    'BA': 'Boeing Co.', 'GE': 'General Electric',

    // Indices
    '^GSPC': 'S&P 500 Index', '^DJI': 'Dow Jones Industrial', '^IXIC': 'NASDAQ Composite',
    '^RUT': 'Russell 2000', '^VIX': 'Volatility Index (VIX)', '^FTSE': 'FTSE 100 Index',
    '^GDAXI': 'DAX 40 Index', '^FCHI': 'CAC 40 Index', '^N225': 'Nikkei 225', '^HSI': 'Hang Seng Index',

    // Commodities
    'GC=F': 'Gold Futures (XAU)', 'SI=F': 'Silver Futures (XAG)', 'CL=F': 'Crude Oil (WTI)',
    'BZ=F': 'Brent Crude Oil', 'NG=F': 'Natural Gas', 'HG=F': 'Copper Futures',
    'PL=F': 'Platinum Futures', 'PA=F': 'Palladium Futures', 'ZC=F': 'Corn Futures', 'ZW=F': 'Wheat Futures'
  };

  // --- Default Configuration ---
  const defaultState = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    candleLimit: 20000,
    pricePrecision: 2,
    priceMinMove: 0.01,
    minGapPercent: 0,
    boxOpacity: 0.3,
    enableLiveWs: true,
    activeCategory: 'ALL',
    sortBy: 'VOL',       // 'VOL' | 'CHG'
    searchQuery: '',

    allSymbols: [],      // Array loaded directly from Binance exchangeInfo + 24hr tickers
    tickerMap: new Map(), // symbol -> { lastPrice, changePct, quoteVolume, timestamp }
    lastTickerFetchTime: 0,

    rawData: [],
    chartData: [],
    volumeData: [],

    // Indicators Data
    fvgList: [],
    vsrData: [],
    atr1Data: [],
    atr2Data: [],

    // 1. FVG Settings
    fvg: {
      enable: true,
      bullish: true,
      bearish: true,
      unmitigatedOnly: false,
      joinConsecutive: false
    },

    // 2. VSR (10-10) Settings
    vsr: {
      enable: true,
      showZone: true,
      showSpikes: true,
      length: 10,
      threshold: 10.0
    },

    // 3. ATR Bot 1: VIDYA (14, 55, 4.0) - Slow / Trend
    atr1: {
      enable: true,
      showLines: true,
      showRibbon: true,
      showSignals: true,
      length: 14,
      mult: 4.0,
      maType: "VIDYA",
      maLength: 55
    },

    // 4. ATR Bot 2: VIDYA (14, 21, 2.0) - Fast / Scalp
    atr2: {
      enable: true,
      showLines: true,
      showRibbon: true,
      showSignals: true,
      length: 14,
      mult: 2.0,
      maType: "VIDYA",
      maLength: 21
    }
  };

  // Clone default state into working state
  const state = JSON.parse(JSON.stringify(defaultState));
  state.allSymbols = [];
  state.tickerMap = new Map();

  // --- DOM Elements ---
  const el = {
    // Config Modal Elements
    configModalOverlay: document.getElementById('configModalOverlay'),
    btnOpenSettings: document.getElementById('btnOpenSettings'),
    btnCloseModal: document.getElementById('btnCloseModal'),
    btnModalDone: document.getElementById('btnModalDone'),
    modalTabBtns: document.querySelectorAll('.modal-tab-btn'),
    modalTabPanels: document.querySelectorAll('.modal-tab-panel'),

    symbolPickerWrapper: document.getElementById('symbolPickerWrapper'),
    btnOpenSymbolPicker: document.getElementById('btnOpenSymbolPicker'),
    activeSymbolText: document.getElementById('activeSymbolText'),
    symbolModalOverlay: document.getElementById('symbolModalOverlay'),
    btnCloseSymbolModal: document.getElementById('btnCloseSymbolModal'),
    symbolSearchInput: document.getElementById('symbolSearchInput'),
    symbolsCountBadge: document.getElementById('symbolsCountBadge'),
    symbolListContainer: document.getElementById('symbolListContainer'),
    quickFilterTags: document.querySelectorAll('.quick-filter-tags .tag-btn'),
    cryptoSortControls: document.getElementById('cryptoSortControls'),
    btnSortVol: document.getElementById('btnSortVol'),
    btnSortChg: document.getElementById('btnSortChg'),

    // Active Ticker Strip
    tkPrice: document.getElementById('tkPrice'),
    tkChg: document.getElementById('tkChg'),
    tkVol: document.getElementById('tkVol'),

    liveTimeframe: document.getElementById('liveTimeframe'),
    timeframeBox: document.getElementById('timeframeBox'),
    liveLimit: document.getElementById('liveLimit'),
    btnFetchLive: document.getElementById('btnFetchLive'),
    btnToggleMeasure: document.getElementById('btnToggleMeasure'),
    csvFileInput: document.getElementById('csvFileInput'),
    statusBadge: document.getElementById('statusBadge'),
    statusText: document.getElementById('statusText'),
    statScale: document.getElementById('statScale'),
    statCandles: document.getElementById('statCandles'),
    chartContainer: document.getElementById('chartContainer'),
    overlayCanvas: document.getElementById('fvgOverlayCanvas'),
    activeIndicatorsCount: document.getElementById('activeIndicatorsCount'),
    btnResetSettings: document.getElementById('btnResetSettings'),

    // FVG Controls
    toggleFVG: document.getElementById('toggleFVG'),
    fvgBullish: document.getElementById('fvgBullish'),
    fvgBearish: document.getElementById('fvgBearish'),
    fvgUnmitigatedOnly: document.getElementById('fvgUnmitigatedOnly'),
    fvgJoinConsecutive: document.getElementById('fvgJoinConsecutive'),
    sliderMinGap: document.getElementById('sliderMinGap'),
    lblMinGap: document.getElementById('lblMinGap'),
    sliderOpacity: document.getElementById('sliderOpacity'),
    lblOpacity: document.getElementById('lblOpacity'),
    activeFVGCount: document.getElementById('activeFVGCount'),

    // VSR Controls
    toggleVSR: document.getElementById('toggleVSR'),
    badgeVSRCount: document.getElementById('badgeVSRCount'),
    vsrShowZone: document.getElementById('vsrShowZone'),
    vsrShowSpikes: document.getElementById('vsrShowSpikes'),
    vsrLength: document.getElementById('vsrLength'),
    vsrThreshold: document.getElementById('vsrThreshold'),

    // ATR Bot 1 Controls (Slow / VIDYA 14/55/4)
    toggleATR1: document.getElementById('toggleATR1'),
    badgeATR1Trend: document.getElementById('badgeATR1Trend'),
    atr1ShowLines: document.getElementById('atr1ShowLines'),
    atr1ShowRibbon: document.getElementById('atr1ShowRibbon'),
    atr1ShowSignals: document.getElementById('atr1ShowSignals'),
    atr1Length: document.getElementById('atr1Length'),
    atr1Mult: document.getElementById('atr1Mult'),
    atr1MAType: document.getElementById('atr1MAType'),
    atr1MALength: document.getElementById('atr1MALength'),

    // ATR Bot 2 Controls (Fast / VIDYA 14/21/2)
    toggleATR2: document.getElementById('toggleATR2'),
    badgeATR2Trend: document.getElementById('badgeATR2Trend'),
    atr2ShowLines: document.getElementById('atr2ShowLines'),
    atr2ShowRibbon: document.getElementById('atr2ShowRibbon'),
    atr2ShowSignals: document.getElementById('atr2ShowSignals'),
    atr2Length: document.getElementById('atr2Length'),
    atr2Mult: document.getElementById('atr2Mult'),
    atr2MAType: document.getElementById('atr2MAType'),
    atr2MALength: document.getElementById('atr2MALength'),

    // FVG Stats
    statTotalFVG: document.getElementById('statTotalFVG'),
    statMitigationRate: document.getElementById('statMitigationRate'),
    statBullCount: document.getElementById('statBullCount'),
    statBearCount: document.getElementById('statBearCount'),
    statUnmitCount: document.getElementById('statUnmitCount'),
    statAvgBars: document.getElementById('statAvgBars'),
    statAvgGapSize: document.getElementById('statAvgGapSize'),
    listCounter: document.getElementById('listCounter'),
    fvgTableBody: document.getElementById('fvgTableBody')
  };

  // --- Chart & WebSocket Handles ---
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let ctx = null;
  let resizeObserver = null;
  let renderScheduled = false;
  let isDropdownOpen = false;

  // --- Measurement Tool State (Shift + Click Measure) ---
  const measure = {
    modeActive: false,    // Active measurement mode
    isMeasuring: false,   // Actively measuring / dragging
    isPinned: false,      // Measurement is locked / displayed on chart
    start: null,          // { time, price, x, y }
    current: null,        // { time, price, x, y }
    lastCrosshair: null   // { time, price, x, y }
  };

  // --- Initialize App ---
  function init() {
    cleanLegacyLocalStorage();
    getIDB();
    loadSettingsFromLocalStorage();
    syncTimeframeSelectorForSymbol(state.symbol);
    setupUIEvents();
    initChart();

    // 1. Fetch Binance Futures exchangeInfo & 24hr Ticker batch
    initExchangeData();

    // 2. Directly fetch candles on startup (IndexedDB Cache + Network)
    fetchLiveCandles(state.symbol, state.timeframe, state.candleLimit);
  }

  // --- Helpers: Formatting Numbers ---
  function formatUSDVolume(val) {
    if (!val || isNaN(val)) return '$0';
    const num = Number(val);
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
    return `$${num.toFixed(0)}`;
  }

  function formatSymbolPrice(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    const num = Number(val);
    if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 10) return num.toFixed(2);
    if (num >= 1) return num.toFixed(4);
    if (num >= 0.01) return num.toFixed(5);
    if (num >= 0.0001) return num.toFixed(6);
    return num.toFixed(8);
  }

  // --- 1. Fetch Exchange Data (exchangeInfo + 24hr Tickers with Caching) ---
  async function initExchangeData() {
    await fetchExchangeInfo();
    await fetch24hTickers();
  }

  function buildYahooMarketList() {
    const list = [];

    // 1. Forex
    for (const sym of YAHOO_MARKETS.forex) {
      list.push({
        symbol: sym,
        name: SYMBOL_NAMES[sym] || sym,
        baseAsset: sym.replace('=X', ''),
        category: 'FOREX',
        isForex: true,
        isYahoo: true,
        lastPrice: 0,
        changePct: 0,
        quoteVolume: 0
      });
    }

    // 2. Stocks
    for (const sym of YAHOO_MARKETS.stocks) {
      list.push({
        symbol: sym,
        name: SYMBOL_NAMES[sym] || sym,
        baseAsset: sym,
        category: 'STOCKS',
        isStock: true,
        isYahoo: true,
        lastPrice: 0,
        changePct: 0,
        quoteVolume: 0
      });
    }

    // 3. Indices
    for (const sym of YAHOO_MARKETS.indices) {
      list.push({
        symbol: sym,
        name: SYMBOL_NAMES[sym] || sym,
        baseAsset: sym.replace('^', ''),
        category: 'INDICES',
        isIndex: true,
        isYahoo: true,
        lastPrice: 0,
        changePct: 0,
        quoteVolume: 0
      });
    }

    // 4. Commodities
    for (const sym of YAHOO_MARKETS.commodities) {
      list.push({
        symbol: sym,
        name: SYMBOL_NAMES[sym] || sym,
        baseAsset: sym.replace('=F', ''),
        category: 'COMMODITIES',
        isCommodity: true,
        isYahoo: true,
        lastPrice: 0,
        changePct: 0,
        quoteVolume: 0
      });
    }

    return list;
  }

  async function fetchExchangeInfo() {
    const yahooList = buildYahooMarketList();
    let binanceSymbols = [];

    const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && data.symbols && Array.isArray(data.symbols)) {
        binanceSymbols = data.symbols
          .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL')
          .map(s => ({
            symbol: s.symbol,
            name: s.symbol,
            baseAsset: s.baseAsset,
            quoteAsset: s.quoteAsset,
            category: 'CRYPTO',
            isCrypto: true,
            isYahoo: false,
            lastPrice: 0,
            changePct: 0,
            quoteVolume: 0
          }));
      }
    } catch (err) {
      console.warn('Failed to fetch Binance exchangeInfo:', err);
      binanceSymbols = Array.from(HOT_SYMBOLS).map(sym => ({
        symbol: sym,
        name: sym,
        baseAsset: sym.replace('USDT', ''),
        quoteAsset: 'USDT',
        category: 'CRYPTO',
        isCrypto: true,
        isYahoo: false,
        lastPrice: 0,
        changePct: 0,
        quoteVolume: 0
      }));
    }

    // Merge Yahoo Markets (Forex, Stocks, Indices, Commodities) + Binance Crypto
    state.allSymbols = [...yahooList, ...binanceSymbols];
    el.symbolsCountBadge.textContent = `${state.allSymbols.length} Pairs`;
  }

  // Single Batched 24h Ticker fetch for all symbols (Throttled by 60s TTL)
  async function fetch24hTickers(force = false) {
    const now = Date.now();
    if (!force && now - state.lastTickerFetchTime < TICKER_CACHE_TTL && state.tickerMap.size > 0) {
      applyTickersToSymbols();
      return;
    }

    const url = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          state.tickerMap.set(item.symbol, {
            lastPrice: parseFloat(item.lastPrice) || 0,
            changePct: parseFloat(item.priceChangePercent) || 0,
            quoteVolume: parseFloat(item.quoteVolume) || 0
          });
        }
        state.lastTickerFetchTime = now;
        applyTickersToSymbols();
      }
    } catch (err) {
      console.warn('Failed to fetch 24hr tickers:', err);
    }
  }

  function applyTickersToSymbols() {
    for (let i = 0; i < state.allSymbols.length; i++) {
      const item = state.allSymbols[i];
      const t = state.tickerMap.get(item.symbol);
      if (t) {
        item.lastPrice = t.lastPrice;
        item.changePct = t.changePct;
        item.quoteVolume = t.quoteVolume;
      }
    }

    sortSymbols();
    renderSymbolList();
    updateHeaderTickerDisplay();
  }

  function sortSymbols() {
    if (state.sortBy === 'VOL') {
      state.allSymbols.sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));
    } else if (state.sortBy === 'CHG') {
      state.allSymbols.sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
    }
  }

  function updateHeaderTickerDisplay() {
    const t = state.tickerMap.get(state.symbol);
    if (t) {
      el.tkPrice.textContent = `$${formatSymbolPrice(t.lastPrice)}`;
      const isUp = (t.changePct || 0) >= 0;
      el.tkChg.textContent = `${isUp ? '+' : ''}${t.changePct ? t.changePct.toFixed(2) : '0.00'}%`;
      el.tkChg.className = `tk-val ${isUp ? 'up' : 'down'}`;
      el.tkVol.textContent = t.quoteVolume ? formatUSDVolume(t.quoteVolume) : '';
    }
  }

  // --- Render Filtered Symbol Modal Content ---
  function renderSymbolList() {
    const query = (state.searchQuery || '').trim().toUpperCase();
    const category = state.activeCategory || 'ALL';

    // Show / hide crypto sort controls based on category
    if (el.cryptoSortControls) {
      if (category === 'FOREX' || category === 'STOCKS' || category === 'INDICES' || category === 'COMMODITIES') {
        el.cryptoSortControls.style.display = 'none';
      } else {
        el.cryptoSortControls.style.display = 'flex';
      }
    }

    const filtered = state.allSymbols.filter(item => {
      if (category === 'FOREX' && item.category !== 'FOREX') return false;
      if (category === 'STOCKS' && item.category !== 'STOCKS') return false;
      if (category === 'INDICES' && item.category !== 'INDICES') return false;
      if (category === 'COMMODITIES' && item.category !== 'COMMODITIES') return false;
      if (category === 'CRYPTO' && item.category !== 'CRYPTO') return false;

      if (query) {
        return item.symbol.toUpperCase().includes(query) ||
               (item.baseAsset && item.baseAsset.toUpperCase().includes(query)) ||
               (item.name && item.name.toUpperCase().includes(query));
      }
      return true;
    });

    if (el.symbolsCountBadge) {
      el.symbolsCountBadge.textContent = `${filtered.length} of ${state.allSymbols.length}`;
    }

    if (filtered.length === 0) {
      el.symbolListContainer.innerHTML = `<div class="symbol-list-loading">No matching instruments found for "${state.searchQuery}"</div>`;
      return;
    }

    const yahooItems = filtered.filter(item => item.isYahoo);
    const cryptoItems = filtered.filter(item => !item.isYahoo);

    let html = '';

    // Case 1: Specific Yahoo Category (FOREX, STOCKS, INDICES, COMMODITIES)
    if (category !== 'CRYPTO' && category !== 'ALL') {
      html = renderYahooGridTable(filtered);
    }
    // Case 2: CRYPTO only
    else if (category === 'CRYPTO') {
      html = renderCryptoTable(cryptoItems);
    }
    // Case 3: ALL category (Mixed Global Markets & Crypto Futures)
    else {
      if (yahooItems.length > 0 && cryptoItems.length > 0) {
        html += `<div class="category-section-title">🌍 GLOBAL MARKETS (FOREX • STOCKS • INDICES • COMMODITIES - ${yahooItems.length})</div>`;
        html += renderYahooGridTable(yahooItems);
        html += `<div class="category-section-title">⚡ CRYPTO FUTURES (USDT PERPETUAL - ${cryptoItems.length})</div>`;
        html += renderCryptoTable(cryptoItems.slice(0, 300));
      } else if (yahooItems.length > 0) {
        html = renderYahooGridTable(yahooItems);
      } else {
        html = renderCryptoTable(cryptoItems);
      }
    }

    el.symbolListContainer.innerHTML = html;

    // Attach click listeners to all clickable cards & rows
    const targets = el.symbolListContainer.querySelectorAll('[data-symbol]');
    targets.forEach(it => {
      it.addEventListener('click', () => {
        const sym = it.dataset.symbol;
        selectSymbol(sym);
      });
    });
  }

  function getBadgeClass(cat) {
    switch (cat) {
      case 'FOREX': return 'badge-forex';
      case 'STOCKS': return 'badge-stock';
      case 'INDICES': return 'badge-index';
      case 'COMMODITIES': return 'badge-comm';
      case 'CRYPTO': return 'badge-crypto';
      default: return 'badge-forex';
    }
  }

  function renderYahooGridTable(items) {
    let out = '<div class="symbol-grid-table">';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isSelected = item.symbol === state.symbol;
      const bClass = getBadgeClass(item.category);

      out += `<div class="symbol-grid-card ${isSelected ? 'selected' : ''}" data-symbol="${item.symbol}" title="${item.symbol} - ${item.name}">
        <div class="card-top">
          <span class="card-symbol">${item.symbol}</span>
          <span class="sym-badge ${bClass}">${item.category}</span>
        </div>
        <div class="card-name">${item.name || item.baseAsset}</div>
      </div>`;
    }
    out += '</div>';
    return out;
  }

  function renderCryptoTable(items) {
    let out = `
      <div class="crypto-table-header">
        <div>Market / Pair</div>
        <div class="th-right">Last Price</div>
        <div class="th-right">24h Change</div>
        <div class="th-right th-vol">24h Volume</div>
      </div>
      <div class="crypto-table-list">
    `;

    const limit = Math.min(items.length, 300);
    for (let i = 0; i < limit; i++) {
      const item = items[i];
      const isSelected = item.symbol === state.symbol;
      const isUp = (item.changePct || 0) >= 0;
      const chgClass = isUp ? 'up' : 'down';
      const chgSign = isUp ? '+' : '';

      out += `
        <div class="crypto-row ${isSelected ? 'selected' : ''}" data-symbol="${item.symbol}">
          <div class="sym-info">
            <span class="sym-title">${item.symbol}</span>
            <span class="sym-badge badge-crypto">CRYPTO</span>
            <span class="sym-desc">${item.baseAsset}</span>
          </div>
          <div class="td-right sym-price">${item.lastPrice > 0 ? '$' + formatSymbolPrice(item.lastPrice) : '--'}</div>
          <div class="td-right sym-chg ${chgClass}">${item.changePct ? chgSign + item.changePct.toFixed(2) + '%' : '--'}</div>
          <div class="td-right sym-vol">${item.quoteVolume > 0 ? formatUSDVolume(item.quoteVolume) : '--'}</div>
        </div>
      `;
    }

    out += '</div>';
    return out;
  }

  function isStockOrIndex(symbol) {
    if (!symbol) return false;
    const s = symbol.trim().toUpperCase();
    if (YAHOO_MARKETS.stocks.includes(s) || YAHOO_MARKETS.indices.includes(s)) return true;
    if (s.startsWith('^')) return true;
    const found = state.allSymbols.find(item => item.symbol.toUpperCase() === s);
    if (found && (found.category === 'STOCKS' || found.category === 'INDICES')) return true;
    return false;
  }

  function syncTimeframeSelectorForSymbol(symbol) {
    const fixed1h = isStockOrIndex(symbol);
    if (fixed1h) {
      state.timeframe = '1h';
      if (el.liveTimeframe) {
        el.liveTimeframe.value = '1h';
        el.liveTimeframe.disabled = true;
        el.liveTimeframe.title = 'Timeframe fixed at 1h for Stocks & Indices';
      }
      if (el.timeframeBox) {
        el.timeframeBox.classList.add('is-fixed');
        el.timeframeBox.title = 'Timeframe fixed at 1h for Stocks & Indices';
      }
    } else {
      if (el.liveTimeframe) {
        el.liveTimeframe.disabled = false;
        el.liveTimeframe.title = 'Timeframe';
        el.liveTimeframe.value = state.timeframe;
      }
      if (el.timeframeBox) {
        el.timeframeBox.classList.remove('is-fixed');
        el.timeframeBox.title = 'Timeframe';
      }
    }
  }

  function selectSymbol(sym) {
    if (!sym) return;
    state.symbol = sym.trim().toUpperCase();
    el.activeSymbolText.textContent = state.symbol;
    syncTimeframeSelectorForSymbol(state.symbol);
    updateHeaderTickerDisplay();
    closeSymbolModal();
    saveSettingsToLocalStorage();
    fetchLiveCandles(state.symbol, state.timeframe, state.candleLimit);
  }

  function openSymbolModal() {
    isDropdownOpen = true;
    if (el.symbolModalOverlay) {
      el.symbolModalOverlay.classList.add('show');
    }
    el.symbolSearchInput.value = '';
    state.searchQuery = '';
    fetch24hTickers(); // Silently refresh 24h ticker if TTL expired
    renderSymbolList();
    setTimeout(() => {
      if (el.symbolSearchInput) el.symbolSearchInput.focus();
    }, 60);
  }

  function closeSymbolModal() {
    isDropdownOpen = false;
    if (el.symbolModalOverlay) {
      el.symbolModalOverlay.classList.remove('show');
    }
  }

  // --- Config Modal Controller ---
  function openConfigModal(tabId) {
    if (tabId) switchModalTab(tabId);
    if (el.configModalOverlay) {
      el.configModalOverlay.classList.add('show');
    }
  }

  function closeConfigModal() {
    if (el.configModalOverlay) {
      el.configModalOverlay.classList.remove('show');
    }
  }

  function switchModalTab(tabId) {
    if (el.modalTabBtns) {
      el.modalTabBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tabId);
      });
    }
    if (el.modalTabPanels) {
      el.modalTabPanels.forEach(p => {
        p.classList.toggle('active', p.id === tabId);
      });
    }
  }

  // --- LocalStorage Save & Load ---
  function saveSettingsToLocalStorage() {
    try {
      const payload = {
        symbol: state.symbol,
        timeframe: state.timeframe,
        candleLimit: state.candleLimit,
        enableLiveWs: state.enableLiveWs,
        minGapPercent: state.minGapPercent,
        boxOpacity: state.boxOpacity,
        fvg: state.fvg,
        vsr: state.vsr,
        atr1: state.atr1,
        atr2: state.atr2
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('Failed to save settings to localStorage:', e);
    }
  }

  function loadSettingsFromLocalStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);

      if (parsed.symbol) {
        state.symbol = parsed.symbol;
        el.activeSymbolText.textContent = state.symbol;
      }
      if (parsed.timeframe) state.timeframe = parsed.timeframe;
      if (parsed.candleLimit) state.candleLimit = parsed.candleLimit;
      if (parsed.enableLiveWs !== undefined) state.enableLiveWs = parsed.enableLiveWs;
      if (parsed.minGapPercent !== undefined) state.minGapPercent = parsed.minGapPercent;
      if (parsed.boxOpacity !== undefined) state.boxOpacity = parsed.boxOpacity;
      if (parsed.fvg) Object.assign(state.fvg, parsed.fvg);
      if (parsed.vsr) Object.assign(state.vsr, parsed.vsr);
      if (parsed.atr1) Object.assign(state.atr1, parsed.atr1);
      if (parsed.atr2) Object.assign(state.atr2, parsed.atr2);

      el.liveTimeframe.value = state.timeframe;
      el.liveLimit.value = String(state.candleLimit);

      // Sync Sidebar UI
      el.toggleFVG.checked = state.fvg.enable;
      el.fvgBullish.checked = state.fvg.bullish;
      el.fvgBearish.checked = state.fvg.bearish;
      el.fvgUnmitigatedOnly.checked = state.fvg.unmitigatedOnly;
      el.fvgJoinConsecutive.checked = state.fvg.joinConsecutive;
      el.sliderMinGap.value = state.minGapPercent;
      el.lblMinGap.textContent = `${state.minGapPercent.toFixed(2)}%`;
      el.sliderOpacity.value = Math.round(state.boxOpacity * 100);
      el.lblOpacity.textContent = `${Math.round(state.boxOpacity * 100)}%`;

      el.toggleVSR.checked = state.vsr.enable;
      el.vsrShowZone.checked = state.vsr.showZone;
      el.vsrShowSpikes.checked = state.vsr.showSpikes;
      el.vsrLength.value = state.vsr.length;
      el.vsrThreshold.value = state.vsr.threshold;

      el.toggleATR1.checked = state.atr1.enable;
      el.atr1ShowLines.checked = state.atr1.showLines;
      el.atr1ShowRibbon.checked = state.atr1.showRibbon;
      el.atr1ShowSignals.checked = state.atr1.showSignals;
      el.atr1Length.value = state.atr1.length;
      el.atr1Mult.value = state.atr1.mult;
      el.atr1MAType.value = state.atr1.maType;
      el.atr1MALength.value = state.atr1.maLength;

      el.toggleATR2.checked = state.atr2.enable;
      el.atr2ShowLines.checked = state.atr2.showLines;
      el.atr2ShowRibbon.checked = state.atr2.showRibbon;
      el.atr2ShowSignals.checked = state.atr2.showSignals;
      el.atr2Length.value = state.atr2.length;
      el.atr2Mult.value = state.atr2.mult;
      el.atr2MAType.value = state.atr2.maType;
      el.atr2MALength.value = state.atr2.maLength;

    } catch (e) {
      console.warn('Failed to load settings from localStorage:', e);
    }
  }

  function resetToDefaults() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }

  // --- Setup UI Events ---
  function setupUIEvents() {
    el.btnResetSettings.addEventListener('click', resetToDefaults);

    // Config Modal Listeners
    if (el.btnOpenSettings) {
      el.btnOpenSettings.addEventListener('click', () => openConfigModal());
    }
    if (el.btnCloseModal) {
      el.btnCloseModal.addEventListener('click', () => closeConfigModal());
    }
    if (el.btnModalDone) {
      el.btnModalDone.addEventListener('click', () => closeConfigModal());
    }
    if (el.configModalOverlay) {
      el.configModalOverlay.addEventListener('click', (e) => {
        if (e.target === el.configModalOverlay) closeConfigModal();
      });
    }

    // Modal Tabs
    if (el.modalTabBtns) {
      el.modalTabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          switchModalTab(btn.dataset.tab);
        });
      });
    }

    // Keyboard shortcut for Config Modal (Ctrl+, or S) & Measurement (Shift / Escape)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey && e.key === ',') || (e.key.toLowerCase() === 's' && !e.ctrlKey && document.activeElement.tagName !== 'INPUT')) {
        e.preventDefault();
        if (el.configModalOverlay.classList.contains('show')) {
          closeConfigModal();
        } else {
          openConfigModal();
        }
      } else if (e.key === 'Shift') {
        measure.modeActive = true;
        el.chartContainer.classList.add('measuring');
        if (el.btnToggleMeasure) el.btnToggleMeasure.classList.add('active');
      } else if (e.key === 'Escape') {
        if (el.configModalOverlay.classList.contains('show')) {
          closeConfigModal();
        } else {
          measure.modeActive = false;
          measure.isMeasuring = false;
          measure.isPinned = false;
          measure.start = null;
          measure.current = null;
          el.chartContainer.classList.remove('measuring');
          if (el.btnToggleMeasure) el.btnToggleMeasure.classList.remove('active');
          scheduleOverlayRender();
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Shift') {
        if (!measure.isMeasuring) {
          measure.modeActive = false;
          el.chartContainer.classList.remove('measuring');
          if (el.btnToggleMeasure) el.btnToggleMeasure.classList.remove('active');
        }
      }
    });

    // Measurement Tool Toggle Button
    if (el.btnToggleMeasure) {
      el.btnToggleMeasure.addEventListener('click', (e) => {
        e.stopPropagation();
        measure.modeActive = !measure.modeActive;
        if (measure.modeActive) {
          el.chartContainer.classList.add('measuring');
          el.btnToggleMeasure.classList.add('active');
        } else {
          measure.isMeasuring = false;
          measure.isPinned = false;
          measure.start = null;
          measure.current = null;
          el.chartContainer.classList.remove('measuring');
          el.btnToggleMeasure.classList.remove('active');
          scheduleOverlayRender();
        }
      });
    }

    // Chart Click Handler for Measurement (Shift + Click or Active Measure Mode)
    el.chartContainer.addEventListener('click', (e) => {
      if (e.shiftKey || measure.modeActive) {
        if (!measure.isMeasuring) {
          // Start measurement at current cursor point
          if (measure.lastCrosshair && measure.lastCrosshair.price !== null) {
            measure.start = { ...measure.lastCrosshair };
            measure.current = { ...measure.lastCrosshair };
            measure.isMeasuring = true;
            measure.isPinned = false;
            scheduleOverlayRender();
          }
        } else {
          // Second click: Pin and finish measurement
          if (measure.lastCrosshair && measure.lastCrosshair.price !== null) {
            measure.current = { ...measure.lastCrosshair };
          }
          measure.isMeasuring = false;
          measure.isPinned = true;
          measure.modeActive = false;
          el.chartContainer.classList.remove('measuring');
          if (el.btnToggleMeasure) el.btnToggleMeasure.classList.remove('active');
          scheduleOverlayRender();
        }
      } else {
        // Normal click without shift: Clear existing pinned measurement
        if (measure.isPinned || measure.isMeasuring) {
          measure.isMeasuring = false;
          measure.isPinned = false;
          measure.start = null;
          measure.current = null;
          scheduleOverlayRender();
        }
      }
    });

    // Open Symbol Search Modal
    el.btnOpenSymbolPicker.addEventListener('click', (e) => {
      e.stopPropagation();
      openSymbolModal();
    });

    if (el.btnCloseSymbolModal) {
      el.btnCloseSymbolModal.addEventListener('click', () => {
        closeSymbolModal();
      });
    }

    if (el.symbolModalOverlay) {
      el.symbolModalOverlay.addEventListener('click', (e) => {
        if (e.target === el.symbolModalOverlay) {
          closeSymbolModal();
        }
      });
    }

    // Live search filter input
    el.symbolSearchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderSymbolList();
    });

    el.symbolSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSymbolModal();
      } else if (e.key === 'Enter') {
        const query = el.symbolSearchInput.value.trim().toUpperCase();
        if (query) {
          selectSymbol(query);
        }
      }
    });

    // Category Tag Buttons
    el.quickFilterTags.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        el.quickFilterTags.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeCategory = btn.dataset.filter;
        renderSymbolList();
      });
    });

    // Sort buttons
    el.btnSortVol.addEventListener('click', (e) => {
      e.stopPropagation();
      el.btnSortVol.classList.add('active');
      el.btnSortChg.classList.remove('active');
      state.sortBy = 'VOL';
      sortSymbols();
      renderSymbolList();
    });

    el.btnSortChg.addEventListener('click', (e) => {
      e.stopPropagation();
      el.btnSortChg.classList.add('active');
      el.btnSortVol.classList.remove('active');
      state.sortBy = 'CHG';
      sortSymbols();
      renderSymbolList();
    });

    // Timeframe Selection Trigger
    el.liveTimeframe.addEventListener('change', () => {
      if (isStockOrIndex(state.symbol)) {
        el.liveTimeframe.value = '1h';
        return;
      }
      state.timeframe = el.liveTimeframe.value;
      saveSettingsToLocalStorage();
      fetchLiveCandles(state.symbol, state.timeframe, state.candleLimit);
    });

    // Candle Limit Trigger
    el.liveLimit.addEventListener('change', () => {
      state.candleLimit = parseInt(el.liveLimit.value, 10) || 20000;
      saveSettingsToLocalStorage();
      fetchLiveCandles(state.symbol, state.timeframe, state.candleLimit);
    });

    // Manual Refresh Button (Forces full fresh 20k download)
    el.btnFetchLive.addEventListener('click', () => {
      saveSettingsToLocalStorage();
      fetchLiveCandles(state.symbol, state.timeframe, state.candleLimit, true);
    });

    // CSV File Upload (optional backup)
    el.csvFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        setStatus('loading', `Reading ${file.name}...`);
        Papa.parse(file, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => processRawData(results.data, file.name),
          error: (err) => setStatus('error', `CSV Parse Error: ${err.message}`)
        });
      }
    });

    // Sidebar FVG Toggles
    el.toggleFVG.addEventListener('change', (e) => {
      state.fvg.enable = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateActiveCount();
    });
    el.fvgBullish.addEventListener('change', (e) => {
      state.fvg.bullish = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateTableAndStats();
    });
    el.fvgBearish.addEventListener('change', (e) => {
      state.fvg.bearish = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateTableAndStats();
    });
    el.fvgUnmitigatedOnly.addEventListener('change', (e) => {
      state.fvg.unmitigatedOnly = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateTableAndStats();
    });
    el.fvgJoinConsecutive.addEventListener('change', (e) => {
      state.fvg.joinConsecutive = e.target.checked;
      saveSettingsToLocalStorage();
      recalculateFVG();
    });
    el.sliderMinGap.addEventListener('input', (e) => {
      state.minGapPercent = parseFloat(e.target.value);
      el.lblMinGap.textContent = `${state.minGapPercent.toFixed(2)}%`;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
      updateTableAndStats();
    });
    el.sliderOpacity.addEventListener('input', (e) => {
      state.boxOpacity = parseInt(e.target.value, 10) / 100;
      el.lblOpacity.textContent = `${e.target.value}%`;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });

    // Sidebar VSR Toggles
    el.toggleVSR.addEventListener('change', (e) => {
      state.vsr.enable = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
      scheduleOverlayRender();
      updateActiveCount();
    });
    el.vsrShowZone.addEventListener('change', (e) => {
      state.vsr.showZone = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.vsrShowSpikes.addEventListener('change', (e) => {
      state.vsr.showSpikes = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
      scheduleOverlayRender();
    });
    const recomputeVSR = () => {
      state.vsr.length = parseInt(el.vsrLength.value, 10) || 10;
      state.vsr.threshold = parseFloat(el.vsrThreshold.value) || 10.0;
      saveSettingsToLocalStorage();
      recalculateVSR();
    };
    el.vsrLength.addEventListener('change', recomputeVSR);
    el.vsrThreshold.addEventListener('change', recomputeVSR);

    // Sidebar ATR Bot 1 (Slow)
    el.toggleATR1.addEventListener('change', (e) => {
      state.atr1.enable = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
      scheduleOverlayRender();
      updateActiveCount();
    });
    el.atr1ShowLines.addEventListener('change', (e) => {
      state.atr1.showLines = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.atr1ShowRibbon.addEventListener('change', (e) => {
      state.atr1.showRibbon = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.atr1ShowSignals.addEventListener('change', (e) => {
      state.atr1.showSignals = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
    });
    const recomputeATR1 = () => {
      state.atr1.length = parseInt(el.atr1Length.value, 10) || 14;
      state.atr1.mult = parseFloat(el.atr1Mult.value) || 4.0;
      state.atr1.maType = el.atr1MAType.value;
      state.atr1MALength = parseInt(el.atr1MALength.value, 10) || 55;
      saveSettingsToLocalStorage();
      recalculateATR1();
    };
    el.atr1Length.addEventListener('change', recomputeATR1);
    el.atr1Mult.addEventListener('change', recomputeATR1);
    el.atr1MAType.addEventListener('change', recomputeATR1);
    el.atr1MALength.addEventListener('change', recomputeATR1);

    // Sidebar ATR Bot 2 (Fast)
    el.toggleATR2.addEventListener('change', (e) => {
      state.atr2.enable = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
      scheduleOverlayRender();
      updateActiveCount();
    });
    el.atr2ShowLines.addEventListener('change', (e) => {
      state.atr2.showLines = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.atr2ShowRibbon.addEventListener('change', (e) => {
      state.atr2.showRibbon = e.target.checked;
      saveSettingsToLocalStorage();
      scheduleOverlayRender();
    });
    el.atr2ShowSignals.addEventListener('change', (e) => {
      state.atr2.showSignals = e.target.checked;
      saveSettingsToLocalStorage();
      updateMarkers();
    });
    const recomputeATR2 = () => {
      state.atr2.length = parseInt(el.atr2Length.value, 10) || 14;
      state.atr2.mult = parseFloat(el.atr2Mult.value) || 2.0;
      state.atr2.maType = el.atr2MAType.value;
      state.atr2.maLength = parseInt(el.atr2MALength.value, 10) || 21;
      saveSettingsToLocalStorage();
      recalculateATR2();
    };
    el.atr2Length.addEventListener('change', recomputeATR2);
    el.atr2Mult.addEventListener('change', recomputeATR2);
    el.atr2MAType.addEventListener('change', recomputeATR2);
    el.atr2MALength.addEventListener('change', recomputeATR2);
  }

  function updateActiveCount() {
    let count = 0;
    if (state.fvg.enable) count++;
    if (state.vsr.enable) count++;
    if (state.atr1.enable) count++;
    if (state.atr2.enable) count++;
    el.activeIndicatorsCount.textContent = `${count} Active`;
  }

  // --- Initialize TradingView Chart ---
  function initChart() {
    const width = el.chartContainer.clientWidth || 800;
    const height = el.chartContainer.clientHeight || 500;

    chart = LightweightCharts.createChart(el.chartContainer, {
      width: width,
      height: height,
      layout: {
        background: { type: 'solid', color: '#0b0e14' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace"
      },
      grid: {
        vertLines: { color: 'rgba(38, 48, 66, 0.4)' },
        horzLines: { color: 'rgba(38, 48, 66, 0.4)' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: '#38bdf8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#0284c7'
        },
        horzLine: {
          color: '#38bdf8',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#0284c7'
        }
      },
      rightPriceScale: {
        borderColor: '#263042',
        autoScale: true,
        scaleMargins: { top: 0.06, bottom: 0.22 }
      },
      timeScale: {
        borderColor: '#263042',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 2
      }
    });

    candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e'
    });

    volumeSeries = chart.addHistogramSeries({
      color: '#10b981',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol_pane',
      scaleMargins: { top: 0.82, bottom: 0 }
    });

    chart.priceScale('vol_pane').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 }
    });

    ctx = el.overlayCanvas.getContext('2d');
    resizeCanvas();

    resizeObserver = new ResizeObserver(() => {
      if (chart && el.chartContainer) {
        const w = el.chartContainer.clientWidth;
        const h = el.chartContainer.clientHeight;
        chart.resize(w, h);
        resizeCanvas();
        scheduleOverlayRender();
      }
    });
    resizeObserver.observe(el.chartContainer);

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => scheduleOverlayRender());
    chart.timeScale().subscribeVisibleTimeRangeChange(() => scheduleOverlayRender());
    chart.subscribeCrosshairMove((p) => updateCrosshairLegend(p));

    window.addEventListener('resize', () => {
      if (chart && el.chartContainer) {
        const w = el.chartContainer.clientWidth;
        const h = el.chartContainer.clientHeight;
        if (w > 0 && h > 0) {
          chart.resize(w, h);
          resizeCanvas();
          scheduleOverlayRender();
        }
      }
    });

    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        if (chart && el.chartContainer) {
          const w = el.chartContainer.clientWidth;
          const h = el.chartContainer.clientHeight;
          if (w > 0 && h > 0) {
            chart.resize(w, h);
            resizeCanvas();
            scheduleOverlayRender();
          }
        }
      }, 150);
    });
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = el.chartContainer.clientWidth;
    const h = el.chartContainer.clientHeight;
    if (w === 0 || h === 0) return;
    el.overlayCanvas.width = Math.round(w * dpr);
    el.overlayCanvas.height = Math.round(h * dpr);
    el.overlayCanvas.style.width = w + 'px';
    el.overlayCanvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- Dynamic PriceScale Detection ---
  function detectAndApplyPriceScale(rows) {
    if (!rows || rows.length === 0) return;

    let maxDecimals = 2;
    let minPrice = Infinity, maxPrice = -Infinity;

    const checkCount = Math.min(rows.length, 100);
    for (let i = 0; i < checkCount; i++) {
      const r = rows[i];
      if (r.close === undefined) continue;
      const p = Number(r.close);
      if (p < minPrice) minPrice = p;
      if (p > maxPrice) maxPrice = p;
      const pStr = String(r.close);
      if (pStr.includes('.')) {
        const dec = pStr.split('.')[1].length;
        if (dec > maxDecimals) maxDecimals = dec;
      }
    }

    const avg = (minPrice + maxPrice) / 2;
    if (avg >= 1000) maxDecimals = Math.max(maxDecimals, 2);
    else if (avg >= 10) maxDecimals = Math.max(maxDecimals, 2);
    else if (avg >= 1) maxDecimals = Math.max(maxDecimals, 4);
    else if (avg >= 0.01) maxDecimals = Math.max(maxDecimals, 5);
    else if (avg >= 0.0001) maxDecimals = Math.max(maxDecimals, 6);
    else maxDecimals = Math.max(maxDecimals, 8);

    maxDecimals = Math.min(maxDecimals, 8);
    const minMove = parseFloat(Math.pow(10, -maxDecimals).toFixed(maxDecimals));

    state.pricePrecision = maxDecimals;
    state.priceMinMove = minMove;

    candleSeries.applyOptions({
      priceFormat: { type: 'price', precision: maxDecimals, minMove: minMove }
    });

    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.06, bottom: 0.22 }
    });

    el.statScale.textContent = `${maxDecimals} dec (${minMove})`;
  }

  function formatPrice(val) {
    if (val === null || val === undefined || isNaN(val)) return '--';
    return Number(val).toFixed(state.pricePrecision);
  }

  // --- Kline 20k LocalStorage Cache Engine ---
  const KLINE_CACHE_PREFIX = 'smc_kline_20k_';

  function getKlineCacheKey(symbol, interval) {
    return `${KLINE_CACHE_PREFIX}${symbol.toUpperCase()}_${interval}`;
  }

  function getIntervalDurationMs(interval) {
    const unit = interval.slice(-1);
    const val = parseInt(interval, 10) || 1;
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    if (unit === 'd') return val * 24 * 60 * 60 * 1000;
    return 15 * 60 * 1000;
  }

  // ==========================================================================
  // IndexedDB Storage Engine (High-Performance 20k+ Candles Cache)
  // Replaces localStorage to eliminate the ~5MB quota limit completely.
  // ==========================================================================
  const IDB_NAME = 'SMC_Chart_DB';
  const IDB_VERSION = 1;
  const IDB_STORE_KLINES = 'klines';
  const IDB_STORE_SETTINGS = 'settings';

  let dbPromise = null;

  function getIDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
          console.warn('IndexedDB not supported in current environment.');
          resolve(null);
          return;
        }

        try {
          const req = indexedDB.open(IDB_NAME, IDB_VERSION);

          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE_KLINES)) {
              db.createObjectStore(IDB_STORE_KLINES, { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains(IDB_STORE_SETTINGS)) {
              db.createObjectStore(IDB_STORE_SETTINGS, { keyPath: 'key' });
            }
          };

          req.onsuccess = (e) => {
            resolve(e.target.result);
          };

          req.onerror = (e) => {
            console.error('IndexedDB open error:', e.target.error);
            resolve(null);
          };
        } catch (err) {
          console.error('IndexedDB init error:', err);
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  // Save up to 20,000+ candles asynchronously into IndexedDB without quota limits
  async function saveKlinesToStorage(symbol, interval, rows) {
    if (!rows || rows.length === 0) return false;
    const key = `${symbol.trim().toUpperCase()}_${interval}`;

    try {
      const db = await getIDB();
      if (!db) return false;

      // Compact format: [time_seconds, open, high, low, close, volume]
      const compact = rows.map(r => [
        r.time,
        r.open,
        r.high,
        r.low,
        r.close,
        r.volume
      ]);

      const record = {
        key: key,
        symbol: symbol.trim().toUpperCase(),
        interval: interval,
        data: compact,
        count: rows.length,
        updatedAt: Date.now()
      };

      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE_KLINES, 'readwrite');
          const store = tx.objectStore(IDB_STORE_KLINES);
          store.put(record);

          tx.oncomplete = () => resolve(true);
          tx.onerror = (e) => {
            console.warn('Failed to save klines to IndexedDB:', e.target.error);
            resolve(false);
          };
        } catch (txErr) {
          console.warn('IndexedDB transaction error:', txErr);
          resolve(false);
        }
      });
    } catch (e) {
      console.warn('saveKlinesToStorage IndexedDB error:', e);
      return false;
    }
  }

  // Load up to 20,000+ candles asynchronously from IndexedDB (< 15ms)
  async function loadKlinesFromStorage(symbol, interval) {
    const key = `${symbol.trim().toUpperCase()}_${interval}`;

    try {
      const db = await getIDB();
      if (!db) return null;

      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE_KLINES, 'readonly');
          const store = tx.objectStore(IDB_STORE_KLINES);
          const req = store.get(key);

          req.onsuccess = () => {
            const result = req.result;
            if (!result || !result.data || !Array.isArray(result.data) || result.data.length === 0) {
              resolve(null);
              return;
            }

            const rows = result.data.map(c => ({
              open_time: c[0] * 1000,
              time: c[0],
              open: c[1],
              high: c[2],
              low: c[3],
              close: c[4],
              volume: c[5],
              datetime: new Date(c[0] * 1000).toISOString().replace('T', ' ').slice(0, 19)
            }));

            resolve(rows);
          };

          req.onerror = () => {
            resolve(null);
          };
        } catch (txErr) {
          console.warn('IndexedDB read transaction error:', txErr);
          resolve(null);
        }
      });
    } catch (e) {
      console.warn('loadKlinesFromStorage IndexedDB error:', e);
      return null;
    }
  }

  // Prune any legacy smc_klines_ from localStorage to clear quota warnings
  function cleanLegacyLocalStorage() {
    try {
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('smc_klines_') || k.startsWith(KLINE_CACHE_PREFIX))) {
          toDelete.push(k);
        }
      }
      for (const k of toDelete) {
        localStorage.removeItem(k);
      }
    } catch (e) {}
  }

  // --- Yahoo Finance Helper Functions ---
  function isYahooSymbol(symbol) {
    if (!symbol) return false;
    const s = symbol.trim().toUpperCase();
    if (s.includes('=X') || s.includes('=F') || s.startsWith('^') || s.includes('.NYB') || s.includes('-')) return true;
    if (YAHOO_MARKETS.forex.includes(s) || YAHOO_MARKETS.stocks.includes(s) || YAHOO_MARKETS.indices.includes(s) || YAHOO_MARKETS.commodities.includes(s)) return true;
    if (s.endsWith('USDT')) return false;
    return true; // Default fallback to Yahoo Finance for other tickers
  }

  function getYahooInterval(interval) {
    switch (interval) {
      case '1m': return '1m';
      case '3m': return '5m';
      case '5m': return '5m';
      case '15m': return '15m';
      case '30m': return '30m';
      case '1h': return '1h';
      case '2h': return '1h';
      case '4h': return '1h';
      case '1d': return '1d';
      default: return '15m';
    }
  }

  function getYahooRangeParams(interval) {
    const yfInterval = getYahooInterval(interval);

    if (yfInterval === '1d') {
      return 'interval=1d&range=50y';
    } else if (yfInterval === '1h') {
      return 'interval=1h&range=730d'; // 730 days (~17,500 hourly bars)
    } else if (yfInterval === '1m') {
      return 'interval=1m&range=7d';
    } else {
      return `interval=${yfInterval}&range=60d`; // 60 days (Yahoo intraday hard limit: ~5,700 15m bars, ~17,000 5m bars)
    }
  }

  // Resilient multi-tier Yahoo Finance JSON fetcher with CORS fallbacks
  async function fetchYahooJson(url) {
    const urlsToTry = [
      url,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];

    for (const target of urlsToTry) {
      try {
        const res = await fetch(target);
        if (!res.ok) continue;
        const text = await res.text();
        const data = JSON.parse(text);
        if (data && data.chart && data.chart.result && Array.isArray(data.chart.result) && data.chart.result.length > 0) {
          return data;
        }
      } catch (err) {
        // Try next proxy mirror
      }
    }
    throw new Error('Yahoo Finance API request failed across all connection channels.');
  }

  function parseYahooChartResult(chartResult) {
    if (!chartResult || !chartResult.timestamp || !chartResult.indicators || !chartResult.indicators.quote) {
      return [];
    }
    const timestamps = chartResult.timestamp;
    const quote = chartResult.indicators.quote[0];
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const rows = [];
    for (let i = 0; i < timestamps.length; i++) {
      const t = timestamps[i];
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const c = closes[i];
      const v = volumes[i];

      if (t === null || t === undefined || isNaN(t)) continue;
      if (o === null || h === null || l === null || c === null || isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c)) continue;

      const openTimeMs = t * 1000;
      rows.push({
        open_time: openTimeMs,
        time: t,
        open: Number(o),
        high: Number(h),
        low: Number(l),
        close: Number(c),
        volume: Number(v || 0),
        datetime: new Date(openTimeMs).toISOString().replace('T', ' ').slice(0, 19)
      });
    }

    return rows;
  }

  // --- Unified Static Candle Loader (Binance Crypto + Yahoo Markets) ---
  async function fetchLiveCandles(symbol, interval, totalLimit = 20000, forceFullRefresh = false) {
    state.symbol = symbol;
    if (isStockOrIndex(symbol)) {
      interval = '1h';
      state.timeframe = '1h';
    } else {
      state.timeframe = interval;
    }
    state.candleLimit = totalLimit;
    syncTimeframeSelectorForSymbol(symbol);

    if (isYahooSymbol(symbol)) {
      await fetchYahooCandles(symbol, interval, totalLimit, forceFullRefresh);
    } else {
      await fetchBinanceCandles(symbol, interval, totalLimit, forceFullRefresh);
    }
  }

  // --- Fetch Yahoo Finance Data with 20k IndexedDB Storage Support ---
  async function fetchYahooCandles(symbol, interval, totalLimit = 20000, forceFullRefresh = false) {
    // 1. Cache-First: Try reading from IndexedDB
    const cachedRows = !forceFullRefresh ? await loadKlinesFromStorage(symbol, interval) : null;

    if (cachedRows && cachedRows.length > 0) {
      processRawData(cachedRows, `Cache 💾 (${cachedRows.length.toLocaleString()} candles)`);
      return;
    }

    // 2. Fetch full dataset from Yahoo Finance
    setStatus('loading', `Downloading candles for ${symbol} (${interval}) from Yahoo Finance...`);
    try {
      const queryParams = getYahooRangeParams(interval);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${queryParams}`;

      const json = await fetchYahooJson(url);
      const result = json.chart.result[0];
      const rows = parseYahooChartResult(result);

      if (!rows || rows.length === 0) {
        throw new Error(`No candles returned for ${symbol}`);
      }

      // Update 24h ticker info from metadata
      if (result.meta) {
        const lastPrice = result.meta.regularMarketPrice || rows[rows.length - 1].close;
        const prevClose = result.meta.chartPreviousClose || result.meta.previousClose || rows[0].open;
        const chgPct = prevClose ? ((lastPrice - prevClose) / prevClose) * 100 : 0;
        state.tickerMap.set(symbol, {
          lastPrice: Number(lastPrice),
          changePct: Number(chgPct),
          quoteVolume: Number(result.meta.regularMarketVolume || 0)
        });
        updateHeaderTickerDisplay();
      }

      rows.sort((a, b) => a.open_time - b.open_time);
      const finalRows = rows.length > totalLimit ? rows.slice(-totalLimit) : rows;

      // Save up to 20k to browser IndexedDB
      await saveKlinesToStorage(symbol, interval, finalRows);

      state.symbol = symbol;
      state.timeframe = interval;
      processRawData(finalRows, `Yahoo Finance 🌐 (${finalRows.length.toLocaleString()} candles)`);
    } catch (err) {
      console.error('Yahoo fetch error:', err);
      setStatus('error', `Yahoo Finance error: ${err.message}`);
    }
  }

  // --- Fetch Binance Futures Data with 20k IndexedDB Storage Support ---
  async function fetchBinanceCandles(symbol, interval, totalLimit = 20000, forceFullRefresh = false) {
    // 1. Cache-First: Try reading from IndexedDB
    const cachedRows = !forceFullRefresh ? await loadKlinesFromStorage(symbol, interval) : null;

    if (cachedRows && cachedRows.length > 0) {
      processRawData(cachedRows, `Cache 💾 (${cachedRows.length.toLocaleString()} candles)`);
      return;
    }

    // 2. Fetch full dataset from Binance Futures
    setStatus('loading', `Downloading ${totalLimit.toLocaleString()} candles for ${symbol} (${interval})...`);
    const url = 'https://fapi.binance.com/fapi/v1/klines';
    let allCandles = [];
    let endTime = null;
    let remaining = totalLimit;

    try {
      while (remaining > 0) {
        const fetchLimit = Math.min(remaining, 1500);
        let fetchUrl = `${url}?symbol=${symbol}&interval=${interval}&limit=${fetchLimit}`;
        if (endTime) fetchUrl += `&endTime=${endTime}`;

        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error(`Binance API error HTTP ${res.status}`);
        const klines = await res.json();
        if (!klines || !Array.isArray(klines) || klines.length === 0) break;

        allCandles = klines.concat(allCandles);
        remaining -= klines.length;
        endTime = klines[0][0] - 1;

        const downloaded = allCandles.length;
        setStatus('loading', `Downloading ${totalLimit.toLocaleString()} candles: ${downloaded.toLocaleString()} / ${totalLimit.toLocaleString()}...`);

        if (klines.length < fetchLimit) break;
      }

      if (allCandles.length === 0) throw new Error('No candles returned for ' + symbol);

      const rows = allCandles.map(k => ({
        open_time: k[0],
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        datetime: new Date(k[0]).toISOString().replace('T', ' ').slice(0, 19)
      }));

      const seen = new Set();
      const uniqueRows = [];
      for (const r of rows) {
        if (!seen.has(r.open_time)) {
          seen.add(r.open_time);
          uniqueRows.push(r);
        }
      }
      uniqueRows.sort((a, b) => a.open_time - b.open_time);

      // Save full 20k to browser IndexedDB
      await saveKlinesToStorage(symbol, interval, uniqueRows);

      state.symbol = symbol;
      state.timeframe = interval;
      processRawData(uniqueRows, `Saved to Storage 💾 (${uniqueRows.length.toLocaleString()} candles)`);
    } catch (err) {
      console.error('Binance fetch error:', err);
      setStatus('error', `Download failed: ${err.message}`);
    }
  }

  function handleLiveKlineUpdate(k) {
    if (!state.chartData || state.chartData.length === 0) return;

    const candleTime = Math.floor(k.t / 1000);
    const open = parseFloat(k.o);
    const high = parseFloat(k.h);
    const low = parseFloat(k.l);
    const close = parseFloat(k.c);
    const vol = parseFloat(k.v);
    const isClosed = k.x;

    const lastIdx = state.chartData.length - 1;
    const lastCandle = state.chartData[lastIdx];

    if (lastCandle.time === candleTime) {
      lastCandle.open = open;
      lastCandle.high = high;
      lastCandle.low = low;
      lastCandle.close = close;
      lastCandle.volume = vol;
    } else if (candleTime > lastCandle.time) {
      state.chartData.push({
        time: candleTime,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: vol
      });
      state.volumeData.push({
        time: candleTime,
        value: vol,
        color: close >= open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'
      });
    }

    candleSeries.update({
      time: candleTime,
      open: open,
      high: high,
      low: low,
      close: close
    });

    volumeSeries.update({
      time: candleTime,
      value: vol,
      color: close >= open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'
    });

    // Update real-time price in header
    el.tkPrice.textContent = `$${formatSymbolPrice(close)}`;

    const now = performance.now();
    if (isClosed || now - lastWsThrottle > 1000) {
      lastWsThrottle = now;
      recalculateFVG();
      recalculateVSR();
      recalculateATR1();
      recalculateATR2();
      updateMarkers();
      scheduleOverlayRender();
    }
  }

  // --- Process Raw OHLCV ---
  function processRawData(rows, sourceName) {
    if (!rows || rows.length === 0) {
      setStatus('error', 'Empty dataset');
      return;
    }

    state.rawData = rows;
    state.chartData = [];
    state.volumeData = [];

    const numRows = rows.length;

    for (let i = 0; i < numRows; i++) {
      const r = rows[i];
      if (r.open === undefined || r.high === undefined) continue;

      let candleTime = r.time;
      if (!candleTime && r.open_time) {
        candleTime = Math.floor(Number(r.open_time) / 1000);
      } else if (!candleTime && r.datetime) {
        candleTime = Math.floor(new Date(r.datetime).getTime() / 1000);
      }
      if (!candleTime) candleTime = i;

      const open = Number(r.open);
      const high = Number(r.high);
      const low = Number(r.low);
      const close = Number(r.close);
      const vol = Number(r.volume || 0);

      state.chartData.push({
        time: candleTime,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: vol
      });

      state.volumeData.push({
        time: candleTime,
        value: vol,
        color: close >= open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'
      });
    }

    detectAndApplyPriceScale(state.chartData);

    candleSeries.setData(state.chartData);
    volumeSeries.setData(state.volumeData);

    el.statCandles.textContent = state.chartData.length.toLocaleString();

    // 100% Client-side JS calculations
    recalculateFVG();
    recalculateVSR();
    recalculateATR1();
    recalculateATR2();

    updateMarkers();
    updateHeaderTickerDisplay();
    chart.timeScale().fitContent();
    setStatus('ready', `Active: ${state.chartData.length.toLocaleString()} candles (${sourceName})`);
  }

  // --- 1. Calculate FVG ---
  function recalculateFVG() {
    if (!state.chartData || state.chartData.length === 0) return;

    const t0 = performance.now();
    const fvgResults = SMC.fvg(state.chartData, state.fvg.joinConsecutive);
    const duration = (performance.now() - t0).toFixed(1);

    state.fvgList = [];
    const numRows = state.chartData.length;

    for (let i = 0; i < numRows; i++) {
      const item = fvgResults[i];
      if (item && item.fvg !== null) {
        const isBull = item.fvg === 1;
        const topVal = Number(item.top);
        const btmVal = Number(item.bottom);
        const gapSize = Math.abs(topVal - btmVal);
        const basePrice = isBull ? btmVal : topVal;
        const sizePct = basePrice > 0 ? (gapSize / basePrice * 100) : 0;

        const mitIdx = (item.mitigatedIndex !== null && item.mitigatedIndex > 0) ? item.mitigatedIndex : null;
        let mitTime = null;
        let barsToMit = null;

        if (mitIdx !== null && mitIdx < numRows && state.chartData[mitIdx]) {
          mitTime = state.chartData[mitIdx].time;
          barsToMit = mitIdx - i;
        }

        state.fvgList.push({
          index: i,
          time: state.chartData[i].time,
          fvg: item.fvg,
          top: topVal,
          bottom: btmVal,
          size: gapSize,
          sizePct: sizePct,
          mitigatedIndex: mitIdx,
          mitigatedTime: mitTime,
          barsToMitigate: barsToMit
        });
      }
    }

    el.activeFVGCount.textContent = `${state.fvgList.length} FVGs (${duration}ms)`;
    updateTableAndStats();
    scheduleOverlayRender();
  }

  // --- 2. Calculate VSR (10-10) ---
  function recalculateVSR() {
    if (!state.chartData || state.chartData.length === 0) return;

    const vsrResults = VSR.calculate(state.chartData, {
      length: state.vsr.length,
      threshold: state.vsr.threshold
    });
    state.vsrData = vsrResults;

    const spikes = vsrResults.filter(r => r.isSpike);
    el.badgeVSRCount.textContent = `${spikes.length} Spikes`;

    updateMarkers();
    scheduleOverlayRender();
  }

  // --- 3. Calculate ATR Bot 1 (Slow / VIDYA 14/55/4) ---
  function recalculateATR1() {
    if (!state.chartData || state.chartData.length === 0) return;

    const atrResults = ATRBot.calculate(state.chartData, {
      atrLength: state.atr1.length,
      atrMult: state.atr1.mult,
      maType: state.atr1.maType,
      maLength: state.atr1.maLength,
      source: "close"
    });
    state.atr1Data = atrResults;

    if (atrResults.length > 0) {
      const lastTrend = atrResults[atrResults.length - 1].trend;
      el.badgeATR1Trend.textContent = lastTrend === 1 ? 'BULL' : 'BEAR';
      el.badgeATR1Trend.className = `badge-tag ${lastTrend === 1 ? 'badge-bull' : 'badge-bear'}`;
    }

    updateMarkers();
    scheduleOverlayRender();
  }

  // --- 4. Calculate ATR Bot 2 (Fast / VIDYA 14/21/2) ---
  function recalculateATR2() {
    if (!state.chartData || state.chartData.length === 0) return;

    const atrResults = ATRBot.calculate(state.chartData, {
      atrLength: state.atr2.length,
      atrMult: state.atr2.mult,
      maType: state.atr2.maType,
      maLength: state.atr2.maLength,
      source: "close"
    });
    state.atr2Data = atrResults;

    if (atrResults.length > 0) {
      const lastTrend = atrResults[atrResults.length - 1].trend;
      el.badgeATR2Trend.textContent = lastTrend === 1 ? 'BULL' : 'BEAR';
      el.badgeATR2Trend.className = `badge-tag ${lastTrend === 1 ? 'badge-bull' : 'badge-bear'}`;
    }

    updateMarkers();
    scheduleOverlayRender();
  }

  // --- Update Markers on Candlestick Series ---
  function updateMarkers() {
    const markers = [];

    // 1. ATR Bot 1 (Slow / Trend) Signals
    if (state.atr1.enable && state.atr1.showSignals && state.atr1Data.length > 0) {
      for (let i = 0; i < state.atr1Data.length; i++) {
        const item = state.atr1Data[i];
        if (item.isBuy) {
          markers.push({
            time: item.time,
            position: 'belowBar',
            color: '#a855f7',
            shape: 'arrowUp',
            text: 'T-BUY',
            size: 2
          });
        } else if (item.isSell) {
          markers.push({
            time: item.time,
            position: 'aboveBar',
            color: '#ec4899',
            shape: 'arrowDown',
            text: 'T-SELL',
            size: 2
          });
        }
      }
    }

    // 2. ATR Bot 2 (Fast / Scalp) Signals
    if (state.atr2.enable && state.atr2.showSignals && state.atr2Data.length > 0) {
      for (let i = 0; i < state.atr2Data.length; i++) {
        const item = state.atr2Data[i];
        if (item.isBuy) {
          markers.push({
            time: item.time,
            position: 'belowBar',
            color: '#10b981',
            shape: 'arrowUp',
            text: 'BUY',
            size: 1
          });
        } else if (item.isSell) {
          markers.push({
            time: item.time,
            position: 'aboveBar',
            color: '#f43f5e',
            shape: 'arrowDown',
            text: 'SELL',
            size: 1
          });
        }
      }
    }

    // 3. VSR Volume Spikes
    if (state.vsr.enable && state.vsr.showSpikes && state.vsrData.length > 0) {
      for (let i = 0; i < state.vsrData.length; i++) {
        const item = state.vsrData[i];
        if (item.isSpike) {
          markers.push({
            time: item.time,
            position: 'aboveBar',
            color: '#facc15',
            shape: 'circle',
            size: 1
          });
        }
      }
    }

    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);
  }

  // --- Update FVG Table & Statistics ---
  function updateTableAndStats() {
    const list = state.fvgList;
    let bullCount = 0, bearCount = 0, mitCount = 0, unmitCount = 0;
    let totalBars = 0, mitBarsCount = 0, totalPct = 0;
    const filteredForDisplay = [];

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const isBull = item.fvg === 1;
      const isMit = item.mitigatedIndex !== null;

      if (isBull) bullCount++;
      else bearCount++;

      if (isMit) {
        mitCount++;
        if (item.barsToMitigate !== null) {
          totalBars += item.barsToMitigate;
          mitBarsCount++;
        }
      } else {
        unmitCount++;
      }

      totalPct += item.sizePct;

      if (isBull && !state.fvg.bullish) continue;
      if (!isBull && !state.fvg.bearish) continue;
      if (state.fvg.unmitigatedOnly && isMit) continue;
      if (item.sizePct < state.minGapPercent) continue;

      filteredForDisplay.push(item);
    }

    const total = list.length;
    const mitRate = total > 0 ? ((mitCount / total) * 100).toFixed(1) : '0.0';
    const avgBars = mitBarsCount > 0 ? (totalBars / mitBarsCount).toFixed(1) : '0';
    const avgGapPct = total > 0 ? (totalPct / total).toFixed(2) : '0.00';

    el.statTotalFVG.textContent = total.toLocaleString();
    el.statMitigationRate.textContent = `${mitRate}%`;
    el.statBullCount.textContent = bullCount.toLocaleString();
    el.statBearCount.textContent = bearCount.toLocaleString();
    el.statUnmitCount.textContent = unmitCount.toLocaleString();
    el.statAvgBars.textContent = `${avgBars} bars`;
    el.statAvgGapSize.textContent = `${avgGapPct}%`;
    el.listCounter.textContent = `${filteredForDisplay.length} / ${total} FVGs`;

    renderFVGTable(filteredForDisplay);
  }

  function renderFVGTable(filteredList) {
    if (filteredList.length === 0) {
      el.fvgTableBody.innerHTML = '<tr><td colspan="6" class="text-center" style="padding:15px;color:#64748b;">No FVGs matching active filters</td></tr>';
      return;
    }

    const displayList = filteredList.slice(-150).reverse();
    let html = '';

    for (let i = 0; i < displayList.length; i++) {
      const item = displayList[i];
      const isBull = item.fvg === 1;
      const isMit = item.mitigatedIndex !== null;

      const typeBadge = isBull
        ? '<span class="badge-tbl badge-bull">+FVG</span>'
        : '<span class="badge-tbl badge-bear">-FVG</span>';

      const statusBadge = isMit
        ? `<span class="badge-tbl badge-mit">Mit @ #${item.mitigatedIndex} (+${item.barsToMitigate}b)</span>`
        : '<span class="badge-tbl badge-active">Active (Open)</span>';

      html += `<tr data-time="${item.time}">
        <td style="color:#64748b;">#${item.index}</td>
        <td>${typeBadge}</td>
        <td>${formatPrice(item.top)}</td>
        <td>${formatPrice(item.bottom)}</td>
        <td style="color:#38bdf8;">${item.sizePct.toFixed(2)}%</td>
        <td>${statusBadge}</td>
      </tr>`;
    }

    el.fvgTableBody.innerHTML = html;

    const rows = el.fvgTableBody.querySelectorAll('tr[data-time]');
    rows.forEach(r => {
      r.addEventListener('click', () => {
        const t = parseInt(r.dataset.time, 10);
        if (t && chart) {
          closeConfigModal();
          const step = state.chartData[1]?.time - state.chartData[0]?.time || 900;
          chart.timeScale().setVisibleRange({
            from: t - 50 * step,
            to: t + 50 * step
          });
        }
      });
    });
  }

  // --- Canvas Overlay Rendering: FVG + VSR + Dual ATR Bot ---
  function scheduleOverlayRender() {
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(() => {
        renderOverlay();
        renderScheduled = false;
      });
    }
  }

  function renderOverlay() {
    if (!chart || !candleSeries || !ctx) return;

    const w = el.chartContainer.clientWidth;
    const h = el.chartContainer.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const timeScale = chart.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    if (!visibleRange) return;

    const fromTime = visibleRange.from;
    const toTime = visibleRange.to;

    const getX = (t) => (t !== null && t !== undefined) ? timeScale.timeToCoordinate(t) : null;
    const getY = (p) => (p !== null && p !== undefined && !isNaN(p)) ? candleSeries.priceToCoordinate(p) : null;
    const rightViewportX = w - 65;

    // 1. Draw ATR Bot 1 (Slow / VIDYA 14/55/4)
    if (state.atr1.enable && state.atr1Data.length > 0) {
      renderSingleATRBotOverlay(state.atr1Data, state.atr1, '#a855f7', '#ec4899', 'rgba(168, 85, 247, 0.14)', 'rgba(236, 72, 153, 0.14)', getX, getY, fromTime, toTime);
    }

    // 2. Draw ATR Bot 2 (Fast / VIDYA 14/21/2)
    if (state.atr2.enable && state.atr2Data.length > 0) {
      renderSingleATRBotOverlay(state.atr2Data, state.atr2, '#06b6d4', '#f59e0b', 'rgba(16, 185, 129, 0.16)', 'rgba(244, 63, 94, 0.16)', getX, getY, fromTime, toTime);
    }

    // 3. Draw VSR Zones
    if (state.vsr.enable && state.vsr.showZone && state.vsrData.length > 0) {
      renderVSROverlay(getX, getY, fromTime, toTime);
    }

    // 4. Draw FVG Boxes
    if (state.fvg.enable) {
      renderFVGOverlay(getX, getY, fromTime, toTime, rightViewportX);
    }

    // 5. Draw Measurement Tool (Shift + Click Measure)
    if (measure.start && measure.current && (measure.isMeasuring || measure.isPinned)) {
      renderMeasurementOverlay(getX, getY, fromTime, toTime);
    }
  }

  // --- Draw Measurement Tool Box & Metrics ---
  function renderMeasurementOverlay(getX, getY, fromTime, toTime) {
    const t1 = measure.start.time;
    const t2 = measure.current.time;
    const p1 = measure.start.price;
    const p2 = measure.current.price;

    const x1 = getX(t1);
    const x2 = getX(t2);
    const y1 = getY(p1);
    const y2 = getY(p2);

    if (x1 === null || x2 === null || y1 === null || y2 === null) return;

    const isBull = p2 >= p1;
    const color = isBull ? '#38bdf8' : '#f43f5e';
    const fillColor = isBull ? 'rgba(56, 189, 248, 0.18)' : 'rgba(244, 63, 94, 0.18)';
    const borderColor = isBull ? 'rgba(56, 189, 248, 0.9)' : 'rgba(244, 63, 94, 0.9)';

    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const boxW = Math.max(maxX - minX, 2);
    const boxH = Math.max(maxY - minY, 2);

    ctx.save();

    // 1. Measure Shaded Box
    ctx.fillStyle = fillColor;
    ctx.fillRect(minX, minY, boxW, boxH);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(minX, minY, boxW, boxH);

    // 2. Diagonal Vector Line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.stroke();

    // 3. Anchor Points
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x1, y1, 4, 0, Math.PI * 2);
    ctx.arc(x2, y2, 4, 0, Math.PI * 2);
    ctx.fill();

    // 4. Calculate Detailed Metrics
    const deltaPrice = p2 - p1;
    const pct = p1 > 0 ? (deltaPrice / p1 * 100) : 0;
    const sign = isBull ? '+' : '';

    let barCount = 1;
    let volSum = 0;
    if (state.chartData && state.chartData.length > 0) {
      const idx1 = state.chartData.findIndex(c => c.time === t1);
      const idx2 = state.chartData.findIndex(c => c.time === t2);
      if (idx1 !== -1 && idx2 !== -1) {
        const startIdx = Math.min(idx1, idx2);
        const endIdx = Math.max(idx1, idx2);
        barCount = endIdx - startIdx + 1;
        for (let i = startIdx; i <= endIdx; i++) {
          volSum += (state.chartData[i].volume || 0);
        }
      }
    }

    const durationSec = Math.abs(t2 - t1);
    const durationStr = formatDuration(durationSec);

    // 5. Draw Floating Metric Card
    const cardW = 185;
    const cardH = 64;
    let cardX = (x1 + x2) / 2 - cardW / 2;
    let cardY = minY - cardH - 12;

    const maxViewportW = el.chartContainer.clientWidth || 800;
    if (cardX < 10) cardX = 10;
    if (cardX + cardW > maxViewportW - 65) cardX = maxViewportW - 65 - cardW;
    if (cardY < 10) cardY = maxY + 12;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(cardX, cardY, cardW, cardH, 6);
    } else {
      ctx.rect(cardX, cardY, cardW, cardH);
    }
    ctx.fill();
    ctx.stroke();

    // Tooltip Typography
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = isBull ? '#38bdf8' : '#fb7185';
    ctx.fillText(`${isBull ? '▲' : '▼'} ${sign}${formatPrice(deltaPrice)} (${sign}${pct.toFixed(2)}%)`, cardX + 10, cardY + 20);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`📅 ${barCount} bars • ${durationStr}`, cardX + 10, cardY + 38);

    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`📊 Vol: ${formatUSDVolume(volSum)}`, cardX + 10, cardY + 54);

    ctx.restore();
  }

  function formatDuration(sec) {
    if (sec <= 0) return '0m';
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const mins = Math.floor((sec % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  // --- Draw FVG Zones ---
  function renderFVGOverlay(getX, getY, fromTime, toTime, rightViewportX) {
    const list = state.fvgList;
    const numRows = state.chartData.length;
    const latestCandleTime = numRows > 0 ? state.chartData[numRows - 1].time : toTime;

    const opacity = state.boxOpacity;
    const borderOpacity = Math.min(opacity + 0.45, 1.0);

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const isBull = item.fvg === 1;
      const isMit = item.mitigatedIndex !== null;

      if (isBull && !state.fvg.bullish) continue;
      if (!isBull && !state.fvg.bearish) continue;
      if (state.fvg.unmitigatedOnly && isMit) continue;
      if (item.sizePct < state.minGapPercent) continue;

      const endTime = item.mitigatedTime || latestCandleTime;
      if (endTime < fromTime || item.time > toTime) continue;

      const x1 = getX(item.time);
      const x2 = item.mitigatedTime ? getX(item.mitigatedTime) : rightViewportX;

      const startX = x1 !== null ? x1 : 0;
      const endX = x2 !== null ? x2 : rightViewportX;
      const boxWidth = Math.max(endX - startX, 4);

      const yTop = getY(item.top);
      const yBottom = getY(item.bottom);
      if (yTop === null || yBottom === null) continue;

      const boxY = Math.min(yTop, yBottom);
      const boxHeight = Math.max(Math.abs(yBottom - yTop), 1.5);

      ctx.save();
      if (isBull) {
        ctx.fillStyle = `rgba(16, 185, 129, ${isMit ? opacity * 0.5 : opacity})`;
        ctx.strokeStyle = `rgba(16, 185, 129, ${isMit ? borderOpacity * 0.6 : borderOpacity})`;
      } else {
        ctx.fillStyle = `rgba(244, 63, 94, ${isMit ? opacity * 0.5 : opacity})`;
        ctx.strokeStyle = `rgba(244, 63, 94, ${isMit ? borderOpacity * 0.6 : borderOpacity})`;
      }

      ctx.lineWidth = 1;
      ctx.fillRect(startX, boxY, boxWidth, boxHeight);
      ctx.strokeRect(startX, boxY, boxWidth, boxHeight);
      ctx.restore();
    }
  }

  // --- Draw VSR Zone ---
  function renderVSROverlay(getX, getY, fromTime, toTime) {
    const data = state.vsrData;
    if (data.length < 2) return;

    ctx.save();

    ctx.fillStyle = 'rgba(250, 204, 21, 0.12)';
    ctx.beginPath();
    let started = false;

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item.time < fromTime || item.time > toTime) continue;
      if (item.upper === null || item.lower === null) continue;

      const x = getX(item.time);
      const yUpper = getY(item.upper);
      if (x === null || yUpper === null) continue;

      if (!started) {
        ctx.moveTo(x, yUpper);
        started = true;
      } else {
        ctx.lineTo(x, yUpper);
      }
    }

    for (let i = data.length - 1; i >= 0; i--) {
      const item = data[i];
      if (item.time < fromTime || item.time > toTime) continue;
      if (item.upper === null || item.lower === null) continue;

      const x = getX(item.time);
      const yLower = getY(item.lower);
      if (x === null || yLower === null) continue;

      ctx.lineTo(x, yLower);
    }

    if (started) {
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 2]);

    // Upper line
    ctx.beginPath();
    started = false;
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item.time < fromTime || item.time > toTime) continue;
      if (item.upper === null) continue;
      const x = getX(item.time);
      const y = getY(item.upper);
      if (x === null || y === null) continue;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    if (started) ctx.stroke();

    // Lower line
    ctx.beginPath();
    started = false;
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (item.time < fromTime || item.time > toTime) continue;
      if (item.lower === null) continue;
      const x = getX(item.time);
      const y = getY(item.lower);
      if (x === null || y === null) continue;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    if (started) ctx.stroke();

    ctx.restore();
  }

  // --- Draw Single ATR Bot ---
  function renderSingleATRBotOverlay(data, config, colorT1, colorT2, fillBull, fillBear, getX, getY, fromTime, toTime) {
    if (data.length < 2) return;

    ctx.save();

    // 1. Ribbon fill
    if (config.showRibbon) {
      for (let i = 1; i < data.length; i++) {
        const p1 = data[i - 1];
        const p2 = data[i];
        if (p2.time < fromTime || p1.time > toTime) continue;

        const x1 = getX(p1.time);
        const x2 = getX(p2.time);
        const y1_t1 = getY(p1.trail1);
        const y1_t2 = getY(p1.trail2);
        const y2_t1 = getY(p2.trail1);
        const y2_t2 = getY(p2.trail2);

        if (x1 === null || x2 === null || y1_t1 === null || y2_t1 === null) continue;

        const isBull = p2.trail1 >= p2.trail2;
        ctx.fillStyle = isBull ? fillBull : fillBear;

        ctx.beginPath();
        ctx.moveTo(x1, y1_t1);
        ctx.lineTo(x2, y2_t1);
        ctx.lineTo(x2, y2_t2);
        ctx.lineTo(x1, y1_t2);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 2. Stroke lines
    if (config.showLines) {
      // Trail 1 line
      ctx.lineWidth = 1.8;
      ctx.setLineDash([]);
      ctx.strokeStyle = colorT1;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item.time < fromTime || item.time > toTime) continue;
        const x = getX(item.time);
        const y = getY(item.trail1);
        if (x === null || y === null) continue;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }
      if (started) ctx.stroke();

      // Trail 2 line
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = colorT2;
      ctx.beginPath();
      started = false;
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item.time < fromTime || item.time > toTime) continue;
        const x = getX(item.time);
        const y = getY(item.trail2);
        if (x === null || y === null) continue;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }
      if (started) ctx.stroke();
    }

    ctx.restore();
  }

  // --- Crosshair Hover Inspector ---
  function updateCrosshairLegend(param) {
    if (!param || !param.time || !param.seriesData || !param.seriesData.get(candleSeries)) {
      return;
    }

    // Update real-time measurement tracking
    if (param.point && param.time) {
      const price = candleSeries.coordinateToPrice(param.point.y);
      measure.lastCrosshair = {
        time: param.time,
        price: price !== null ? price : null,
        x: param.point.x,
        y: param.point.y
      };

      if (measure.isMeasuring && measure.start) {
        measure.current = { ...measure.lastCrosshair };
        scheduleOverlayRender();
      }
    }
  }

  function setStatus(type, msg) {
    el.statusBadge.className = `status-badge status-${type}`;
    el.statusText.textContent = msg;
  }

  // Bootstrap
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
