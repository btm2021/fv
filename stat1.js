/**
 * STAT1 Engine - Pure Client-Side SMC, ATRBot & VSR Real-Time WebApp
 * 
 * Features:
 * - Direct Binance Futures exchangeInfo + 24hr ticker batch metadata caching in IndexedDB
 * - Advanced Symbol Search & Filter Modal (Volume, LastPrice, Change%, Filter tabs)
 * - IndexedDB storage for 10,000+ OHLCV candles (instant startup & incremental sync)
 * - IndexedDB storage for all Indicator Settings & User Preferences
 * - 100% Pure JavaScript Indicator calculations using smc.js
 * - High-DPI Canvas overlay synced with TradingView Lightweight Charts
 */

(function () {
  'use strict';

  // --- Configuration & Constants ---
  const DB_NAME = 'SMC_STAT1_DB';
  const DB_VERSION = 2;
  const STORE_CANDLES = 'ohlcv_candles';
  const STORE_SETTINGS = 'user_settings';
  const STORE_SYMBOLS = 'symbols_meta';
  const SYMBOLS_CACHE_TTL = 3600 * 1000; // 1 hour cache TTL

  const DEFAULT_SETTINGS = {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    candleLimit: 10000,
    pricePrecision: 2,
    indicatorInstances: [
      {
        id: 'inst_smc_1',
        type: 'smc',
        name: 'Smart Money Concepts',
        visible: true,
        inputs: { swingLength: 20, closeBreak: 'true', rangePercent: 1.0, unmitigatedOnly: 'false' },
        style: { showOB: true, bullOBColor: '#3b82f6', bearOBColor: '#f59e0b', showFVG: true, bullFVGColor: '#10b981', bearFVGColor: '#f43f5e', showLiquidity: true, bslColor: '#d946ef', sslColor: '#6366f1', showBOS: true, bosColor: '#06b6d4', chochColor: '#ec4899', showSwings: true }
      },
      {
        id: 'inst_atr_1',
        type: 'atrbot',
        name: 'ATRBot',
        visible: true,
        inputs: { maType: 'VIDYA', source: 'close', maLength: 21, cmoLength: 14, atrLength: 14, atrMult: 2.0 },
        style: { showRibbon: true, bullCloudColor: '#10b981', bearCloudColor: '#f43f5e', showVidyaLine: true, vidyaColor: '#06b6d4', vidyaWidth: 2, showStopLine: true, stopColor: '#f59e0b', stopWidth: 2, showSignals: true }
      },
      {
        id: 'inst_vsr_1',
        type: 'vsr',
        name: 'VSR Zones',
        visible: true,
        inputs: { length: 10, threshold: 10.0 },
        style: { showZones: true, zoneColor: '#a855f7', borderDash: 'dashed', showLabels: true }
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
    ]
  };

  // State
  const state = {
    db: null,
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    allSymbols: [],
    filteredSymbols: [],
    activeCategory: 'ALL',
    activeSort: 'volume',
    sortAsc: false,
    searchQuery: '',
    candles: [],
    volume: [],
    editingInstanceId: null,
    indicatorSeriesMap: new Map(), // instanceId -> [ series1, series2, ... ]
    // Runtime
    chart: null,
    candleSeries: null,
    volumeSeries: null,
    ctx: null,
    renderScheduled: false,
    isLoading: false,
    cacheInfo: { count: 0, fromDb: false, newFetched: 0 }
  };

  // DOM Elements
  const el = {};

  // --- 1. IndexedDB Helper (Promise-based) ---
  const DB = {
    async open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_CANDLES)) {
            db.createObjectStore(STORE_CANDLES, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
            db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(STORE_SYMBOLS)) {
            db.createObjectStore(STORE_SYMBOLS, { keyPath: 'id' });
          }
        };
        req.onsuccess = (e) => {
          state.db = e.target.result;
          resolve(state.db);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    },

    async getSymbolsMeta() {
      if (!state.db) await DB.open();
      return new Promise((resolve) => {
        try {
          const tx = state.db.transaction([STORE_SYMBOLS], 'readonly');
          const store = tx.objectStore(STORE_SYMBOLS);
          const req = store.get('binance_futures_symbols');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },

    async saveSymbolsMeta(symbols) {
      if (!state.db) await DB.open();
      return new Promise((resolve) => {
        try {
          const tx = state.db.transaction([STORE_SYMBOLS], 'readwrite');
          const store = tx.objectStore(STORE_SYMBOLS);
          store.put({
            id: 'binance_futures_symbols',
            lastUpdated: Date.now(),
            count: symbols.length,
            symbols
          });
          tx.oncomplete = () => resolve();
        } catch {
          resolve();
        }
      });
    },

    async getCandles(symbol, timeframe) {
      if (!state.db) await DB.open();
      return new Promise((resolve) => {
        try {
          const tx = state.db.transaction([STORE_CANDLES], 'readonly');
          const store = tx.objectStore(STORE_CANDLES);
          const req = store.get(`${symbol}_${timeframe}`);
          req.onsuccess = () => resolve(req.result ? req.result.candles : null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },

    async saveCandles(symbol, timeframe, candles) {
      if (!state.db) await DB.open();
      return new Promise((resolve, reject) => {
        try {
          const tx = state.db.transaction([STORE_CANDLES], 'readwrite');
          const store = tx.objectStore(STORE_CANDLES);
          store.put({
            id: `${symbol}_${timeframe}`,
            symbol,
            timeframe,
            lastUpdated: Date.now(),
            count: candles.length,
            candles
          });
          tx.oncomplete = () => resolve();
          tx.onerror = (e) => reject(e.target.error);
        } catch (err) {
          reject(err);
        }
      });
    },

    async clearCandles(symbol, timeframe) {
      if (!state.db) await DB.open();
      return new Promise((resolve) => {
        try {
          const tx = state.db.transaction([STORE_CANDLES], 'readwrite');
          const store = tx.objectStore(STORE_CANDLES);
          if (symbol && timeframe) {
            store.delete(`${symbol}_${timeframe}`);
          } else {
            store.clear();
          }
          tx.oncomplete = () => resolve();
        } catch {
          resolve();
        }
      });
    },

    async getSettings() {
      if (!state.db) await DB.open();
      return new Promise((resolve) => {
        try {
          const tx = state.db.transaction([STORE_SETTINGS], 'readonly');
          const store = tx.objectStore(STORE_SETTINGS);
          const req = store.get('app_settings');
          req.onsuccess = () => resolve(req.result ? req.result.value : null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },

    async saveSettings(settings) {
      if (!state.db) await DB.open();
      return new Promise((resolve) => {
        try {
          const tx = state.db.transaction([STORE_SETTINGS], 'readwrite');
          const store = tx.objectStore(STORE_SETTINGS);
          store.put({ key: 'app_settings', value: settings });
          tx.oncomplete = () => resolve();
        } catch {
          resolve();
        }
      });
    },

    async getDrawings(symbol) {
      if (!state.db) await DB.open();
      return new Promise((resolve) => {
        try {
          const tx = state.db.transaction([STORE_SETTINGS], 'readonly');
          const store = tx.objectStore(STORE_SETTINGS);
          const req = store.get(`drawings_${symbol}`);
          req.onsuccess = () => resolve(req.result ? req.result.value : []);
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
    },

    async saveDrawings(symbol, drawings) {
      if (!state.db) await DB.open();
      return new Promise((resolve) => {
        try {
          const tx = state.db.transaction([STORE_SETTINGS], 'readwrite');
          const store = tx.objectStore(STORE_SETTINGS);
          store.put({ key: `drawings_${symbol}`, value: drawings });
          tx.oncomplete = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  };

  // --- 2. Initialization ---
  window.addEventListener('DOMContentLoaded', async () => {
    cacheDomElements();
    initChart();
    setupEventListeners();

    // Load persisted settings from IndexedDB
    try {
      const savedSettings = await DB.getSettings();
      if (savedSettings) {
        state.settings = mergeDeep(DEFAULT_SETTINGS, savedSettings);
        applySettingsToUI();
      }
    } catch (e) {
      console.warn('Could not load settings from IndexedDB:', e);
    }

    // 1. Fetch & Initialize Exchange Symbols (Once with IndexedDB Caching)
    await initExchangeSymbols();

    // 2. Load Candles Data (from IndexedDB cache + Binance incremental)
    await loadSymbolData(state.settings.symbol, state.settings.timeframe, state.settings.candleLimit);
  });

  function cacheDomElements() {
    el.chartContainer = document.getElementById('chartContainer');
    el.overlayCanvas = document.getElementById('overlayCanvas');
    el.loadingOverlay = document.getElementById('loadingOverlay');
    el.loadingText = document.getElementById('loadingText');
    el.loadingSubtext = document.getElementById('loadingSubtext');

    // Header Controls
    el.btnOpenSymbolPicker = document.getElementById('btnOpenSymbolPicker');
    el.activeSymbolText = document.getElementById('activeSymbolText');
    el.activePriceText = document.getElementById('activePriceText');
    el.activeChangeText = document.getElementById('activeChangeText');
    el.timeframeSelect = document.getElementById('timeframeSelect');
    el.limitSelect = document.getElementById('limitSelect');
    el.btnReload = document.getElementById('btnReload');
    el.btnClearCache = document.getElementById('btnClearCache');
    el.cacheBadge = document.getElementById('cacheBadge');

    // Symbol Picker Modal
    el.symbolModal = document.getElementById('symbolModal');
    el.btnCloseSymbolModal = document.getElementById('btnCloseSymbolModal');
    el.symbolSearchInput = document.getElementById('symbolSearchInput');
    el.symbolListContainer = document.getElementById('symbolListContainer');
    el.symbolCountBadge = document.getElementById('symbolCountBadge');
    el.tabFilterAll = document.getElementById('tabFilterAll');
    el.tabFilterTop = document.getElementById('tabFilterTop');
    el.tabFilterGainers = document.getElementById('tabFilterGainers');
    // Trade Decision Modal
    el.tradeDecisionModal = document.getElementById('tradeDecisionModal');
    el.btnCloseTradeDecisionModal = document.getElementById('btnCloseTradeDecisionModal');
    el.btnOkTradeDecisionModal = document.getElementById('btnOkTradeDecisionModal');
    el.tradeDecisionModalBody = document.getElementById('tradeDecisionModalBody');
    el.tdModalBadge = document.getElementById('tdModalBadge');
    el.tdModalSymbol = document.getElementById('tdModalSymbol');
    el.tabFilterLosers = document.getElementById('tabFilterLosers');
    el.sortVolumeBtn = document.getElementById('sortVolumeBtn');
    el.sortChangeBtn = document.getElementById('sortChangeBtn');
    el.sortPriceBtn = document.getElementById('sortPriceBtn');
    el.sortNameBtn = document.getElementById('sortNameBtn');

    // Indicator Toggles
    el.toggleFVG = document.getElementById('toggleFVG');
    el.toggleFVGUnmitigated = document.getElementById('toggleFVGUnmitigated');
    el.toggleOB = document.getElementById('toggleOB');
    el.toggleBOS = document.getElementById('toggleBOS');
    el.toggleSwings = document.getElementById('toggleSwings');
    el.toggleLiquidity = document.getElementById('toggleLiquidity');
    el.toggleATRBot = document.getElementById('toggleATRBot');
    el.toggleATRRibbon = document.getElementById('toggleATRRibbon');
    el.toggleATRSignals = document.getElementById('toggleATRSignals');
    el.toggleVSR = document.getElementById('toggleVSR');
    el.toggleEMA = document.getElementById('toggleEMA');
    el.toggleVWAP = document.getElementById('toggleVWAP');

    // Counts
    el.countFVG = document.getElementById('countFVG');
    el.countOB = document.getElementById('countOB');
    el.countBOS = document.getElementById('countBOS');
    el.countSwings = document.getElementById('countSwings');
    el.countLiq = document.getElementById('countLiq');
    el.countATR = document.getElementById('countATR');
    el.countVSR = document.getElementById('countVSR');

    // HUD
    el.hudTime = document.getElementById('hudTime');
    el.hudOpen = document.getElementById('hudOpen');
    el.hudHigh = document.getElementById('hudHigh');
    el.hudLow = document.getElementById('hudLow');
    el.hudClose = document.getElementById('hudClose');
    el.hudVol = document.getElementById('hudVol');
    el.hudTrail1 = document.getElementById('hudTrail1');
    el.hudTrail2 = document.getElementById('hudTrail2');
    el.hudAtrVal = document.getElementById('hudAtrVal');
    el.hudTrendVal = document.getElementById('hudTrendVal');
    el.hudSmcTags = document.getElementById('hudSmcTags');

    // Indicators Catalog Modal (TradingView fx Button)
    el.btnOpenIndicatorsCatalog = document.getElementById('btnOpenIndicatorsCatalog');
    el.indicatorsCatalogModal = document.getElementById('indicatorsCatalogModal');
    el.btnCloseCatalogModal = document.getElementById('btnCloseCatalogModal');
    el.catalogSearchInput = document.getElementById('catalogSearchInput');
    el.catalogListContainer = document.getElementById('catalogListContainer');
    el.chartLegend = document.getElementById('chartLegend');
    el.watermarkSymbol = document.getElementById('watermarkSymbol');
    el.watermarkSub = document.getElementById('watermarkSub');

    // Universal TradingView Indicator Settings Modal
    el.indicatorSettingsModal = document.getElementById('indicatorSettingsModal');
    el.indicatorSettingsModalBody = document.getElementById('indicatorSettingsModalBody');
    el.btnCloseIndSettingsModal = document.getElementById('btnCloseIndSettingsModal');
    el.btnResetIndSettings = document.getElementById('btnResetIndSettings');
    el.btnCancelIndSettings = document.getElementById('btnCancelIndSettings');
    el.btnApplyIndSettings = document.getElementById('btnApplyIndSettings');

    // Drawing Toolbar
    el.drawToolbar = document.getElementById('drawToolbar');
    el.drawBtns = document.querySelectorAll('.draw-btn[data-tool]');
    el.btnDeleteDrawing = document.getElementById('btnDeleteDrawing');
    el.btnClearAllDrawings = document.getElementById('btnClearAllDrawings');

    // Bar Replay Button
    el.btnOpenReplay = document.getElementById('btnOpenReplay');
  }

  // --- 3. ExchangeInfo + 24hr Ticker Loader (Fetched Only Once & Cached in IndexedDB) ---
  async function initExchangeSymbols(force = false) {
    try {
      if (!force) {
        const cached = await DB.getSymbolsMeta();
        if (cached && cached.symbols && cached.symbols.length > 0 && (Date.now() - cached.lastUpdated < SYMBOLS_CACHE_TTL)) {
          state.allSymbols = cached.symbols;
          console.log(`[IndexedDB] Loaded ${state.allSymbols.length} Binance Futures symbols from cache.`);
          updateActiveSymbolHeader();
          filterAndRenderSymbolsList();
          return;
        }
      }

      // Fetch from Binance Futures REST API (Once)
      const [exchangeRes, tickerRes] = await Promise.all([
        fetch('https://fapi.binance.com/fapi/v1/exchangeInfo'),
        fetch('https://fapi.binance.com/fapi/v1/ticker/24hr')
      ]);

      if (!exchangeRes.ok || !tickerRes.ok) throw new Error('Binance API error');

      const exchangeData = await exchangeRes.json();
      const tickerData = await tickerRes.json();

      const tickerMap = new Map();
      if (Array.isArray(tickerData)) {
        for (let i = 0; i < tickerData.length; i++) {
          const t = tickerData[i];
          tickerMap.set(t.symbol, {
            lastPrice: parseFloat(t.lastPrice) || 0,
            changePct: parseFloat(t.priceChangePercent) || 0,
            quoteVolume: parseFloat(t.quoteVolume) || 0
          });
        }
      }

      let symbols = [];
      if (exchangeData && exchangeData.symbols && Array.isArray(exchangeData.symbols)) {
        symbols = exchangeData.symbols
          .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL')
          .map(s => {
            const t = tickerMap.get(s.symbol) || { lastPrice: 0, changePct: 0, quoteVolume: 0 };
            return {
              symbol: s.symbol,
              baseAsset: s.baseAsset,
              quoteAsset: s.quoteAsset,
              pricePrecision: s.pricePrecision !== undefined ? s.pricePrecision : 2,
              quantityPrecision: s.quantityPrecision !== undefined ? s.quantityPrecision : 3,
              lastPrice: t.lastPrice,
              changePct: t.changePct,
              quoteVolume: t.quoteVolume
            };
          });
      }

      // Sort initially by 24h quoteVolume descending
      symbols.sort((a, b) => b.quoteVolume - a.quoteVolume);
      state.allSymbols = symbols;

      // Save to IndexedDB
      await DB.saveSymbolsMeta(symbols);
      console.log(`[Binance API] Loaded & Cached ${symbols.length} Futures symbols in IndexedDB.`);

      updateActiveSymbolHeader();
      filterAndRenderSymbolsList();

    } catch (err) {
      console.warn('Failed to load exchangeInfo:', err);
      // Fallback default popular symbols if offline
      if (!state.allSymbols.length) {
        state.allSymbols = [
          { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', lastPrice: 77250, changePct: 2.5, quoteVolume: 15000000000 },
          { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', lastPrice: 2450, changePct: 1.8, quoteVolume: 6000000000 },
          { symbol: 'SOLUSDT', baseAsset: 'SOL', quoteAsset: 'USDT', lastPrice: 195, changePct: 4.2, quoteVolume: 3500000000 },
          { symbol: 'BNBUSDT', baseAsset: 'BNB', quoteAsset: 'USDT', lastPrice: 620, changePct: -0.5, quoteVolume: 1200000000 }
        ];
        updateActiveSymbolHeader();
        filterAndRenderSymbolsList();
      }
    }
  }

  function updateActiveSymbolHeader() {
    const symObj = state.allSymbols.find(s => s.symbol === state.settings.symbol);
    if (el.activeSymbolText) el.activeSymbolText.innerText = state.settings.symbol;
    if (symObj) {
      if (el.activePriceText) el.activePriceText.innerText = formatPrice(symObj.lastPrice, symObj.pricePrecision);
      if (el.activeChangeText) {
        const sign = symObj.changePct >= 0 ? '+' : '';
        el.activeChangeText.innerText = `${sign}${symObj.changePct.toFixed(2)}%`;
        el.activeChangeText.style.color = symObj.changePct >= 0 ? '#10b981' : '#f43f5e';
      }
    }
    updateWatermark();
  }

  function updateWatermark() {
    if (el.watermarkSymbol) el.watermarkSymbol.innerText = state.settings.symbol;
    if (el.watermarkSub) el.watermarkSub.innerText = `${state.settings.timeframe.toUpperCase()} · BINANCE FUTURES`;
  }

  // --- 4. Symbol Filter & Search List Rendering ---
  function filterAndRenderSymbolsList() {
    if (!el.symbolListContainer) return;

    let list = [...state.allSymbols];
    const q = (state.searchQuery || '').trim().toUpperCase();

    // 1. Search Query Filter
    if (q) {
      list = list.filter(s => s.symbol.includes(q) || s.baseAsset.includes(q));
    }

    // 2. Category Filter
    if (state.activeCategory === 'TOP') {
      list = list.slice(0, 50);
    } else if (state.activeCategory === 'GAINERS') {
      list = list.filter(s => s.changePct > 0);
    } else if (state.activeCategory === 'LOSERS') {
      list = list.filter(s => s.changePct < 0);
    }

    // 3. Sorting
    list.sort((a, b) => {
      let valA, valB;
      if (state.activeSort === 'volume') {
        valA = a.quoteVolume; valB = b.quoteVolume;
      } else if (state.activeSort === 'changePct') {
        valA = a.changePct; valB = b.changePct;
      } else if (state.activeSort === 'lastPrice') {
        valA = a.lastPrice; valB = b.lastPrice;
      } else if (state.activeSort === 'symbol') {
        return state.sortAsc ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      }
      return state.sortAsc ? (valA - valB) : (valB - valA);
    });

    state.filteredSymbols = list;
    if (el.symbolCountBadge) el.symbolCountBadge.innerText = `${list.length} pairs`;

    // Render HTML
    if (list.length === 0) {
      el.symbolListContainer.innerHTML = '<div style="text-align:center; padding: 30px; color: #64748b; font-family: \'JetBrains Mono\', monospace;">No symbols match your search</div>';
      return;
    }

    const html = list.map(s => {
      const isSelected = s.symbol === state.settings.symbol;
      const isUp = s.changePct >= 0;
      const changeColor = isUp ? '#10b981' : '#f43f5e';
      const changeSign = isUp ? '+' : '';
      const formattedPrice = formatPrice(s.lastPrice, s.pricePrecision);
      const formattedVol = formatVolume(s.quoteVolume);

      return `
        <div class="symbol-row-item ${isSelected ? 'selected' : ''}" data-symbol="${s.symbol}">
          <div class="sym-col-left">
            <div class="sym-name">${s.symbol}</div>
            <div class="sym-sub">${s.baseAsset} / ${s.quoteAsset}</div>
          </div>
          <div class="sym-col-right">
            <div class="sym-price">${formattedPrice}</div>
            <div class="sym-stats">
              <span class="sym-chg" style="color: ${changeColor};">${changeSign}${s.changePct.toFixed(2)}%</span>
              <span class="sym-vol" title="24h USDT Volume">Vol: ${formattedVol}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    el.symbolListContainer.innerHTML = html;

    // Attach click events
    const rows = el.symbolListContainer.querySelectorAll('.symbol-row-item');
    rows.forEach(r => {
      r.addEventListener('click', async () => {
        const sym = r.getAttribute('data-symbol');
        if (sym && sym !== state.settings.symbol) {
          state.settings.symbol = sym;
          updateActiveSymbolHeader();
          await saveCurrentSettings();
          closeSymbolPickerModal();
          await loadSymbolData(state.settings.symbol, state.settings.timeframe, state.settings.candleLimit);
        } else {
          closeSymbolPickerModal();
        }
      });
    });
  }

  function formatVolume(num) {
    if (!num || isNaN(num)) return '$0';
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  }

  function formatPrice(num, precision = 2) {
    if (num === 0 || isNaN(num)) return '--';
    if (num < 0.0001) return num.toFixed(7);
    if (num < 0.01) return num.toFixed(6);
    if (num < 1) return num.toFixed(4);
    if (num < 10) return num.toFixed(3);
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: precision || 2 });
  }

  function openSymbolPickerModal() {
    if (!el.symbolModal) return;
    el.symbolModal.style.display = 'flex';
    if (el.symbolSearchInput) {
      el.symbolSearchInput.value = '';
      state.searchQuery = '';
      filterAndRenderSymbolsList();
      setTimeout(() => el.symbolSearchInput.focus(), 50);
    }
  }

  function closeSymbolPickerModal() {
    if (el.symbolModal) el.symbolModal.style.display = 'none';
  }

  // --- 5. Chart Setup (Lightweight Charts) ---
  function initChart() {
    state.chart = LightweightCharts.createChart(el.chartContainer, {
      width: el.chartContainer.clientWidth,
      height: el.chartContainer.clientHeight,
      layout: {
        background: { type: 'solid', color: '#090d16' },
        textColor: '#94a3b8',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.45)', style: 1 },
        horzLines: { color: 'rgba(30, 41, 59, 0.45)', style: 1 }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#38bdf8', width: 1, style: 3, labelBackgroundColor: '#0284c7' },
        horzLine: { color: '#38bdf8', width: 1, style: 3, labelBackgroundColor: '#0284c7' }
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        scaleMargins: { top: 0.08, bottom: 0.18 }
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        minBarSpacing: 1.5
      }
    });

    // Main Candlestick Series
    state.candleSeries = state.chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderUpColor: '#10b981',
      borderDownColor: '#f43f5e',
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e'
    });

    // Volume Histogram Pane
    state.volumeSeries = state.chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume_pane',
      scaleMargins: { top: 0.82, bottom: 0 }
    });
    state.chart.priceScale('volume_pane').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 }
    });

    // Canvas overlay initialization
    state.ctx = el.overlayCanvas.getContext('2d');
    resizeCanvas();

    const resizeObserver = new ResizeObserver(() => {
      if (state.chart && el.chartContainer) {
        const w = el.chartContainer.clientWidth;
        const h = el.chartContainer.clientHeight;
        state.chart.resize(w, h);
        resizeCanvas();
        scheduleOverlayRender();
      }
    });
    resizeObserver.observe(el.chartContainer);

    state.chart.timeScale().subscribeVisibleLogicalRangeChange(() => renderOverlay());
    state.chart.timeScale().subscribeVisibleTimeRangeChange(() => renderOverlay());
    state.chart.subscribeCrosshairMove(onCrosshairMove);

    // Sync canvas overlay on priceScale drag & zoom interactions in real-time
    el.chartContainer.addEventListener('mousedown', () => {
      const onMove = () => renderOverlay();
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        renderOverlay();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    el.chartContainer.addEventListener('wheel', () => renderOverlay(), { passive: true });

    // Initialize TradingView-Style Drawing Tools Engine
    if (typeof DrawToolsEngine !== 'undefined') {
      DrawToolsEngine.init(
        state.chart,
        state.candleSeries,
        el.overlayCanvas,
        el.chartContainer,
        async (drawings) => {
          await DB.saveDrawings(state.settings.symbol, drawings);
          scheduleOverlayRender();
        },
        (activeTool) => {
          updateDrawToolbarUI(activeTool);
        },
        () => scheduleOverlayRender()
      );
    }

    // Initialize TradingView-Style Bar Replay Engine
    if (typeof ReplayEngine !== 'undefined') {
      ReplayEngine.init(
        state.chart,
        state.candleSeries,
        state.volumeSeries,
        el.overlayCanvas,
        el.chartContainer,
        (slicedCandles, cutoffIndex, isLastBar) => {
          state.candles = slicedCandles;
          state.volume = slicedCandles.map(c => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)'
          }));
          recalculateAllIndicators();
          renderChartData();
          if (slicedCandles.length > 0) {
            updateHUD(slicedCandles[slicedCandles.length - 1]);
          }
        },
        () => {
          // Exit Replay: restore full dataset
          if (state.fullCandles && state.fullCandles.length > 0) {
            state.candles = state.fullCandles;
            state.volume = state.fullCandles.map(c => ({
              time: c.time,
              value: c.volume,
              color: c.close >= c.open ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)'
            }));
            recalculateAllIndicators();
            renderChartData();
            if (state.candles.length > 0) {
              updateHUD(state.candles[state.candles.length - 1]);
            }
          }
        },
        () => scheduleOverlayRender()
      );
    }
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
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let lastAppliedPrecisionKey = null;
  function applyPricePrecision(symbol, candles) {
    let precision = 2;
    const symObj = state.allSymbols.find(s => s.symbol === symbol);
    if (symObj && typeof symObj.pricePrecision === 'number' && symObj.pricePrecision > 0) {
      precision = symObj.pricePrecision;
    } else if (candles && candles.length > 0) {
      let maxDec = 2;
      const sample = candles.slice(-50);
      for (let i = 0; i < sample.length; i++) {
        const s = sample[i].close.toString();
        if (s.includes('.')) {
          const d = s.split('.')[1].length;
          if (d > maxDec) maxDec = d;
        }
      }
      precision = Math.min(Math.max(maxDec, 2), 8);
    }

    state.pricePrecision = precision;
    const key = `${symbol}_${precision}`;
    if (lastAppliedPrecisionKey === key) return;
    lastAppliedPrecisionKey = key;

    const minMove = parseFloat(Math.pow(10, -precision).toFixed(precision));

    state.candleSeries.applyOptions({
      priceFormat: { type: 'price', precision: precision, minMove: minMove }
    });
    if (state.ema1Series) {
      state.ema1Series.applyOptions({
        priceFormat: { type: 'price', precision: precision, minMove: minMove }
      });
    }
    if (state.ema2Series) {
      state.ema2Series.applyOptions({
        priceFormat: { type: 'price', precision: precision, minMove: minMove }
      });
    }
    if (state.ema3Series) {
      state.ema3Series.applyOptions({
        priceFormat: { type: 'price', precision: precision, minMove: minMove }
      });
    }
    if (state.vwapSeries) {
      state.vwapSeries.applyOptions({
        priceFormat: { type: 'price', precision: precision, minMove: minMove }
      });
    }

    state.chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.08, bottom: 0.20 },
      alignLabels: true,
      borderColor: '#1e293b'
    });
  }

  // --- 6. Binance Futures Fetcher + IndexedDB Smart Caching ---
  async function loadSymbolData(symbol, timeframe, limit, forceFresh = false) {
    if (state.isLoading) return;
    state.isLoading = true;
    showLoader(true, `Loading ${symbol} (${timeframe})...`, 'Checking IndexedDB cache');

    try {
      let cachedCandles = null;
      if (!forceFresh) {
        cachedCandles = await DB.getCandles(symbol, timeframe);
      }

      let allCandles = [];
      let newFetchedCount = 0;

      let isInitialLoad = !state.candles || state.candles.length === 0;

      if (cachedCandles && cachedCandles.length > 0) {
        // Fast Instant Render from cache!
        state.cacheInfo = { count: cachedCandles.length, fromDb: true, newFetched: 0 };
        allCandles = cachedCandles;
        updateCacheBadge(true, allCandles.length, 0);

        state.fullCandles = allCandles;
        state.candles = allCandles;
        state.volume = allCandles.map(c => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)'
        }));

        if (typeof DrawToolsEngine !== 'undefined') {
          DrawToolsEngine.setCandles(state.candles);
          const savedDrawings = await DB.getDrawings(symbol);
          DrawToolsEngine.setDrawings(savedDrawings || []);
        }

        recalculateAllIndicators();
        renderChartData(isInitialLoad);

        // Fetch only missing recent delta candles from Binance quietly without blocking screen
        const lastTimeMs = cachedCandles[cachedCandles.length - 1].time * 1000;
        const nowMs = Date.now();
        const tfSec = timeframeToSeconds(timeframe);

        if (nowMs - lastTimeMs > tfSec * 1000) {
          try {
            const deltaKlines = await fetchBinanceKlines(symbol, timeframe, 1500, lastTimeMs + 1, null);
            if (deltaKlines.length > 0) {
              newFetchedCount = deltaKlines.length;
              const deltaCandles = deltaKlines.map(formatKline);

              // Merge & Deduplicate
              const candleMap = new Map();
              allCandles.forEach(c => candleMap.set(c.time, c));
              deltaCandles.forEach(c => candleMap.set(c.time, c));

              allCandles = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
              if (allCandles.length > limit) {
                allCandles = allCandles.slice(-limit);
              }

              state.fullCandles = allCandles;
              state.candles = allCandles;
              state.volume = allCandles.map(c => ({
                time: c.time,
                value: c.volume,
                color: c.close >= c.open ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)'
              }));

              await DB.saveCandles(symbol, timeframe, allCandles);
              updateCacheBadge(true, allCandles.length, newFetchedCount);

              recalculateAllIndicators();
              renderChartData(false); // Seamlessly update data without resetting viewport
            }
          } catch (deltaErr) {
            console.warn('Delta sync error:', deltaErr);
          }
        }
      } else {
        // Full Fetch from Binance Futures (chunked by 1500)
        showLoader(true, `Downloading ${limit} bars of ${symbol} (${timeframe})...`, 'Connecting to Binance Futures REST API');
        allCandles = await fetchFullBinanceHistory(symbol, timeframe, limit);

        if (allCandles.length > 0) {
          await DB.saveCandles(symbol, timeframe, allCandles);
        }

        state.fullCandles = allCandles;
        state.candles = allCandles;
        state.volume = allCandles.map(c => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)'
        }));

        if (typeof ReplayEngine !== 'undefined' && ReplayEngine.inReplay) {
          ReplayEngine.exitReplay();
        }

        updateCacheBadge(true, allCandles.length, newFetchedCount);

        if (typeof DrawToolsEngine !== 'undefined') {
          DrawToolsEngine.setCandles(state.candles);
          const savedDrawings = await DB.getDrawings(symbol);
          DrawToolsEngine.setDrawings(savedDrawings || []);
        }

        recalculateAllIndicators();
        renderChartData(true);
      }

    } catch (err) {
      console.error('Error loading symbol data:', err);
      updateCacheBadge(false, 0, 0, err.message);
    } finally {
      state.isLoading = false;
      showLoader(false);
    }
  }

  async function fetchFullBinanceHistory(symbol, timeframe, totalNeeded) {
    const limitPerReq = 1500;
    let allKlines = [];
    let endTime = null;

    while (allKlines.length < totalNeeded) {
      const count = Math.min(limitPerReq, totalNeeded - allKlines.length);
      const klines = await fetchBinanceKlines(symbol, timeframe, count, null, endTime);
      if (!klines || klines.length === 0) break;

      allKlines = klines.concat(allKlines);
      endTime = klines[0][0] - 1;

      showLoader(true, `Downloading ${symbol} (${timeframe})...`, `Loaded ${allKlines.length} / ${totalNeeded} bars`);
      if (klines.length < count) break;
      await new Promise(r => setTimeout(r, 60));
    }

    const candleMap = new Map();
    allKlines.forEach(k => {
      const c = formatKline(k);
      candleMap.set(c.time, c);
    });

    const sorted = Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
    return sorted.slice(-totalNeeded);
  }

  async function fetchBinanceKlines(symbol, interval, limit, startTime, endTime) {
    let url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API HTTP ${res.status}`);
    return await res.json();
  }

  function formatKline(k) {
    return {
      time: Math.floor(k[0] / 1000), // seconds
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    };
  }

  function timeframeToSeconds(tf) {
    const unit = tf.slice(-1);
    const num = parseInt(tf, 10);
    if (unit === 'm') return num * 60;
    if (unit === 'h') return num * 3600;
    if (unit === 'd') return num * 86400;
    if (unit === 'w') return num * 604800;
    return 900;
  }

  // --- 7. Modular Pure JavaScript Indicator Calculations (IndicatorRegistry) ---
  function createIndicatorInstance(type) {
    if (typeof IndicatorRegistry !== 'undefined') {
      return IndicatorRegistry.createInstance(type);
    }
    throw new Error('IndicatorRegistry is not loaded');
  }

  function recalculateAllIndicators() {
    if (!state.candles || state.candles.length === 0) return;
    const t0 = performance.now();
    const candles = state.candles;

    if (!state.settings.indicatorInstances || !Array.isArray(state.settings.indicatorInstances)) {
      state.settings.indicatorInstances = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.indicatorInstances));
    }

    for (const inst of state.settings.indicatorInstances) {
      if (!inst.inputs) {
        const fresh = IndicatorRegistry.createInstance(inst.type);
        inst.inputs = fresh.inputs;
        inst.style = fresh.style;
      }
      const def = IndicatorRegistry.get(inst.type);
      if (def && typeof def.calculate === 'function') {
        inst.calcResult = def.calculate(candles, inst.inputs);
      }
    }

    const calcTime = (performance.now() - t0).toFixed(1);
    console.log(`[IndicatorRegistry] Calculated ${state.settings.indicatorInstances.length} indicator instances on ${candles.length} bars in ${calcTime}ms`);
  }

  // --- 8. Render Chart Data, Dynamic Series & Legend ---
  function syncChartSeriesWithInstances() {
    if (!state.chart) return;
    const currentInstanceIds = new Set(state.settings.indicatorInstances.map(i => i.id));

    // 1. Remove orphaned series from map
    for (const [id, seriesList] of state.indicatorSeriesMap.entries()) {
      if (!currentInstanceIds.has(id)) {
        for (const s of seriesList) {
          try { state.chart.removeSeries(s); } catch (e) {}
        }
        state.indicatorSeriesMap.delete(id);
      }
    }

    // 2. Ensure each active series indicator has its Lightweight Charts series initialized
    for (const inst of state.settings.indicatorInstances) {
      const def = IndicatorRegistry.get(inst.type);
      if (def && def.isSeries) {
        let seriesList = state.indicatorSeriesMap.get(inst.id) || [];
        if (seriesList.length === 0 && typeof def.syncSeries === 'function') {
          seriesList = def.syncSeries(state.chart, inst, seriesList);
          state.indicatorSeriesMap.set(inst.id, seriesList);
        }
      }
    }
  }

  function renderChartData(resetViewport = false) {
    applyPricePrecision(state.settings.symbol, state.candles);

    const timeScale = state.chart ? state.chart.timeScale() : null;
    const prevRange = (resetViewport || !timeScale) ? null : timeScale.getVisibleLogicalRange();

    state.candleSeries.setData(state.candles);
    state.volumeSeries.setData(state.volume);

    syncChartSeriesWithInstances();

    // Update series data for each instance
    for (const inst of state.settings.indicatorInstances) {
      const def = IndicatorRegistry.get(inst.type);
      if (def && def.isSeries) {
        const seriesList = state.indicatorSeriesMap.get(inst.id);
        if (seriesList && typeof def.updateSeries === 'function') {
          def.updateSeries(seriesList, inst.calcResult, inst.style, inst.visible);
        }
      }
    }

    if (state.candles.length > 0 && timeScale) {
      const total = state.candles.length;
      if (resetViewport || !prevRange) {
        timeScale.setVisibleLogicalRange({
          from: Math.max(0, total - 250),
          to: total + 10
        });
      } else {
        // Silky smooth preservation of user's active zoom and pan
        timeScale.setVisibleLogicalRange(prevRange);
      }
      updateHUD(state.candles[total - 1]);
    }

    renderChartLegend();
    scheduleOverlayRender();
  }

  // --- 8.1 TradingView-Style fx Indicators Catalog & Legend ---
  function openIndicatorsCatalogModal() {
    renderIndicatorsCatalog();
    if (el.indicatorsCatalogModal) el.indicatorsCatalogModal.style.display = 'flex';
    if (el.catalogSearchInput) {
      el.catalogSearchInput.value = '';
      el.catalogSearchInput.focus();
    }
  }

  function closeIndicatorsCatalogModal() {
    if (el.indicatorsCatalogModal) el.indicatorsCatalogModal.style.display = 'none';
  }

  function renderIndicatorsCatalog() {
    if (!el.catalogListContainer) return;
    const q = (el.catalogSearchInput ? el.catalogSearchInput.value : '').trim().toLowerCase();

    const allDefs = IndicatorRegistry.getAll();
    let filtered = allDefs;
    if (q) {
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(q) ||
        (item.tag && item.tag.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q)) ||
        (item.desc && item.desc.toLowerCase().includes(q))
      );
    }

    let html = '';
    for (const item of filtered) {
      html += `
        <div class="catalog-item" data-type="${item.id}">
          <div class="catalog-item-info">
            <div class="catalog-item-title">
              <span style="color: ${item.color || '#38bdf8'}; font-size: 14px;">●</span>
              <span>${item.name}</span>
              <span class="catalog-tag">${item.tag || ''}</span>
            </div>
            <div class="catalog-item-desc">${item.desc || ''}</div>
          </div>
          <button class="btn-add-ind" data-type="${item.id}">
            <span>+ Add</span>
          </button>
        </div>
      `;
    }

    if (filtered.length === 0) {
      html = `<div style="text-align: center; color: #64748b; padding: 24px; font-size: 13px;">No indicators found matching "${q}"</div>`;
    }

    el.catalogListContainer.innerHTML = html;

    // Attach click events: each click adds a new instance!
    el.catalogListContainer.querySelectorAll('.catalog-item').forEach(itemEl => {
      itemEl.addEventListener('click', () => {
        const type = itemEl.getAttribute('data-type');
        addIndicatorFromCatalog(type);
      });
    });
  }

  function addIndicatorFromCatalog(type) {
    const newInst = createIndicatorInstance(type);
    state.settings.indicatorInstances.push(newInst);
    saveCurrentSettings();
    recalculateAllIndicators();
    renderChartData();
    closeIndicatorsCatalogModal();
  }

  function removeIndicatorInstance(id) {
    const idx = state.settings.indicatorInstances.findIndex(i => i.id === id);
    if (idx === -1) return;
    state.settings.indicatorInstances.splice(idx, 1);
    saveCurrentSettings();
    recalculateAllIndicators();
    renderChartData();
  }

  function toggleIndicatorVisibility(id) {
    const inst = state.settings.indicatorInstances.find(i => i.id === id);
    if (!inst) return;
    inst.visible = !inst.visible;
    saveCurrentSettings();
    renderChartData();
  }

  // TradingView-Style On-Chart Indicator Legend (Shows Only Clean Name & Controls)
  function renderChartLegend() {
    if (!el.chartLegend) return;
    const instances = state.settings.indicatorInstances || [];

    let html = '';
    for (const inst of instances) {
      const def = IndicatorRegistry.get(inst.type);
      const color = def ? def.color : '#38bdf8';
      html += `
        <div class="legend-row ${inst.visible ? '' : 'inactive'}" data-instance-id="${inst.id}">
          <span class="legend-dot" style="background: ${color};"></span>
          <span class="legend-title">${inst.name}</span>
          <div class="legend-actions">
            <button class="legend-btn btn-legend-eye" data-instance-id="${inst.id}" title="${inst.visible ? 'Hide Indicator' : 'Show Indicator'}">${inst.visible ? '👁️' : '👁️‍🗨️'}</button>
            <button class="legend-btn btn-legend-gear" data-instance-id="${inst.id}" title="Settings">⚙️</button>
            <button class="legend-btn btn-remove" data-instance-id="${inst.id}" title="Remove from Chart">✕</button>
          </div>
        </div>
      `;
    }
    el.chartLegend.innerHTML = html;

    // Attach click handlers to on-chart legend action buttons
    el.chartLegend.querySelectorAll('.btn-legend-eye').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-instance-id');
        toggleIndicatorVisibility(id);
      });
    });

    el.chartLegend.querySelectorAll('.btn-legend-gear').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-instance-id');
        openIndicatorSettingsModal(id);
      });
    });

    el.chartLegend.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-instance-id');
        removeIndicatorInstance(id);
      });
    });

    el.chartLegend.querySelectorAll('.legend-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.legend-actions')) return;
        const id = row.getAttribute('data-instance-id');
        openIndicatorSettingsModal(id);
      });
    });
  }

  // --- 8.2 Universal TradingView Indicator Settings Modal Logic ---
  function openIndicatorSettingsModal(instanceId) {
    const inst = state.settings.indicatorInstances.find(i => i.id === instanceId);
    if (!inst) return;
    state.editingInstanceId = instanceId;

    const modalTitleEl = document.getElementById('indModalTitle');
    if (modalTitleEl) modalTitleEl.innerText = `${inst.name} Settings`;

    if (el.indicatorSettingsModalBody) {
      IndicatorRegistry.renderModalContent(inst, el.indicatorSettingsModalBody, 'inputs');
    }

    if (el.indicatorSettingsModal) el.indicatorSettingsModal.style.display = 'flex';
  }

  function closeIndicatorSettingsModal() {
    if (el.indicatorSettingsModal) el.indicatorSettingsModal.style.display = 'none';
  }

  function applyIndicatorSettingsFromModal() {
    if (!state.editingInstanceId) return;
    const inst = state.settings.indicatorInstances.find(i => i.id === state.editingInstanceId);
    if (!inst) return;

    if (el.indicatorSettingsModalBody) {
      IndicatorRegistry.readValuesFromModal(inst, el.indicatorSettingsModalBody);
    }

    saveCurrentSettings();
    recalculateAllIndicators();
    renderChartData();
    renderChartLegend();
    closeIndicatorSettingsModal();
  }

  function resetIndicatorSettingsToDefaults() {
    if (!state.editingInstanceId) return;
    const inst = state.settings.indicatorInstances.find(i => i.id === state.editingInstanceId);
    if (!inst) return;

    const fresh = IndicatorRegistry.createInstance(inst.type);
    inst.inputs = fresh.inputs;
    inst.style = fresh.style;

    if (el.indicatorSettingsModalBody) {
      IndicatorRegistry.renderModalContent(inst, el.indicatorSettingsModalBody, 'inputs');
    }
  }

  // --- 9. High-DPI Canvas Overlay Rendering ---
  function scheduleOverlayRender() {
    if (!state.renderScheduled) {
      state.renderScheduled = true;
      requestAnimationFrame(() => {
        renderOverlay();
        state.renderScheduled = false;
      });
    }
  }

  function renderOverlay() {
    if (!state.chart || !state.candleSeries || !state.ctx) return;

    const w = el.chartContainer.clientWidth;
    const h = el.chartContainer.clientHeight;
    state.ctx.clearRect(0, 0, w, h);

    const timeScale = state.chart.timeScale();
    const visibleRange = timeScale.getVisibleRange();
    if (!visibleRange) return;

    const fromTime = visibleRange.from;
    const toTime = visibleRange.to;
    const rightViewportX = w - 65;

    const getX = (t) => {
      if (t === null || t === undefined) return null;
      const direct = timeScale.timeToCoordinate(t);
      if (direct !== null && !isNaN(direct)) return direct;

      if (state.candles && state.candles.length > 1) {
        const firstCandle = state.candles[0];
        const lastCandle = state.candles[state.candles.length - 1];
        const firstX = timeScale.timeToCoordinate(firstCandle.time);
        const lastX = timeScale.timeToCoordinate(lastCandle.time);
        if (firstX !== null && lastX !== null && lastCandle.time !== firstCandle.time) {
          const pxPerSec = (lastX - firstX) / (lastCandle.time - firstCandle.time);
          return firstX + (t - firstCandle.time) * pxPerSec;
        }
      }
      return null;
    };
    const getY = (p) => (p !== null && p !== undefined && !isNaN(p)) ? state.candleSeries.priceToCoordinate(p) : null;

    const instances = state.settings.indicatorInstances || [];

    for (const inst of instances) {
      if (!inst.visible || !inst.calcResult) continue;
      const def = IndicatorRegistry.get(inst.type);
      if (def && typeof def.renderCanvas === 'function') {
        def.renderCanvas(state.ctx, inst.calcResult, inst.style, {
          getX,
          getY,
          fromTime,
          toTime,
          rightViewportX,
          candles: state.candles,
          formatPrice
        });
      }
    }

    // Render user drawings (Trendline, Rectangle, Long/Short Position)
    if (typeof DrawToolsEngine !== 'undefined') {
      DrawToolsEngine.setCandles(state.candles);
      DrawToolsEngine.render(state.ctx, { getX, getY, formatPrice });
    }

    // Render Bar Replay guide line & scissors badge
    if (typeof ReplayEngine !== 'undefined') {
      ReplayEngine.render(state.ctx, { getX, getY });
    }
  }


  // --- Color Helper ---
  function hexToRgba(hex, alpha = 0.2) {
    if (!hex) return `rgba(56, 189, 248, ${alpha})`;
    if (typeof hex === 'string' && hex.startsWith('rgba')) return hex;
    let c = String(hex).replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return `rgba(56, 189, 248, ${alpha})`;
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  // --- Trade Decision & Forensics Modal ---
  function openTradeDecisionModal(card) {
    if (!card || !el.tradeDecisionModal) return;

    const pEntry = formatPrice(card.entryPrice);
    const pTp1   = formatPrice(card.tp1Price);
    const pTp2   = formatPrice(card.tp2Price);
    const pSl    = formatPrice(card.slPrice);

    const isLong = card.tradeDir === 'BUY';
    const badgeCol = card.signalType.startsWith('FADE') ? (isLong ? '#06b6d4' : '#f59e0b') : (isLong ? '#10b981' : '#f43f5e');
    const badgeTitle = card.signalType === 'FADE_SHORT' ? '⚡ FADE SHORT' : (card.signalType === 'FADE_LONG' ? '⚡ FADE LONG' : (isLong ? '▲ BUY TREND' : '▼ SELL TREND'));

    if (el.tdModalBadge) {
      el.tdModalBadge.textContent = badgeTitle;
      el.tdModalBadge.style.background = hexToRgba(badgeCol, 0.25);
      el.tdModalBadge.style.color = badgeCol;
      el.tdModalBadge.style.border = `1px solid ${badgeCol}`;
    }
    if (el.tdModalSymbol) {
      el.tdModalSymbol.textContent = `${state.settings.symbol} • ${state.settings.timeframe}`;
    }

    if (el.tradeDecisionModalBody) {
      el.tradeDecisionModalBody.innerHTML = `
        <!-- Price Overview Grid -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; background: #1e293b; padding: 12px; border-radius: 8px; text-align: center; font-family: 'JetBrains Mono', monospace;">
          <div>
            <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase;">Entry</div>
            <div style="color: #f8fafc; font-weight: 700; font-size: 13px; margin-top: 2px;">${pEntry}</div>
          </div>
          <div>
            <div style="color: #10b981; font-size: 10px; text-transform: uppercase;">TP1 (50%)</div>
            <div style="color: #10b981; font-weight: 700; font-size: 13px; margin-top: 2px;">${pTp1}</div>
            <div style="font-size: 10px; color: #10b981; font-weight: 600;">+${card.tp1Pct.toFixed(1)}%</div>
          </div>
          <div>
            <div style="color: #38bdf8; font-size: 10px; text-transform: uppercase;">TP2 (50%)</div>
            <div style="color: #38bdf8; font-weight: 700; font-size: 13px; margin-top: 2px;">${pTp2}</div>
            <div style="font-size: 10px; color: #38bdf8; font-weight: 600;">+${card.tp2Pct.toFixed(1)}%</div>
          </div>
          <div>
            <div style="color: #f43f5e; font-size: 10px; text-transform: uppercase;">Stop-Loss</div>
            <div style="color: #f43f5e; font-weight: 700; font-size: 13px; margin-top: 2px;">${pSl}</div>
            <div style="font-size: 10px; color: #f43f5e; font-weight: 600;">-${card.slPct.toFixed(1)}%</div>
          </div>
        </div>

        <!-- Section 1: Side & Entry Rationale -->
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; padding: 14px; border-radius: 8px;">
          <div style="font-weight: 700; color: #38bdf8; margin-bottom: 6px; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
            <span>1️⃣ Tại sao chọn Side ${card.tradeDir} & Mốc Entry?</span>
          </div>
          <p style="margin-bottom: 8px; color: #e2e8f0;">${card.sideRationale}</p>
          <div style="background: rgba(15, 23, 42, 0.8); padding: 8px 12px; border-radius: 6px; font-size: 12px; color: #94a3b8;">
            <strong style="color: #f8fafc;">📌 Mức Giá Entry (${pEntry}):</strong> ${card.entryRationale}
          </div>
        </div>

        <!-- Section 2: TP1 & TP2 Rationale -->
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; padding: 14px; border-radius: 8px;">
          <div style="font-weight: 700; color: #10b981; margin-bottom: 6px; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
            <span>2️⃣ Tại sao chốt lời tại TP1 (${pTp1}) & TP2 (${pTp2})?</span>
          </div>
          <p style="margin-bottom: 8px; color: #e2e8f0;"><strong style="color: #10b981;">🎯 Mốc TP1 (Opposing FVG Target):</strong> ${card.tp1Rationale}</p>
          <p style="color: #e2e8f0;"><strong style="color: #38bdf8;">🏆 Mốc TP2 (Opposing Liquidity Pool):</strong> ${card.tp2Rationale}</p>
        </div>

        <!-- Section 3: Stop-Loss Rationale -->
        <div style="background: rgba(30, 41, 59, 0.6); border: 1px solid #334155; padding: 14px; border-radius: 8px;">
          <div style="font-weight: 700; color: #f43f5e; margin-bottom: 6px; font-size: 13.5px; display: flex; align-items: center; gap: 6px;">
            <span>3️⃣ Tại sao đặt Stop-Loss tại ${pSl}? (Kiểm Soát Rủi Ro)</span>
          </div>
          <p style="color: #e2e8f0;">${card.slRationale}</p>
        </div>

        <!-- Section 4: Quantitative Metrics & Risk -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px;">
          <div style="background: #1e293b; padding: 10px; border-radius: 6px;">
            <div style="color: #94a3b8;">Tỷ Lệ Risk / Reward (R:R)</div>
            <div style="font-size: 14px; font-weight: 700; color: #f8fafc; margin-top: 2px;">1 : ${card.rrRatio.toFixed(2)}</div>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 6px;">
            <div style="color: #94a3b8;">Động cơ Biến động ATR</div>
            <div style="font-size: 14px; font-weight: 700; color: #38bdf8; margin-top: 2px;">${card.atrPct.toFixed(2)}%</div>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 6px;">
            <div style="color: #94a3b8;">Thời điểm Tín hiệu</div>
            <div style="font-size: 12px; font-weight: 600; color: #f8fafc; margin-top: 2px;">${card.datetimeStr}</div>
          </div>
          <div style="background: #1e293b; padding: 10px; border-radius: 6px;">
            <div style="color: #94a3b8;">Trạng Thái Lệnh</div>
            <div style="font-size: 12px; font-weight: 700; color: ${card.statusColor}; margin-top: 2px;">${card.statusBadge}</div>
          </div>
        </div>
      `;
    }

    el.tradeDecisionModal.style.display = 'flex';
  }

  function closeTradeDecisionModal() {
    if (el.tradeDecisionModal) el.tradeDecisionModal.style.display = 'none';
  }


  // --- 10. UI Interactions & Event Listeners ---
  function setupEventListeners() {
    // Bar Replay Trigger
    if (el.btnOpenReplay) {
      el.btnOpenReplay.addEventListener('click', () => {
        if (typeof ReplayEngine !== 'undefined') {
          if (ReplayEngine.inReplay) {
            ReplayEngine.exitReplay();
          } else if (state.candles && state.candles.length > 20) {
            state.fullCandles = [...state.candles];
            ReplayEngine.startReplay(state.fullCandles);
          }
        }
      });
    }

    // Drawing Toolbar Events
    if (el.drawBtns) {
      el.drawBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const tool = btn.getAttribute('data-tool');
          if (typeof DrawToolsEngine !== 'undefined') {
            DrawToolsEngine.setTool(tool);
          }
        });
      });
    }
    if (el.btnDeleteDrawing) {
      el.btnDeleteDrawing.addEventListener('click', () => {
        if (typeof DrawToolsEngine !== 'undefined') {
          DrawToolsEngine.deleteSelected();
        }
      });
    }
    if (el.btnClearAllDrawings) {
      el.btnClearAllDrawings.addEventListener('click', () => {
        if (confirm('Clear all drawings on this chart?')) {
          if (typeof DrawToolsEngine !== 'undefined') {
            DrawToolsEngine.clearAll();
          }
        }
      });
    }

    // Open Symbol Picker Modal
    if (el.btnOpenSymbolPicker) {
      el.btnOpenSymbolPicker.addEventListener('click', openSymbolPickerModal);
    }
    if (el.btnCloseSymbolModal) {
      el.btnCloseSymbolModal.addEventListener('click', closeSymbolPickerModal);
    }
    if (el.symbolModal) {
      el.symbolModal.addEventListener('click', (e) => {
        if (e.target === el.symbolModal) closeSymbolPickerModal();
      });
    }

    // Search input
    if (el.symbolSearchInput) {
      el.symbolSearchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        filterAndRenderSymbolsList();
      });
      el.symbolSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSymbolPickerModal();
        if (e.key === 'Enter' && state.filteredSymbols.length > 0) {
          const first = state.filteredSymbols[0];
          state.settings.symbol = first.symbol;
          updateActiveSymbolHeader();
          saveCurrentSettings();
          closeSymbolPickerModal();
          loadSymbolData(state.settings.symbol, state.settings.timeframe, state.settings.candleLimit);
        }
      });
    }

    // Filter Tabs
    setupFilterTab(el.tabFilterAll, 'ALL');
    setupFilterTab(el.tabFilterTop, 'TOP');
    setupFilterTab(el.tabFilterGainers, 'GAINERS');
    setupFilterTab(el.tabFilterLosers, 'LOSERS');

    // Sort buttons
    setupSortButton(el.sortVolumeBtn, 'volume');
    setupSortButton(el.sortChangeBtn, 'changePct');
    setupSortButton(el.sortPriceBtn, 'lastPrice');
    setupSortButton(el.sortNameBtn, 'symbol');

    // Timeframe & Limit Selectors
    el.timeframeSelect.addEventListener('change', async (e) => {
      state.settings.timeframe = e.target.value;
      await saveCurrentSettings();
      await loadSymbolData(state.settings.symbol, state.settings.timeframe, state.settings.candleLimit);
    });

    el.limitSelect.addEventListener('change', async (e) => {
      state.settings.candleLimit = parseInt(e.target.value, 10);
      await saveCurrentSettings();
      await loadSymbolData(state.settings.symbol, state.settings.timeframe, state.settings.candleLimit, true);
    });

    // Force Reload from Binance
    el.btnReload.addEventListener('click', async () => {
      await loadSymbolData(state.settings.symbol, state.settings.timeframe, state.settings.candleLimit, true);
    });

    // Clear IndexedDB Cache
    el.btnClearCache.addEventListener('click', async () => {
      if (confirm('Clear all cached candles in IndexedDB?')) {
        await DB.clearCandles();
        updateCacheBadge(false, 0, 0, 'Cache Cleared');
        await loadSymbolData(state.settings.symbol, state.settings.timeframe, state.settings.candleLimit, true);
      }
    });

    // Indicators Catalog Modal (TradingView fx Button)
    if (el.btnOpenIndicatorsCatalog) {
      el.btnOpenIndicatorsCatalog.addEventListener('click', openIndicatorsCatalogModal);
    }
    if (el.btnCloseCatalogModal) {
      el.btnCloseCatalogModal.addEventListener('click', closeIndicatorsCatalogModal);
    }
    if (el.indicatorsCatalogModal) {
      el.indicatorsCatalogModal.addEventListener('click', (e) => {
        if (e.target === el.indicatorsCatalogModal) closeIndicatorsCatalogModal();
      });
    }
    if (el.catalogSearchInput) {
      el.catalogSearchInput.addEventListener('input', renderIndicatorsCatalog);
    }

    // Indicator Settings Modal Events
    if (el.btnCloseIndSettingsModal) {
      el.btnCloseIndSettingsModal.addEventListener('click', closeIndicatorSettingsModal);
    }
    if (el.btnCancelIndSettings) {
      el.btnCancelIndSettings.addEventListener('click', closeIndicatorSettingsModal);
    }
    if (el.btnApplyIndSettings) {
      el.btnApplyIndSettings.addEventListener('click', applyIndicatorSettingsFromModal);
    }
    if (el.btnResetIndSettings) {
      el.btnResetIndSettings.addEventListener('click', resetIndicatorSettingsToDefaults);
    }
    if (el.indicatorSettingsModal) {
      el.indicatorSettingsModal.addEventListener('click', (e) => {
        if (e.target === el.indicatorSettingsModal) closeIndicatorSettingsModal();
      });
    }

    // Trade Decision Modal Events
    if (el.btnCloseTradeDecisionModal) {
      el.btnCloseTradeDecisionModal.addEventListener('click', closeTradeDecisionModal);
    }
    if (el.btnOkTradeDecisionModal) {
      el.btnOkTradeDecisionModal.addEventListener('click', closeTradeDecisionModal);
    }
    if (el.tradeDecisionModal) {
      el.tradeDecisionModal.addEventListener('click', (e) => {
        if (e.target === el.tradeDecisionModal) closeTradeDecisionModal();
      });
    }

    // Chart Canvas Card Click & Hover Detection
    if (el.chartContainer) {
      el.chartContainer.addEventListener('click', (e) => {
        if (typeof IndicatorRegistry !== 'undefined') {
          const stat2BoxDef = IndicatorRegistry.get('stat2_box_strategy');
          if (stat2BoxDef && typeof stat2BoxDef.findCardAt === 'function' && el.overlayCanvas) {
            const rect = el.overlayCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const clickedCard = stat2BoxDef.findCardAt(mouseX, mouseY);
            if (clickedCard) {
              openTradeDecisionModal(clickedCard);
            }
          }
        }
      });

      el.chartContainer.addEventListener('mousemove', (e) => {
        if (typeof IndicatorRegistry !== 'undefined') {
          const stat2BoxDef = IndicatorRegistry.get('stat2_box_strategy');
          if (stat2BoxDef && typeof stat2BoxDef.findCardAt === 'function' && el.overlayCanvas) {
            const rect = el.overlayCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const hoveredCard = stat2BoxDef.findCardAt(mouseX, mouseY);
            if (hoveredCard) {
              el.chartContainer.style.cursor = 'pointer';
            } else if (typeof DrawToolsEngine !== 'undefined' && DrawToolsEngine.activeTool === 'cursor') {
              el.chartContainer.style.cursor = 'crosshair';
            }
          }
        }
      });
    }
  }

  function updateDrawToolbarUI(activeTool) {
    if (!el.drawBtns) return;
    el.drawBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tool') === activeTool);
    });
  }

  function setupFilterTab(btn, category) {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const tabs = [el.tabFilterAll, el.tabFilterTop, el.tabFilterGainers, el.tabFilterLosers];
      tabs.forEach(t => t && t.classList.remove('active'));
      btn.classList.add('active');
      state.activeCategory = category;
      filterAndRenderSymbolsList();
    });
  }

  function setupSortButton(btn, sortField) {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (state.activeSort === sortField) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.activeSort = sortField;
        state.sortAsc = false;
      }
      const sortBtns = [el.sortVolumeBtn, el.sortChangeBtn, el.sortPriceBtn, el.sortNameBtn];
      sortBtns.forEach(b => b && b.classList.remove('active'));
      btn.classList.add('active');
      filterAndRenderSymbolsList();
    });
  }

  function bindToggle(buttonEl, getTargetObj, prop, onToggle) {
    if (!buttonEl) return;
    buttonEl.addEventListener('click', async () => {
      const obj = getTargetObj();
      obj[prop] = !obj[prop];
      buttonEl.classList.toggle('active', obj[prop]);
      await saveCurrentSettings();
      renderChartLegend();
      if (onToggle) onToggle();
    });
  }

  async function saveCurrentSettings() {
    try {
      await DB.saveSettings(state.settings);
    } catch (e) {
      console.warn('Error saving settings to IndexedDB:', e);
    }
  }

  function applySettingsToUI() {
    updateActiveSymbolHeader();
    if (el.timeframeSelect) el.timeframeSelect.value = state.settings.timeframe;
    if (el.limitSelect) el.limitSelect.value = state.settings.candleLimit;
  }

  function zoomBars(count) {
    if (!state.chart || !state.candles.length) return;
    const total = state.candles.length;
    state.chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, total - count),
      to: total + 5
    });
  }

  // --- 11. Crosshair HUD ---
  function onCrosshairMove(param) {
    if (!param || !param.time || !state.candles.length) return;
    const candle = state.candles.find(c => c.time === param.time);
    if (!candle) return;
    updateHUD(candle);
  }

  function updateHUD(candle) {
    if (!el.hudTime) return;
    const d = new Date(candle.time * 1000);
    el.hudTime.innerText = d.toISOString().replace('T', ' ').slice(0, 16);
    if (el.hudOpen) el.hudOpen.innerText = formatPrice(candle.open);
    if (el.hudHigh) el.hudHigh.innerText = formatPrice(candle.high);
    if (el.hudLow) el.hudLow.innerText = formatPrice(candle.low);
    if (el.hudClose) {
      el.hudClose.innerText = formatPrice(candle.close);
      el.hudClose.style.color = candle.close >= candle.open ? '#10b981' : '#f43f5e';
    }
    if (el.hudVol) el.hudVol.innerText = Number(candle.volume).toFixed(2);
  }

  // --- 12. Status & Helpers ---
  function updateCacheBadge(isCached, totalCount, newCount, errorMsg) {
    if (!el.cacheBadge) return;
    if (errorMsg) {
      el.cacheBadge.innerHTML = `⚠️ <span style="color: #fb7185;">${errorMsg}</span>`;
      return;
    }
    if (isCached) {
      const newText = newCount > 0 ? ` • <span style="color: #38bdf8;">+${newCount} new synced</span>` : '';
      el.cacheBadge.innerHTML = `⚡ <b>IndexedDB</b>: ${totalCount.toLocaleString()} bars cached${newText}`;
    } else {
      el.cacheBadge.innerHTML = `🌐 Direct Binance Live`;
    }
  }

  function showLoader(show, text, subtext) {
    if (!el.loadingOverlay) return;
    if (show) {
      if (text && el.loadingText) el.loadingText.innerText = text;
      if (subtext && el.loadingSubtext) el.loadingSubtext.innerText = subtext;
      el.loadingOverlay.style.display = 'flex';
      el.loadingOverlay.style.opacity = '1';
    } else {
      el.loadingOverlay.style.opacity = '0';
      setTimeout(() => { el.loadingOverlay.style.display = 'none'; }, 250);
    }
  }

  function mergeDeep(target, source) {
    const output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target)) Object.assign(output, { [key]: source[key] });
          else output[key] = mergeDeep(target[key], source[key]);
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }

  function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
  }

})();
