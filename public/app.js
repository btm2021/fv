/**
 * 24/7 Quantum Trading Hub - Frontend Application Controller
 */

// Application State
const state = {
  ws: null,
  activeTab: 'tabSignals',
  activeSubtab: 'subActivePositions',
  status: {},
  settings: {},
  whitelist: [],
  signals: [],
  activePositions: [],
  closedPositions: [],
  limitOrders: [],
  performance: {},
  binanceSymbols: [],
  chart: {
    symbol: 'BTCUSDT',
    timeframe: '5m',
    mode: 'dual',
    candles: [],
    calcResult: null,
    visibleCount: 90,
    panOffset: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartPan: 0,
    crosshair: { x: null, y: null, active: false }
  }
};

// DOM Element Cache
const el = {};

function initDom() {
  el.navMarginBalance = document.getElementById('navMarginBalance');
  el.navWalletBalance = document.getElementById('navWalletBalance');
  el.navUnrealizedPnl = document.getElementById('navUnrealizedPnl');
  el.navMarginRatio = document.getElementById('navMarginRatio');
  el.scannerStatusPill = document.getElementById('scannerStatusPill');

  el.tickerSymbolName = document.getElementById('tickerSymbolName');
  el.tickerMarkPrice = document.getElementById('tickerMarkPrice');
  el.tickerChange24h = document.getElementById('tickerChange24h');
  el.tickerHigh24h = document.getElementById('tickerHigh24h');
  el.tickerLow24h = document.getElementById('tickerLow24h');
  el.tickerVol24h = document.getElementById('tickerVol24h');
  el.tickerFunding = document.getElementById('tickerFunding');

  el.btnManualScan = document.getElementById('btnManualScan');
  el.btnToggleScanner = document.getElementById('btnToggleScanner');

  el.menuTabs = document.querySelectorAll('.menu-tab');
  el.tabPanels = document.querySelectorAll('.tab-panel');

  // Subnav tabs
  el.subnavBtns = document.querySelectorAll('.subnav-btn');
  el.subtabContents = document.querySelectorAll('.subtab-content');

  el.subCountActive = document.getElementById('subCountActive');
  el.subCountLimit = document.getElementById('subCountLimit');
  el.subCountClosed = document.getElementById('subCountClosed');
  el.subCountSignals = document.getElementById('subCountSignals');

  // Tables
  el.tbodyActivePositions = document.getElementById('tbodyActivePositions');
  el.tbodyLimitOrders = document.getElementById('tbodyLimitOrders');
  el.tbodyClosedPositions = document.getElementById('tbodyClosedPositions');
  el.signalsFeedGrid = document.getElementById('signalsFeedGrid');
  el.whitelistEntityGrid = document.getElementById('whitelistEntityGrid');

  el.badgeActivePositions = document.getElementById('badgeActivePositions');
  el.badgeWhitelistCount = document.getElementById('badgeWhitelistCount');
  el.btnImportTop500 = document.getElementById('btnImportTop500');

  // Chart elements
  el.chartSymbolSelect = document.getElementById('chartSymbolSelect');
  el.chartTimeframeSelect = document.getElementById('chartTimeframeSelect');
  el.chartModeSelect = document.getElementById('chartModeSelect');
  el.btnReloadChart = document.getElementById('btnReloadChart');
  el.btnResetChartZoom = document.getElementById('btnResetChartZoom');
  el.liveChartCanvas = document.getElementById('liveChartCanvas');
  el.chartViewport = document.getElementById('chartViewport');
  el.chartHudBar = document.getElementById('chartHudBar');
  el.hudSymbol = document.getElementById('hudSymbol');
  el.hudOpen = document.getElementById('hudOpen');
  el.hudHigh = document.getElementById('hudHigh');
  el.hudLow = document.getElementById('hudLow');
  el.hudClose = document.getElementById('hudClose');
  el.hudVol = document.getElementById('hudVol');
  el.hudChange = document.getElementById('hudChange');

  // Settings form
  el.formBotSettings = document.getElementById('formBotSettings');
  el.cfgEquity = document.getElementById('cfgEquity');
  el.cfgRiskPct = document.getElementById('cfgRiskPct');
  el.cfgBufferLimit = document.getElementById('cfgBufferLimit');
  el.cfgPaperMode = document.getElementById('cfgPaperMode');
  el.cfgTgToken = document.getElementById('cfgTgToken');
  el.cfgTgChatId = document.getElementById('cfgTgChatId');
  el.cfgDiscordUrl = document.getElementById('cfgDiscordUrl');

  // Log elements
  el.badgeLogCount = document.getElementById('badgeLogCount');
  el.cntLogAll = document.getElementById('cntLogAll');
  el.logFilterBtns = document.querySelectorAll('.log-filter-btn');
  el.chkAutoScroll = document.getElementById('chkAutoScroll');
  el.btnCopyLogs = document.getElementById('btnCopyLogs');
  el.btnClearLogs = document.getElementById('btnClearLogs');
  el.terminalLogContainer = document.getElementById('terminalLogContainer');
  el.terminalLogBody = document.getElementById('terminalLogBody');

  // Modals
  el.modalAddSymbol = document.getElementById('modalAddSymbol');
  el.btnAddSymbolModalBtn = document.getElementById('btnAddSymbolModalBtn');
  el.btnCloseAddSymbolModal = document.getElementById('btnCloseAddSymbolModal');
  el.btnCancelAddSymbol = document.getElementById('btnCancelAddSymbol');
  el.btnConfirmAddSymbol = document.getElementById('btnConfirmAddSymbol');
  el.inputNewSymbol = document.getElementById('inputNewSymbol');
  el.selectNewCategory = document.getElementById('selectNewCategory');
  el.binanceSymbolsDatalist = document.getElementById('binanceSymbolsDatalist');

  el.modalEditStrategy = document.getElementById('modalEditStrategy');
  el.btnCloseEditStratModal = document.getElementById('btnCloseEditStratModal');
  el.btnCancelEditStrat = document.getElementById('btnCancelEditStrat');
  el.formEditStrategy = document.getElementById('formEditStrategy');

  el.modalTradeDecision = document.getElementById('modalTradeDecision');
  el.btnCloseDecisionModal = document.getElementById('btnCloseDecisionModal');
  el.modalDecisionBadge = document.getElementById('modalDecisionBadge');
  el.modalDecisionSymbol = document.getElementById('modalDecisionSymbol');
  el.modalDecisionBody = document.getElementById('modalDecisionBody');

  // Reset Buttons
  el.btnResetOrdersAndPnL = document.getElementById('btnResetOrdersAndPnL');
  el.btnResetTradesOnly = document.getElementById('btnResetTradesOnly');
  el.btnResetFactoryDb = document.getElementById('btnResetFactoryDb');
}

// ── WEBSOCKET LIVE STREAM ──
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('⚡ Connected to 24/7 Quantum Trading Hub WebSocket stream.');
  };

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error('WS Parse Error:', e);
    }
  };

  state.ws.onclose = () => {
    console.warn('WS Disconnected. Reconnecting in 3s...');
    setTimeout(initWebSocket, 3000);
  };
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'INITIAL_SNAPSHOT':
      state.status = msg.data.status;
      state.signals = msg.data.signals || [];
      state.activePositions = (msg.data.positions || []).filter(p => p.status === 'ACTIVE');
      state.performance = msg.data.performance || {};
      state.logs = msg.data.logs || [];
      updateDashboardUI();
      renderLogs();
      break;

    case 'SCANNER_HEARTBEAT':
      state.status = msg.data;
      updateHeaderMetrics();
      break;

    case 'NEW_SIGNAL':
      state.signals.unshift(msg.data);
      if (state.signals.length > 100) state.signals.pop();
      renderSignalsFeed();
      updateSubnavCounters();
      break;

    case 'POSITIONS_UPDATE':
      state.activePositions = (msg.data.positions || []).filter(p => p.status === 'ACTIVE');
      state.performance = msg.data.stats || {};
      state.livePrices = msg.data.livePrices || {};
      renderActivePositions();
      updateHeaderMetrics();
      updateSubnavCounters();

      // Real-time live price ticker for the currently active chart pair
      if (state.chart.symbol && state.livePrices && state.livePrices[state.chart.symbol]) {
        const liveP = state.livePrices[state.chart.symbol];
        if (el.tickerMarkPrice) {
          el.tickerMarkPrice.textContent = formatPrice(liveP);
        }
      }
      break;

    case 'SYSTEM_LOG':
      if (!state.logs) state.logs = [];
      state.logs.push(msg.data);
      if (state.logs.length > 500) state.logs.shift();
      appendSingleLog(msg.data);
      updateLogCounters();
      break;
  }
}

// ── REST API FETCHERS ──
async function fetchInitialData() {
  try {
    const [resStatus, resWhitelist, resSignals, resPositions, resSettings, resBinanceSymbols, resLogs] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/whitelist').then(r => r.json()),
      fetch('/api/signals?limit=100').then(r => r.json()),
      fetch('/api/positions').then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/binance/symbols').then(r => r.json()),
      fetch('/api/logs?limit=100').then(r => r.json())
    ]);

    if (resStatus.success) {
      state.status = resStatus.status;
      state.settings = resStatus.settings;
    }
    if (resWhitelist.success) state.whitelist = resWhitelist.data;
    if (resSignals.success) state.signals = resSignals.data;
    if (resPositions.success) {
      state.activePositions = resPositions.active || [];
      state.closedPositions = (resPositions.all || []).filter(p => p.status !== 'ACTIVE');
      state.performance = resPositions.stats || {};
    }
    if (resSettings.success) state.settings = resSettings.data;
    if (resBinanceSymbols.success) state.binanceSymbols = resBinanceSymbols.data;
    if (resLogs && resLogs.success) {
      state.logs = resLogs.data || [];
      renderLogs();
    }

    // Filter pending limit orders from signals (FADE signals where market price hasn't reached entry yet)
    deriveLimitOrders();

    updateDashboardUI();
    populateBinanceSymbolsDatalist();
    populateChartSymbolOptions();
    loadChartData();
  } catch (err) {
    console.error('Fetch Initial Data Error:', err);
  }
}

function deriveLimitOrders() {
  // Any FADE signal within last 4 hours that is not already filled in active positions
  const activeSyms = new Set(state.activePositions.map(p => p.symbol));
  state.limitOrders = state.signals.filter(s => {
    return s.signal_type && s.signal_type.startsWith('FADE') && !activeSyms.has(s.symbol);
  }).slice(0, 30);
}

// ── UI UPDATERS ──
function updateDashboardUI() {
  updateHeaderMetrics();
  updateSubnavCounters();
  renderActivePositions();
  renderLimitOrders();
  renderClosedPositions();
  renderSignalsFeed();
  renderWhitelist();
  populateSettingsForm();
}

function updateHeaderMetrics() {
  const marginBalance = state.performance.margin_balance || Number(state.settings.account_equity || 1000);
  const walletBalance = state.performance.wallet_balance || Number(state.settings.account_equity || 1000);
  const unrealizedPnl = state.performance.unrealized_pnl_usd || 0;
  const unrealizedPct = walletBalance > 0 ? (unrealizedPnl / walletBalance) * 100 : 0;
  const marginRatio = state.performance.margin_ratio || 0;

  if (el.navMarginBalance) el.navMarginBalance.textContent = `$${marginBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (el.navWalletBalance) el.navWalletBalance.textContent = `$${walletBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (el.navUnrealizedPnl) {
    const sign = unrealizedPnl >= 0 ? '+' : '';
    el.navUnrealizedPnl.className = `m-val ${unrealizedPnl >= 0 ? 'green' : 'red'}`;
    el.navUnrealizedPnl.textContent = `${sign}$${unrealizedPnl.toFixed(2)} (${sign}${unrealizedPct.toFixed(2)}%)`;
  }
  if (el.navMarginRatio) {
    el.navMarginRatio.className = `m-val ${marginRatio > 50 ? 'red' : 'green'}`;
    el.navMarginRatio.textContent = `${marginRatio.toFixed(2)}%`;
  }

  if (el.badgeActivePositions) el.badgeActivePositions.textContent = state.activePositions.length;
  if (el.badgeWhitelistCount) el.badgeWhitelistCount.textContent = state.whitelist.length;

  const isScanning = state.status && state.status.isRunning;
  if (el.scannerStatusPill) {
    if (isScanning) {
      const bucketText = state.status.currentBucket ? ` [Bucket ${state.status.currentBucket}/5 • 200/min]` : '';
      el.scannerStatusPill.className = 'status-pill active';
      el.scannerStatusPill.innerHTML = `<span class="pulse-dot"></span> RUNNING${bucketText}`;
      if (el.btnToggleScanner) el.btnToggleScanner.innerHTML = '<span>⏸️ Pause</span>';
    } else {
      el.scannerStatusPill.className = 'status-pill paused';
      el.scannerStatusPill.innerHTML = '<span class="pulse-dot"></span> PAUSED';
      if (el.btnToggleScanner) el.btnToggleScanner.innerHTML = '<span>▶️ Resume</span>';
    }
  }
}

function updateSubnavCounters() {
  if (el.subCountActive) el.subCountActive.textContent = state.activePositions.length;
  if (el.subCountLimit) el.subCountLimit.textContent = state.limitOrders.length;
  if (el.subCountClosed) el.subCountClosed.textContent = state.closedPositions.length;
  if (el.subCountSignals) el.subCountSignals.textContent = state.signals.length;
}

// ── 1. ACTIVE POSITIONS RENDERER (BINANCE FUTURES PRO) ──
function renderActivePositions() {
  if (!el.tbodyActivePositions) return;

  if (!state.activePositions || state.activePositions.length === 0) {
    el.tbodyActivePositions.innerHTML = `
      <tr><td colspan="10" class="text-center empty-state">No active positions open. Scanner is monitoring market 24/7...</td></tr>
    `;
    return;
  }

  el.tbodyActivePositions.innerHTML = state.activePositions.map(p => {
    const isLong = p.direction === 'BUY';
    const sideBadge = isLong ? 'LONG' : 'SHORT';
    const pnlUsd = p.net_pnl_usd || 0;
    const roePct = p.roe_pct !== undefined ? p.roe_pct : (p.initial_margin > 0 ? (pnlUsd / p.initial_margin) * 100 : 0);
    const pnlClass = pnlUsd >= 0 ? 'green' : 'red';
    const pnlSign = pnlUsd >= 0 ? '+' : '';

    const curPrice = p.current_price || p.entry_price;
    const leverage = p.leverage || 20;
    const marginMode = p.margin_mode || 'ISOLATED';
    const marginRatio = (p.margin_ratio || 0).toFixed(2);

    return `
      <tr class="clickable-row">
        <td onclick="openStat2Chart('${p.symbol}', '5m')">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-weight:800; color:#FFFFFF;">${p.symbol}</span>
            <span class="binance-pos-side ${p.direction}">${sideBadge}</span>
            <span class="binance-leverage-pill">${leverage}x ${marginMode}</span>
          </div>
        </td>
        <td>
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight:700; color:#FFFFFF;">$${formatPrice(p.pos_size_usd)}</span>
            <span style="font-size:10px; color:#848E9C;">${p.quantity.toFixed(3)} Qty</span>
          </div>
        </td>
        <td>$${formatPrice(p.entry_price)}</td>
        <td style="color:${isLong ? '#0ECB81' : '#F6465D'}; font-weight:700;">$${formatPrice(curPrice)}</td>
        <td><span class="binance-liq-price">$${formatPrice(p.liq_price)}</span></td>
        <td>$${formatPrice(p.initial_margin)}</td>
        <td style="color:${marginRatio > 50 ? '#F6465D' : '#0ECB81'}; font-weight:700;">${marginRatio}%</td>
        <td>
          <div class="binance-pnl-cell ${pnlClass}">
            <span class="pnl-usd">${pnlSign}$${pnlUsd.toFixed(2)}</span>
            <span class="pnl-roe">(${pnlSign}${roePct.toFixed(2)}%)</span>
          </div>
        </td>
        <td>
          <div style="font-size:10.5px; line-height:1.3;">
            <span style="color:#0ECB81;">TP: $${formatPrice(p.tp1_price)}</span><br>
            <span style="color:${p.is_be_moved ? '#00F0FF' : '#F6465D'};">SL: $${formatPrice(p.sl_price)}</span>
          </div>
        </td>
        <td>
          <div style="display:flex; gap:4px; align-items:center;">
            <button class="btn btn-secondary btn-sm" onclick="openPositionForensics('${p.id}')" title="Inspect Trade Rationale & ML Features">💡 Info</button>
            <button class="btn btn-danger btn-sm btn-close-market" data-id="${p.id}" title="Market Close Position">Close</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Attach Market Close listener
  document.querySelectorAll('.btn-close-market').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const posId = btn.dataset.id;
      if (!confirm('Market Close this Binance Futures position immediately?')) return;
      btn.disabled = true;
      btn.textContent = 'Closing...';
      const res = await fetch(`/api/positions/close/${posId}`, { method: 'POST' }).then(r => r.json());
      if (res.success) {
        await refreshAllData();
      }
    });
  });
}

// ── 2. PENDING LIMIT ORDERS RENDERER ──
function renderLimitOrders() {
  if (!el.tbodyLimitOrders) return;

  if (!state.limitOrders || state.limitOrders.length === 0) {
    el.tbodyLimitOrders.innerHTML = `
      <tr><td colspan="10" class="text-center empty-state">No open limit orders. Fade traps will register here automatically...</td></tr>
    `;
    return;
  }

  el.tbodyLimitOrders.innerHTML = state.limitOrders.map(sig => {
    const isLong = sig.direction === 'BUY';
    const sideBadge = isLong ? 'LIMIT BUY' : 'LIMIT SELL';
    const distEntry = Math.abs(sig.entry_price - (sig.current_price || sig.entry_price)) / sig.entry_price * 100;

    return `
      <tr class="clickable-row">
        <td style="font-weight: 800; color: #FFFFFF;" onclick="openStat2Chart('${sig.symbol}', '${sig.timeframe || '5m'}')">
          ${sig.symbol} <span style="font-size:10px; color:#F0B90B;">(${sig.timeframe})</span>
        </td>
        <td><span class="binance-pos-side ${sig.direction}">${sideBadge}</span></td>
        <td style="font-weight: 700; color: #F0B90B;">$${formatPrice(sig.entry_price)}</td>
        <td>$${formatPrice(sig.entry_price)}</td>
        <td><span style="color: #FCD535; font-weight:700;">~${distEntry.toFixed(2)}%</span></td>
        <td style="color: #0ECB81;">$${formatPrice(sig.tp1_price)} (+${sig.tp1_pct ? sig.tp1_pct.toFixed(1) : '1.8'}%)</td>
        <td style="color: #00F0FF;">$${formatPrice(sig.tp2_price)} (+${sig.tp2_pct ? sig.tp2_pct.toFixed(1) : '3.2'}%)</td>
        <td style="color: #F6465D;">$${formatPrice(sig.sl_price)} (-${sig.sl_pct ? sig.sl_pct.toFixed(1) : '2.5'}%)</td>
        <td>$400.00</td>
        <td>
          <div style="display:flex; gap:4px;">
            <button class="btn btn-secondary btn-sm" onclick="openStat2Chart('${sig.symbol}', '${sig.timeframe || '5m'}')">📊 Chart</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ── 3. CLOSED POSITIONS RENDERER (ORDER HISTORY) ──
function renderClosedPositions() {
  if (!el.tbodyClosedPositions) return;

  if (!state.closedPositions || state.closedPositions.length === 0) {
    el.tbodyClosedPositions.innerHTML = `
      <tr><td colspan="10" class="text-center empty-state">No closed trades recorded yet.</td></tr>
    `;
    return;
  }

  el.tbodyClosedPositions.innerHTML = state.closedPositions.map(p => {
    const isLong = p.direction === 'BUY';
    const sideBadge = isLong ? 'LONG' : 'SHORT';
    const pnlUsd = p.net_pnl_usd || 0;
    const roePct = p.roe_pct !== undefined ? p.roe_pct : (p.initial_margin > 0 ? (pnlUsd / p.initial_margin) * 100 : (p.net_pnl_pct || 0));
    const pnlClass = pnlUsd >= 0 ? 'green' : 'red';
    const pnlSign = pnlUsd >= 0 ? '+' : '';

    return `
      <tr class="clickable-row">
        <td style="font-weight: 800; color: #FFFFFF;" onclick="openStat2Chart('${p.symbol}', '5m')">
          ${p.symbol} <span class="binance-leverage-pill">${p.leverage || 20}x</span>
        </td>
        <td><span class="binance-pos-side ${p.direction}">${sideBadge}</span></td>
        <td>$${formatPrice(p.entry_price)}</td>
        <td>$${formatPrice(p.exit_price || p.current_price || p.entry_price)}</td>
        <td><span class="status-pill ${pnlUsd >= 0 ? 'active' : 'paused'}">${p.exit_reason || p.status}</span></td>
        <td style="font-weight: 700;" class="${pnlClass}">${pnlSign}$${pnlUsd.toFixed(2)}</td>
        <td style="font-weight: 700;" class="${pnlClass}">${pnlSign}${roePct.toFixed(2)}%</td>
        <td style="color:#848E9C; font-size:10.5px;">${new Date(p.open_time).toLocaleTimeString()}</td>
        <td style="color:#848E9C; font-size:10.5px;">${p.close_time ? new Date(p.close_time).toLocaleTimeString() : '-'}</td>
        <td>
          <div style="display:flex; gap:4px;">
            <button class="btn btn-secondary btn-sm" onclick="openPositionForensics('${p.id}')" title="Inspect Rationale & ML Features">💡 Forensics</button>
            <button class="btn btn-secondary btn-sm" onclick="openStat2Chart('${p.symbol}', '5m')">📊 Chart</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ── 4. SIGNALS FEED RENDERER ──
function renderSignalsFeed() {
  if (!el.signalsFeedGrid) return;

  if (!state.signals || state.signals.length === 0) {
    el.signalsFeedGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 40px;">
        No signals detected in the latest scan window. Next scan triggers on candle close...
      </div>
    `;
    return;
  }

  el.signalsFeedGrid.innerHTML = state.signals.map((sig, idx) => {
    const isLong = sig.direction === 'BUY';
    const badgeText = sig.signal_type.startsWith('FADE') ? (isLong ? '⚡ FADE LONG' : '⚡ FADE SHORT') : (isLong ? '▲ BUY TREND' : '▼ SELL TREND');
    const timeStr = new Date(sig.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return `
      <div class="signal-card ${sig.direction}">
        <div class="sig-header">
          <div>
            <span class="sig-symbol">${sig.symbol}</span>
            <span style="font-size: 11px; color: #64748b; margin-left: 6px;">${sig.timeframe}</span>
          </div>
          <span class="sig-badge ${sig.direction}">${badgeText}</span>
        </div>

        <div class="sig-grid-rows" onclick="openDecisionModalFromFeed(${idx})">
          <div class="sig-row-item">
            <span class="sig-lbl">Entry</span>
            <span class="sig-val">${formatPrice(sig.entry_price)}</span>
          </div>
          <div class="sig-row-item">
            <span class="sig-lbl">Stop Loss</span>
            <span class="sig-val red">${formatPrice(sig.sl_price)}</span>
          </div>
          <div class="sig-row-item">
            <span class="sig-lbl">TP1 (FVG)</span>
            <span class="sig-val green">${formatPrice(sig.tp1_price)}</span>
          </div>
          <div class="sig-row-item">
            <span class="sig-lbl">TP2 (Liquidity)</span>
            <span class="sig-val cyan">${formatPrice(sig.tp2_price)}</span>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px;">
          <div style="font-size: 10.5px; color: #64748b; font-family: var(--font-mono);">
            <span>R:R: <b style="color:#f8fafc;">1:${(sig.rr_ratio || 2.0).toFixed(1)}</b></span> •
            <span>ATR: <b style="color:#38bdf8;">${(sig.atr_pct || 0.5).toFixed(2)}%</b></span>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-secondary" onclick="openDecisionModalFromFeed(${idx})">💡 Forensics</button>
            <button class="btn-stat2-view" onclick="openStat2Chart('${sig.symbol}', '${sig.timeframe}')">📊 STAT2 Chart</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ── 5. WHITELIST ENTITY RENDERER ──
function renderWhitelist() {
  if (!el.whitelistEntityGrid) return;

  el.whitelistEntityGrid.innerHTML = state.whitelist.map(item => {
    const isEnabled = item.is_enabled === 1;
    const strats = item.strategies || [];

    return `
      <div class="whitelist-card">
        <div class="wl-top">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="wl-symbol" style="cursor:pointer;" onclick="openStat2Chart('${item.symbol}', '5m')">${item.symbol}</span>
            <span class="wl-category">${item.category || 'Futures'}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="btn-stat2-view" onclick="openStat2Chart('${item.symbol}', '5m')">📊 Chart</button>
            <button class="btn btn-sm ${isEnabled ? 'btn-secondary' : 'btn-success'}" onclick="toggleSymbol('${item.symbol}', ${!isEnabled})">
              ${isEnabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteSymbol('${item.symbol}')">🗑️</button>
          </div>
        </div>

        <div style="font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 8px;">
          Active Strategies (${strats.length})
        </div>

        <div class="strategy-pill-list">
          ${strats.map(s => `
            <div class="strategy-item-row" style="background:#1E2329; border:1px solid #2B313A; border-radius:4px; padding:6px 8px; margin-top:4px; display:flex; justify-content:space-between; align-items:center;">
              <div class="strat-info">
                <span class="strat-tf" style="color:#F0B90B; font-weight:700;">${s.timeframe}</span>
                <span style="font-weight:600; color:#FFFFFF; margin-left:4px;">${s.strategy_name}</span>
                <span class="binance-leverage-pill">${s.leverage || 20}x ${s.margin_mode || 'ISOLATED'}</span>
                <span style="font-size: 10px; color: #848E9C; margin-left:4px;">(Risk: ${s.risk_pct}%)</span>
              </div>
              <div class="strat-actions" style="display:flex; gap:4px;">
                <button class="btn btn-sm btn-secondary" onclick="openEditStrategyModal('${s.id}')">⚙️</button>
                <button class="btn btn-sm btn-danger" onclick="deleteStrategy('${s.id}')">✕</button>
              </div>
            </div>
          `).join('')}
        </div>

        <button class="btn btn-secondary btn-sm" style="width: 100%; margin-top: 8px;" onclick="openAddStrategyForSymbolModal('${item.symbol}')">
          + Add Strategy Layer
        </button>
      </div>
    `;
  }).join('');
}

function populateSettingsForm() {
  if (!el.formBotSettings) return;
  if (el.cfgEquity) el.cfgEquity.value = state.settings.account_equity || 1000;
  if (el.cfgDefaultLeverage) el.cfgDefaultLeverage.value = state.settings.default_leverage || '20';
  if (el.cfgDefaultMarginMode) el.cfgDefaultMarginMode.value = state.settings.default_margin_mode || 'ISOLATED';
  if (el.cfgRiskPct) el.cfgRiskPct.value = state.settings.default_risk_pct || 1.0;
  if (el.cfgPaperMode) el.cfgPaperMode.value = state.settings.paper_trading_mode || 1;
  if (el.cfgTgToken) el.cfgTgToken.value = state.settings.telegram_bot_token || '';
  if (el.cfgTgChatId) el.cfgTgChatId.value = state.settings.telegram_chat_id || '';
  if (el.cfgDiscordUrl) el.cfgDiscordUrl.value = state.settings.discord_webhook_url || '';
}

function populateBinanceSymbolsDatalist() {
  if (!el.binanceSymbolsDatalist || !state.binanceSymbols) return;
  el.binanceSymbolsDatalist.innerHTML = state.binanceSymbols.map(s => `
    <option value="${s.symbol}">${s.symbol} (${s.baseAsset})</option>
  `).join('');
}

function populateChartSymbolOptions() {
  if (!el.chartSymbolSelect) return;
  const symbols = state.whitelist.map(w => w.symbol);
  el.chartSymbolSelect.innerHTML = symbols.map(s => `
    <option value="${s}" ${s === state.chart.symbol ? 'selected' : ''}>${s}</option>
  `).join('');
}

// ── NAVIGATION TO STAT2 CHART ──
function openStat2Chart(symbol, timeframe = '5m') {
  state.chart.symbol = symbol;
  state.chart.timeframe = timeframe;
  state.activeTab = 'tabChart';

  // Switch to chart tab
  el.menuTabs.forEach(t => t.classList.remove('active'));
  el.tabPanels.forEach(p => p.classList.remove('active'));

  const chartTabBtn = document.querySelector('.menu-tab[data-tab="tabChart"]');
  const chartPanel = document.getElementById('tabChart');
  if (chartTabBtn) chartTabBtn.classList.add('active');
  if (chartPanel) chartPanel.classList.add('active');

  // Update dropdowns
  if (el.chartSymbolSelect) {
    let exists = false;
    for (let i = 0; i < el.chartSymbolSelect.options.length; i++) {
      if (el.chartSymbolSelect.options[i].value === symbol) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = symbol;
      opt.textContent = symbol;
      el.chartSymbolSelect.appendChild(opt);
    }
    el.chartSymbolSelect.value = symbol;
  }
  if (el.chartTimeframeSelect) el.chartTimeframeSelect.value = timeframe;

  // Reload chart with STAT2 overlay
  loadChartData();
}

// ── ACTIONS & API CALLS ──
async function toggleSymbol(symbol, nextState) {
  await fetch(`/api/whitelist/${symbol}/toggle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_enabled: nextState })
  });
  const res = await fetch('/api/whitelist').then(r => r.json());
  if (res.success) state.whitelist = res.data;
  renderWhitelist();
  updateHeaderMetrics();
}

async function deleteSymbol(symbol) {
  if (!confirm(`Are you sure you want to delete ${symbol} from the whitelist entity registry?`)) return;
  await fetch(`/api/whitelist/${symbol}`, { method: 'DELETE' });
  const res = await fetch('/api/whitelist').then(r => r.json());
  if (res.success) state.whitelist = res.data;
  renderWhitelist();
  updateHeaderMetrics();
  populateChartSymbolOptions();
}

function openAddStrategyForSymbolModal(symbol) {
  document.getElementById('editStrategyTitle').textContent = `⚙️ Add Strategy for ${symbol}`;
  document.getElementById('stratId').value = '';
  document.getElementById('stratSymbol').value = symbol;
  document.getElementById('stratName').value = `${symbol} Custom 5m`;
  document.getElementById('stratType').value = 'dual';
  document.getElementById('stratTf').value = '5m';
  document.getElementById('stratRiskPct').value = 1.0;
  document.getElementById('stratAtrMult').value = 2.0;
  document.getElementById('stratMinAtr').value = 0.35;
  document.getElementById('stratLiqThresh').value = 1.5;
  document.getElementById('stratSwingLookback').value = 30;

  el.modalEditStrategy.classList.add('active');
}

function openEditStrategyModal(stratId) {
  let targetStrat = null;
  for (const w of state.whitelist) {
    const s = (w.strategies || []).find(x => x.id === stratId);
    if (s) { targetStrat = s; break; }
  }
  if (!targetStrat) return;

  document.getElementById('editStrategyTitle').textContent = `⚙️ Edit Strategy: ${targetStrat.strategy_name}`;
  document.getElementById('stratId').value = targetStrat.id;
  document.getElementById('stratSymbol').value = targetStrat.symbol;
  document.getElementById('stratName').value = targetStrat.strategy_name;
  document.getElementById('stratType').value = targetStrat.strategy_type;
  document.getElementById('stratTf').value = targetStrat.timeframe;
  document.getElementById('stratRiskPct').value = targetStrat.risk_pct;
  document.getElementById('stratAtrMult').value = targetStrat.atr_mult;
  document.getElementById('stratMinAtr').value = targetStrat.min_atr_pct;
  document.getElementById('stratLiqThresh').value = targetStrat.liq_threshold_pct;
  document.getElementById('stratSwingLookback').value = targetStrat.swing_lookback;

  el.modalEditStrategy.classList.add('active');
}

async function deleteStrategy(stratId) {
  if (!confirm('Delete this strategy layer?')) return;
  await fetch(`/api/strategies/${stratId}`, { method: 'DELETE' });
  const res = await fetch('/api/whitelist').then(r => r.json());
  if (res.success) state.whitelist = res.data;
  renderWhitelist();
}

// ── MODAL TRADE DECISION FORENSICS ──
function openDecisionModalFromFeed(index) {
  const sig = state.signals[index];
  if (!sig) return;

  const isLong = sig.direction === 'BUY';
  const badgeTitle = sig.signal_type.startsWith('FADE') ? (isLong ? '⚡ FADE LONG' : '⚡ FADE SHORT') : (isLong ? '▲ BUY TREND' : '▼ SELL TREND');
  const badgeClass = sig.direction;

  el.modalDecisionBadge.className = `status-badge-lg sig-badge ${badgeClass}`;
  el.modalDecisionBadge.textContent = badgeTitle;
  el.modalDecisionSymbol.textContent = `${sig.symbol} • ${sig.timeframe}`;

  el.modalDecisionBody.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; background: #1e293b; padding: 12px; border-radius: 8px; text-align: center; font-family: var(--font-mono); margin-bottom: 16px;">
      <div>
        <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase;">Entry</div>
        <div style="color: #f8fafc; font-weight: 700; font-size: 13px; margin-top: 2px;">${formatPrice(sig.entry_price)}</div>
      </div>
      <div>
        <div style="color: #10b981; font-size: 10px; text-transform: uppercase;">TP1 (50%)</div>
        <div style="color: #10b981; font-weight: 700; font-size: 13px; margin-top: 2px;">${formatPrice(sig.tp1_price)}</div>
      </div>
      <div>
        <div style="color: #06b6d4; font-size: 10px; text-transform: uppercase;">TP2 (Liq)</div>
        <div style="color: #06b6d4; font-weight: 700; font-size: 13px; margin-top: 2px;">${formatPrice(sig.tp2_price)}</div>
      </div>
      <div>
        <div style="color: #f43f5e; font-size: 10px; text-transform: uppercase;">Stop Loss</div>
        <div style="color: #f43f5e; font-weight: 700; font-size: 13px; margin-top: 2px;">${formatPrice(sig.sl_price)}</div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px; line-height: 1.6;">
      <div style="background: #14181F; padding: 12px; border-radius: 6px; border-left: 3px solid #F0B90B;">
        <div style="font-weight: 700; color: #F0B90B; font-size: 12px; margin-bottom: 4px;">📌 1️⃣ TẠI SAO CHỌN SIDE & ĐIỂM ENTRY?</div>
        <div style="color: #EAECEF;">${sig.side_rationale || sig.rationale || 'Nến đóng cửa xác nhận xu hướng rõ nét, ATR đạt chuẩn biến động và vùng cản thông thoáng.'}</div>
        ${sig.entry_rationale ? `<div style="color: #848E9C; margin-top: 4px; font-size: 11px;">👉 <b>Căn cứ vào lệnh:</b> ${sig.entry_rationale}</div>` : ''}
      </div>

      <div style="background: #14181F; padding: 12px; border-radius: 6px; border-left: 3px solid #0ECB81;">
        <div style="font-weight: 700; color: #0ECB81; font-size: 12px; margin-bottom: 4px;">🎯 2️⃣ TẠI SAO CHỐT LỜI TẠI TP1 & TP2?</div>
        <div style="color: #EAECEF;">
          • <b>TP1 (${formatPrice(sig.tp1_price)}):</b> ${sig.tp1_rationale || 'Mép vùng FVG đối diện chưa lấp. Tự động dời SL về Hòa Vốn (Breakeven +0.05%) sau khi chạm.'}<br>
          • <b>TP2 (${formatPrice(sig.tp2_price)}):</b> ${sig.tp2_rationale || 'Cụm thanh khoản Liquidity Pool đối diện.'}
        </div>
      </div>

      <div style="background: #14181F; padding: 12px; border-radius: 6px; border-left: 3px solid #F6465D;">
        <div style="font-weight: 700; color: #F6465D; font-size: 12px; margin-bottom: 4px;">🛑 3️⃣ TẠI SAO ĐẶT SL TẠI MỨC NÀY?</div>
        <div style="color: #EAECEF;">${sig.sl_rationale || 'Đặt dưới Swing Low/High gần nhất kèm biên độ an toàn, bảo vệ vị thế khỏi râu nến giật.'}</div>
      </div>

      <div style="background: #12161C; border: 1px solid #2B313A; padding: 12px; border-radius: 6px;">
        <div style="font-weight: 700; color: #00F0FF; font-size: 12px; margin-bottom: 4px;">🔬 4️⃣ CHỈ SỐ ĐỊNH LƯỢNG & FEATURES:</div>
        <div style="color: #EAECEF; font-family: var(--font-mono); font-size: 11.5px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <div>• Risk / Reward (R:R): <b style="color:#F0B90B;">1 : ${(sig.rr_ratio || 2.0).toFixed(2)}</b></div>
          <div>• ATR Volatility: <b style="color:#0ECB81;">${(sig.atr_pct || 0.5).toFixed(2)}%</b></div>
          <div>• Market Regime: <b style="color:#FFFFFF;">${sig.market_regime || 'TREND'}</b></div>
          <div>• Thời gian Tín hiệu: <b style="color:#848E9C;">${new Date(sig.timestamp * 1000).toLocaleTimeString()}</b></div>
        </div>
      </div>
    </div>
  `;

  el.modalTradeDecision.classList.add('active');
}

// ── MODAL POSITION FORENSICS & QUANTITATIVE FEATURES ──
async function openPositionForensics(posId) {
  try {
    const res = await fetch(`/api/positions/${posId}/forensics`).then(r => r.json());
    if (!res.success || !res.data) return;
    const pos = res.data;
    const isLong = pos.direction === 'BUY';
    const sideBadge = pos.signal_type || (isLong ? '▲ LONG' : '▼ SHORT');
    const badgeClass = isLong ? 'BUY' : 'SELL';

    el.modalDecisionBadge.className = `status-badge-lg sig-badge ${badgeClass}`;
    el.modalDecisionBadge.textContent = `${sideBadge} [${pos.leverage || 20}x ${pos.margin_mode || 'ISOLATED'}]`;
    el.modalDecisionSymbol.textContent = `${pos.symbol} • Entry: $${formatPrice(pos.entry_price)}`;

    const pnlSign = (pos.net_pnl_usd || 0) >= 0 ? '+' : '';
    const pnlClass = (pos.net_pnl_usd || 0) >= 0 ? 'green' : 'red';
    const roe = pos.roe_pct !== undefined ? pos.roe_pct : 0;
    const durationStr = pos.duration_seconds ? `${pos.duration_seconds}s` : 'Active / Monitoring';

    el.modalDecisionBody.innerHTML = `
      <!-- SUMMARY STRIP -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; background: #12161C; border: 1px solid #2B313A; padding: 12px; border-radius: 6px; text-align: center; font-family: var(--font-mono); margin-bottom: 16px;">
        <div>
          <div style="color: #848E9C; font-size: 10px; text-transform: uppercase;">Entry Price</div>
          <div style="color: #FFFFFF; font-weight: 700; font-size: 13px; margin-top: 2px;">$${formatPrice(pos.entry_price)}</div>
        </div>
        <div>
          <div style="color: #0ECB81; font-size: 10px; text-transform: uppercase;">TP1 (50% + BE)</div>
          <div style="color: #0ECB81; font-weight: 700; font-size: 13px; margin-top: 2px;">$${formatPrice(pos.tp1_price)}</div>
        </div>
        <div>
          <div style="color: #00F0FF; font-size: 10px; text-transform: uppercase;">TP2 Target</div>
          <div style="color: #00F0FF; font-weight: 700; font-size: 13px; margin-top: 2px;">$${formatPrice(pos.tp2_price)}</div>
        </div>
        <div>
          <div style="color: #F6465D; font-size: 10px; text-transform: uppercase;">Stop Loss / Liq</div>
          <div style="color: #F6465D; font-weight: 700; font-size: 13px; margin-top: 2px;">$${formatPrice(pos.sl_price)} <span style="color:#FFA500; font-size:10px;">($${formatPrice(pos.liq_price)})</span></div>
        </div>
      </div>

      <!-- RATIONALE FORENSICS -->
      <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12.5px; line-height: 1.6;">
        <div style="background: #14181F; padding: 12px; border-radius: 6px; border-left: 3px solid #F0B90B;">
          <div style="font-weight: 700; color: #F0B90B; margin-bottom: 4px; font-size: 11.5px;">📌 1. LÝ DO & ĐIỀU KIỆN VÀO LỆNH (ENTRY RATIONALE)</div>
          <div style="color: #EAECEF;">${pos.side_rationale || pos.entry_rationale || 'Lệnh kích hoạt theo mô hình xác nhận xu hướng SMC + VIDYA Volatility Breakout.'}</div>
          ${pos.entry_rationale ? `<div style="color: #848E9C; margin-top: 4px; font-size: 11px;">👉 <b>Căn cứ mức giá vào:</b> ${pos.entry_rationale}</div>` : ''}
        </div>

        <div style="background: #14181F; padding: 12px; border-radius: 6px; border-left: 3px solid #0ECB81;">
          <div style="font-weight: 700; color: #0ECB81; margin-bottom: 4px; font-size: 11.5px;">🎯 2. CĂN CỨ CÁC MỐC CHỐT LỜI (TP1 & TP2 RATIONALE)</div>
          <div style="color: #EAECEF;">${pos.tp1_rationale || 'Chốt lời từng phần tại vùng FVG đối diện và tự động dời SL về hòa vốn (Breakeven).'}</div>
          ${pos.tp2_rationale ? `<div style="color: #848E9C; margin-top: 4px; font-size: 11px;">👉 <b>Căn cứ TP2:</b> ${pos.tp2_rationale}</div>` : ''}
        </div>

        <div style="background: #14181F; padding: 12px; border-radius: 6px; border-left: 3px solid #F6465D;">
          <div style="font-weight: 700; color: #F6465D; margin-bottom: 4px; font-size: 11.5px;">🛑 3. CĂN CỨ MỐC CẮT LỖ & AN TOÀN VỐN (STOP-LOSS & LIQUIDATION RATIONALE)</div>
          <div style="color: #EAECEF;">${pos.sl_rationale || 'Cắt lỗ đặt ngoài vùng cấu trúc Swing Pivot để bảo vệ an toàn vốn.'}</div>
          <div style="color: #FFA500; margin-top: 4px; font-size: 11px;">⚠️ <b>Giá thanh lý ước tính (Liquidation Price):</b> $${formatPrice(pos.liq_price)} (Ký quỹ: $${formatPrice(pos.initial_margin)} @ ${pos.leverage || 20}x).</div>
        </div>

        <!-- QUANTITATIVE ML FEATURES SNAPSHOT -->
        <div style="background: #12161C; border: 1px solid #2B313A; padding: 12px; border-radius: 6px;">
          <div style="font-weight: 700; color: #00F0FF; margin-bottom: 8px; font-size: 11.5px;">🔬 4. VECTOR ĐẶC TRƯNG ĐỊNH LƯỢNG TẠI THỜI ĐIỂM VÀO LỆNH (ML FEATURE VECTOR)</div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-family: var(--font-mono); font-size: 11px;">
            <div><span style="color:#848E9C;">Market Regime:</span> <b style="color:#FFFFFF;">${pos.market_regime || 'TREND'}</b></div>
            <div><span style="color:#848E9C;">ATR Volatility:</span> <b style="color:#0ECB81;">${(pos.atr_pct || 0).toFixed(2)}%</b></div>
            <div><span style="color:#848E9C;">Risk/Reward (R:R):</span> <b style="color:#F0B90B;">1:${(pos.rr_ratio || 2.0).toFixed(1)}</b></div>
            <div><span style="color:#848E9C;">Notional Size:</span> <b style="color:#FFFFFF;">$${formatPrice(pos.pos_size_usd)}</b></div>
            <div><span style="color:#848E9C;">Initial Margin:</span> <b style="color:#FFFFFF;">$${formatPrice(pos.initial_margin)}</b></div>
            <div><span style="color:#848E9C;">Leverage Mode:</span> <b style="color:#F0B90B;">${pos.leverage || 20}x ${pos.margin_mode || 'ISOLATED'}</b></div>
            <div><span style="color:#848E9C;">Current PnL:</span> <b class="${pnlClass}">${pnlSign}$${(pos.net_pnl_usd || 0).toFixed(2)} (${pnlSign}${roe.toFixed(2)}%)</b></div>
            <div><span style="color:#848E9C;">Status / Reason:</span> <b style="color:#00F0FF;">${pos.status} (${pos.exit_reason || 'RUNNING'})</b></div>
            <div><span style="color:#848E9C;">Hold Duration:</span> <b style="color:#FFFFFF;">${durationStr}</b></div>
          </div>
        </div>
      </div>
    `;

    el.modalTradeDecision.classList.add('active');
  } catch (e) {
    console.error('Forensics load error:', e);
  }
}

// ── INTERACTIVE CHART VIEWER (STAT2 PRO BOX OVERLAY) ──
async function loadChartData() {
  const sym = el.chartSymbolSelect ? el.chartSymbolSelect.value : state.chart.symbol;
  const tf = el.chartTimeframeSelect ? el.chartTimeframeSelect.value : state.chart.timeframe;
  const mode = el.chartModeSelect ? el.chartModeSelect.value : state.chart.mode;

  try {
    const url = `/api/chart/${sym}/${tf}?strategyMode=${mode}`;
    const res = await fetch(url).then(r => r.json());
    if (res.success) {
      state.chart.symbol = sym;
      state.chart.timeframe = tf;
      state.chart.candles = res.candles || [];
      state.chart.calcResult = {
        cards: res.cards || [],
        atrData: res.atrData || [],
        liqList: res.liqList || [],
        fvgList: res.fvgList || []
      };

      if (res.candles && res.candles.length > 0) {
        const last = res.candles[res.candles.length - 1];
        const first = res.candles[0];
        const changePct = ((last.close - first.open) / first.open) * 100;
        const highs = res.candles.map(c => c.high);
        const lows = res.candles.map(c => c.low);
        const maxH = Math.max(...highs);
        const minL = Math.min(...lows);
        const totalVol = res.candles.reduce((s, c) => s + (c.volume || 0), 0);

        if (el.tickerSymbolName) el.tickerSymbolName.textContent = `${sym} Perpetual`;
        if (el.tickerMarkPrice) {
          el.tickerMarkPrice.textContent = formatPrice(last.close);
          el.tickerMarkPrice.style.color = changePct >= 0 ? '#0ECB81' : '#F6465D';
        }
        if (el.tickerChange24h) {
          const sign = changePct >= 0 ? '+' : '';
          el.tickerChange24h.className = `t-val ${changePct >= 0 ? 'green' : 'red'}`;
          el.tickerChange24h.textContent = `${sign}${changePct.toFixed(2)}%`;
        }
        if (el.tickerHigh24h) el.tickerHigh24h.textContent = formatPrice(maxH);
        if (el.tickerLow24h) el.tickerLow24h.textContent = formatPrice(minL);
        if (el.tickerVol24h) el.tickerVol24h.textContent = `${(totalVol / 1000).toFixed(2)}K`;
      }

      renderChartCanvas();
    }
  } catch (e) {
    console.error('Load Chart Error:', e);
  }
}

function getTfSeconds(tf) {
  if (!tf) return 300;
  if (tf === '1m') return 60;
  if (tf === '3m') return 180;
  if (tf === '5m') return 300;
  if (tf === '15m') return 900;
  if (tf === '30m') return 1800;
  if (tf === '1h') return 3600;
  if (tf === '4h') return 14400;
  if (tf === '1d') return 86400;
  return 300;
}

function renderChartCanvas() {
  const canvas = el.liveChartCanvas;
  if (!canvas || !el.chartViewport) return;

  const rect = el.chartViewport.getBoundingClientRect();
  const vWidth = Math.floor(rect.width || el.chartViewport.clientWidth || 360);
  const vHeight = Math.floor(rect.height || el.chartViewport.clientHeight || 380);

  // High DPI / Retina support for crisp rendering on mobile and PC
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(vWidth * dpr);
  canvas.height = Math.floor(vHeight * dpr);
  canvas.style.width = `${vWidth}px`;
  canvas.style.height = `${vHeight}px`;

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, vWidth, vHeight);

  const candles = state.chart.candles;
  if (!candles || candles.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Syncing live candles from Binance Futures...', vWidth / 2, vHeight / 2);
    ctx.restore();
    return;
  }

  // Calculate slice based on panOffset and visibleCount (Free Mode: Right Margin Offset enabled)
  const totalCount = candles.length;
  const vCount = Math.max(15, Math.min(state.chart.visibleCount || 90, totalCount));
  
  // Free Mode bounds: allow dragging to create right margin whitespace (down to -vCount * 0.85)
  const minPan = -Math.round(vCount * 0.85);
  const maxPan = Math.max(0, totalCount - 15);
  state.chart.panOffset = Math.max(minPan, Math.min(maxPan, state.chart.panOffset || 0));

  const isMobile = vWidth < 550;
  const rightAxisWidth = isMobile ? 68 : 88;
  const chartLeft = isMobile ? 6 : 14;
  const chartWidth = Math.max(100, vWidth - chartLeft - rightAxisWidth);
  const barW = Math.max(2, chartWidth / vCount);

  // Collect visible candles within viewport range
  const visibleCandles = [];
  for (let i = 0; i < totalCount; i++) {
    const slot = i - (totalCount - vCount - state.chart.panOffset);
    if (slot >= -1 && slot <= vCount + 1) {
      visibleCandles.push(candles[i]);
    }
  }

  if (visibleCandles.length === 0) {
    ctx.restore();
    return;
  }

  const fromTime = visibleCandles[0].time;
  const toTime = visibleCandles[visibleCandles.length - 1].time;

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const c of visibleCandles) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }
  const priceMargin = (maxPrice - minPrice) * 0.15 || 1;
  minPrice -= priceMargin;
  maxPrice += priceMargin;

  const priceRange = maxPrice - minPrice || 1;
  const chartHeight = Math.max(150, vHeight - 50);
  const chartTop = 12;
  const getY = (p) => chartTop + chartHeight - ((p - minPrice) / priceRange) * chartHeight;

  const tfSec = getTfSeconds(state.chart.timeframe);
  const getX = (time) => {
    if (time === null || time === undefined) return null;
    const idx = candles.findIndex(c => c.time === time);
    if (idx !== -1) {
      const slot = idx - (totalCount - vCount - state.chart.panOffset);
      return chartLeft + slot * barW + barW / 2;
    }
    // Future projection timestamp (e.g. extending lines into right whitespace)
    if (candles.length > 0 && time > candles[candles.length - 1].time) {
      const lastTime = candles[candles.length - 1].time;
      const futureSlots = (time - lastTime) / tfSec;
      const slot = (totalCount - 1 + futureSlots) - (totalCount - vCount - state.chart.panOffset);
      return chartLeft + slot * barW + barW / 2;
    }
    return null;
  };

  // 1. Draw Grid Lines & Y-Axis Prices
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = chartTop + i * (chartHeight / 6);
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartLeft + chartWidth, y);
    ctx.stroke();

    const priceAtY = maxPrice - (i / 6) * priceRange;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = 'left';
    ctx.fillText(formatPrice(priceAtY), chartLeft + chartWidth + 8, y + 3);
  }

  // 2. Draw Candlesticks
  for (let i = 0; i < totalCount; i++) {
    const slot = i - (totalCount - vCount - state.chart.panOffset);
    if (slot < -1 || slot > vCount + 1) continue;

    const c = candles[i];
    const x = chartLeft + slot * barW + barW / 2;
    const yOpen = getY(c.open);
    const yClose = getY(c.close);
    const yHigh = getY(c.high);
    const yLow = getY(c.low);

    const isBull = c.close >= c.open;
    const color = isBull ? '#10b981' : '#f43f5e';

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();

    ctx.fillStyle = color;
    const candleH = Math.max(2, Math.abs(yClose - yOpen));
    ctx.fillRect(x - (barW * 0.72) / 2, Math.min(yOpen, yClose), barW * 0.72, candleH);
  }

  // 3. Draw STAT2 Pro Box Strategy Indicator Overlay
  if (typeof Stat2BoxStrategyIndicator !== 'undefined' && state.chart.calcResult) {
    const style = {
      cardWidth: 230,
      showCards: true,
      showGuideLines: true,
      lineLength: 280,
      lineThickness: 2.0,
      showFVG: true,
      showLiquidity: true,
      showRibbon: true
    };
    const helpers = {
      candles: candles,
      visibleCandles: visibleCandles,
      fromTime: fromTime,
      toTime: toTime,
      rightViewportX: chartLeft + chartWidth,
      getX: getX,
      getY: getY,
      formatPrice: formatPrice
    };

    Stat2BoxStrategyIndicator.renderCanvas(ctx, state.chart.calcResult, style, helpers);
  }

  // 4. Draw Crosshair & Price/Time Tracker
  if (state.chart.crosshair && state.chart.crosshair.active && state.chart.crosshair.x !== null) {
    const cx = state.chart.crosshair.x;
    const cy = state.chart.crosshair.y;

    if (cx >= chartLeft && cx <= chartLeft + chartWidth && cy >= chartTop && cy <= chartTop + chartHeight) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
      ctx.lineWidth = 1;

      // Vertical crosshair
      ctx.beginPath();
      ctx.moveTo(cx, chartTop);
      ctx.lineTo(cx, chartTop + chartHeight);
      ctx.stroke();

      // Horizontal crosshair
      ctx.beginPath();
      ctx.moveTo(chartLeft, cy);
      ctx.lineTo(chartLeft + chartWidth, cy);
      ctx.stroke();
      ctx.restore();

      // Price Tag on Y-axis
      const crosshairPrice = maxPrice - ((cy - chartTop) / chartHeight) * priceRange;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(chartLeft + chartWidth + 2, cy - 9, 84, 18);
      ctx.fillStyle = '#020617';
      ctx.font = 'bold 10px "JetBrains Mono"';
      ctx.textAlign = 'left';
      ctx.fillText(formatPrice(crosshairPrice), chartLeft + chartWidth + 6, cy + 3);

      // Time Tag on X-axis
      const hoverBarIdx = Math.floor((cx - chartLeft) / barW);
      if (hoverBarIdx >= 0 && hoverBarIdx < visibleCandles.length) {
        const hoverCandle = visibleCandles[hoverBarIdx];
        const timeStr = new Date(hoverCandle.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const tw = ctx.measureText(timeStr).width + 12;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(cx - tw / 2, chartTop + chartHeight + 4, tw, 18);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '10px "JetBrains Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(timeStr, cx, chartTop + chartHeight + 16);

        // Update Top HUD Bar
        updateChartHud(hoverCandle);
      }
    }
  } else {
    // Show latest candle info on Top HUD Bar
    if (visibleCandles.length > 0) {
      updateChartHud(visibleCandles[visibleCandles.length - 1]);
    }
  }

  ctx.restore();
}

function updateChartHud(c) {
  if (!c) return;
  const isBull = c.close >= c.open;
  const changePct = ((c.close - c.open) / c.open * 100).toFixed(2);
  const color = isBull ? '#10b981' : '#f43f5e';
  const sign = isBull ? '+' : '';

  if (el.hudSymbol) el.hudSymbol.textContent = `${state.chart.symbol} ${state.chart.timeframe}`;
  if (el.hudOpen) el.hudOpen.textContent = formatPrice(c.open);
  if (el.hudHigh) el.hudHigh.textContent = formatPrice(c.high);
  if (el.hudLow) el.hudLow.textContent = formatPrice(c.low);
  if (el.hudClose) {
    el.hudClose.textContent = formatPrice(c.close);
    el.hudClose.style.color = color;
  }
  if (el.hudVol) el.hudVol.textContent = Number(c.volume || 0).toLocaleString();
  if (el.hudChange) {
    el.hudChange.innerHTML = `<span style="color: ${color}; font-weight:700;">${sign}${changePct}%</span>`;
  }
}

// ── UTILITIES ──
function formatPrice(p) {
  if (p === null || p === undefined || isNaN(p)) return '0.00';
  const val = Number(p);
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 1) return val.toFixed(4);
  return val.toFixed(6);
}

// ── EVENT LISTENERS INITIALIZATION ──
function initEventListeners() {
  // Main Tab Navigation
  el.menuTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.menuTabs.forEach(t => t.classList.remove('active'));
      el.tabPanels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(tab.dataset.tab);
      if (targetPanel) targetPanel.classList.add('active');
      state.activeTab = tab.dataset.tab;

      if (tab.dataset.tab === 'tabChart') {
        loadChartData();
        setTimeout(renderChartCanvas, 80);
      }
      if (tab.dataset.tab === 'tabLogs') {
        renderLogs();
      }
    });
  });

  // Subnav Navigation (Active Positions / Limit Orders / Closed History / Signals)
  if (el.subnavBtns) {
    el.subnavBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        el.subnavBtns.forEach(b => b.classList.remove('active'));
        el.subtabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        state.activeSubtab = btn.dataset.subtab;
        const target = document.getElementById(btn.dataset.subtab);
        if (target) target.classList.add('active');
      });
    });
  }

  // Manual Scan
  if (el.btnManualScan) {
    el.btnManualScan.addEventListener('click', async () => {
      el.btnManualScan.innerHTML = '<span>⏳ Scanning...</span>';
      await fetch('/api/scanner/trigger', { method: 'POST' });
      setTimeout(() => {
        el.btnManualScan.innerHTML = '<span>⚡ Scan Now</span>';
      }, 1200);
    });
  }

  // Toggle Scanner
  if (el.btnToggleScanner) {
    el.btnToggleScanner.addEventListener('click', async () => {
      await fetch('/api/scanner/toggle', { method: 'POST' });
      const res = await fetch('/api/status').then(r => r.json());
      if (res.success) {
        state.status = res.status;
        updateHeaderMetrics();
      }
    });
  }

  // Import Top 500 (5m & 15m)
  if (el.btnImportTop500) {
    el.btnImportTop500.addEventListener('click', async () => {
      if (!confirm('Start fetching and importing Top 500 Binance Futures pairs across 5m & 15m (1,000 strategies)?')) return;
      el.btnImportTop500.disabled = true;
      el.btnImportTop500.textContent = '⏳ Seeding Top 500...';
      const res = await fetch('/api/admin/import-top-500', { method: 'POST' }).then(r => r.json());
      if (res.success) {
        alert('🚀 Top 500 (1,000 strategies 5m/15m) import started in background! Check Live Console Logs tab for real-time progress.');
      }
      setTimeout(() => {
        el.btnImportTop500.disabled = false;
        el.btnImportTop500.textContent = '⚡ Re-Seed Top 500 (5m & 15m)';
      }, 5000);
    });
  }

  // Reset Trades & Signals ($1,000 Equity)
  const handleResetTrades = async () => {
    const ok = confirm('⚠️ BẠN CÓ CHẮC CHẮN MUỐN RESET TOÀN BỘ LỆNH & TÍN HIỆU?\n\n• Toàn bộ vị thế Active, Limit, Closed sẽ bị xóa.\n• Toàn bộ Signals Feed sẽ bị xóa.\n• Vốn tài khoản và PnL sẽ được đặt lại về $1,000.00 USD ban đầu.');
    if (!ok) return;

    try {
      const res = await fetch('/api/admin/reset-trades', { method: 'POST' }).then(r => r.json());
      if (res.success) {
        state.activePositions = [];
        state.closedPositions = [];
        state.limitOrders = [];
        state.signals = [];
        state.performance = {
          total_trades: 0,
          wins: 0,
          losses: 0,
          win_rate: 0,
          profit_factor: 0,
          net_profit_usd: 0,
          current_equity_usd: 1000.00
        };
        updateDashboardUI();
        alert('✅ ĐÃ RESET TOÀN BỘ LỆNH THÀNH CÔNG!\nSố dư tài khoản đã được khôi phục về $1,000.00 USD.');
      } else {
        alert(`❌ Lỗi reset: ${res.error}`);
      }
    } catch (err) {
      alert(`❌ Lỗi kết nối: ${err.message}`);
    }
  };

  if (el.btnResetOrdersAndPnL) el.btnResetOrdersAndPnL.addEventListener('click', handleResetTrades);
  if (el.btnResetTradesOnly) el.btnResetTradesOnly.addEventListener('click', handleResetTrades);

  // Full Database Factory Reset
  if (el.btnResetFactoryDb) {
    el.btnResetFactoryDb.addEventListener('click', async () => {
      const ok = confirm('⚠️ CẢNH BÁO: BẠN CÓ CHẮC CHẮN MUỐN FACTORY RESET TOÀN BỘ DATABASE?\n\n• Toàn bộ Database SQLite (Lệnh, Nến, Cài đặt) sẽ bị xóa trắng.\n• Hệ thống sẽ tự động tải lại Top 500 Symbol và 1.000 Chiến lược 5m/15m mới.');
      if (!ok) return;

      try {
        const res = await fetch('/api/admin/reset-all', { method: 'POST' }).then(r => r.json());
        if (res.success) {
          state.activePositions = [];
          state.closedPositions = [];
          state.limitOrders = [];
          state.signals = [];
          updateDashboardUI();
          alert('🚀 ĐÃ TIẾN HÀNH FACTORY RESET!\nHệ thống đang tự động nạp mới 500 Symbol Binance Futures ngầm. Bạn có thể theo dõi trong Tab Live Console Logs.');
        } else {
          alert(`❌ Lỗi reset: ${res.error}`);
        }
      } catch (err) {
        alert(`❌ Lỗi kết nối: ${err.message}`);
      }
    });
  }

  // Chart Controls
  if (el.chartSymbolSelect) el.chartSymbolSelect.addEventListener('change', loadChartData);
  if (el.chartTimeframeSelect) el.chartTimeframeSelect.addEventListener('change', loadChartData);
  if (el.chartModeSelect) el.chartModeSelect.addEventListener('change', loadChartData);
  if (el.btnReloadChart) el.btnReloadChart.addEventListener('click', loadChartData);

  if (el.btnResetChartZoom) {
    el.btnResetChartZoom.addEventListener('click', () => {
      state.chart.panOffset = 0;
      state.chart.visibleCount = 90;
      renderChartCanvas();
    });
  }

  // ── MOUSE PAN, ZOOM & CROSSHAIR LISTENERS ON CANVAS ──
  if (el.liveChartCanvas) {
    // 1. Mouse Down (Start Pan Drag or Click Card)
    el.liveChartCanvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left click
      const rect = el.liveChartCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Check if user clicked directly on a STAT2 Trade Card
      if (typeof Stat2BoxStrategyIndicator !== 'undefined') {
        const card = Stat2BoxStrategyIndicator.findCardAt(mouseX, mouseY);
        if (card) {
          openDecisionModalFromCard(card);
          return;
        }
      }

      // Start drag pan
      state.chart.isDragging = true;
      state.chart.dragStartX = e.clientX;
      state.chart.dragStartPan = state.chart.panOffset || 0;
      el.liveChartCanvas.style.cursor = 'grabbing';
    });

    // 2. Mouse Move (Drag Pan or Track Crosshair)
    el.liveChartCanvas.addEventListener('mousemove', (e) => {
      const rect = el.liveChartCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (state.chart.isDragging) {
        const deltaX = e.clientX - state.chart.dragStartX;
        const totalCount = state.chart.candles.length;
        const vCount = Math.min(state.chart.visibleCount || 90, totalCount);
        const chartWidth = el.liveChartCanvas.width - 95;
        const barW = Math.max(2, chartWidth / vCount);
        const barsMoved = Math.round(deltaX / barW);

        const minPan = -Math.round(vCount * 0.85);
        const maxPan = Math.max(0, totalCount - 15);
        state.chart.panOffset = Math.max(minPan, Math.min(maxPan, state.chart.dragStartPan + barsMoved));
        renderChartCanvas();
      } else {
        // Track Crosshair
        state.chart.crosshair.x = mouseX;
        state.chart.crosshair.y = mouseY;
        state.chart.crosshair.active = true;

        // Check if hovering over a trade card
        let isCardHover = false;
        if (typeof Stat2BoxStrategyIndicator !== 'undefined') {
          const card = Stat2BoxStrategyIndicator.findCardAt(mouseX, mouseY);
          if (card) isCardHover = true;
        }
        el.liveChartCanvas.style.cursor = isCardHover ? 'pointer' : 'crosshair';

        renderChartCanvas();
      }
    });

    // 3. Mouse Up & Mouse Leave (End Drag & Clear Crosshair)
    window.addEventListener('mouseup', () => {
      if (state.chart.isDragging) {
        state.chart.isDragging = false;
        if (el.liveChartCanvas) el.liveChartCanvas.style.cursor = 'crosshair';
      }
    });

    el.liveChartCanvas.addEventListener('mouseleave', () => {
      state.chart.crosshair.active = false;
      renderChartCanvas();
    });

    // 4. Mouse Wheel (Zoom In / Zoom Out)
    el.liveChartCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? 8 : -8;
      const curZoom = state.chart.visibleCount || 90;
      state.chart.visibleCount = Math.max(20, Math.min(450, curZoom + zoomDelta));
      renderChartCanvas();
    }, { passive: false });

    // 5. Mobile Touch Handlers (1-finger pan/tap & 2-finger pinch-zoom)
    let touchStartDist = 0;
    let touchStartZoom = 90;

    el.liveChartCanvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const rect = el.liveChartCanvas.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        const touchY = e.touches[0].clientY - rect.top;

        // Check card tap
        if (typeof Stat2BoxStrategyIndicator !== 'undefined') {
          const card = Stat2BoxStrategyIndicator.findCardAt(touchX, touchY);
          if (card) {
            openDecisionModal(card);
            return;
          }
        }

        state.chart.isDragging = true;
        state.chart.dragStartX = touchX;
        state.chart.dragStartPan = state.chart.panOffset || 0;
      } else if (e.touches.length === 2) {
        state.chart.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.sqrt(dx * dx + dy * dy);
        touchStartZoom = state.chart.visibleCount || 90;
      }
    }, { passive: true });

    el.liveChartCanvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && state.chart.isDragging) {
        const rect = el.liveChartCanvas.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        const dx = touchX - state.chart.dragStartX;
        const chartWidth = Math.max(100, (rect.width || 360) - 95);
        const barW = Math.max(2, chartWidth / (state.chart.visibleCount || 90));
        const barsMoved = Math.round(dx / barW);

        const totalCount = (state.chart.candles || []).length;
        const vCount = Math.max(15, Math.min(state.chart.visibleCount || 90, totalCount));
        const minPan = -Math.round(vCount * 0.85);
        const maxPan = Math.max(0, totalCount - 15);

        state.chart.panOffset = Math.max(minPan, Math.min(maxPan, state.chart.dragStartPan + barsMoved));
        renderChartCanvas();
      } else if (e.touches.length === 2 && touchStartDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const curDist = Math.sqrt(dx * dx + dy * dy);
        const scale = touchStartDist / curDist;
        const newZoom = Math.round(touchStartZoom * scale);
        state.chart.visibleCount = Math.max(20, Math.min(450, newZoom));
        renderChartCanvas();
      }
    }, { passive: true });

    el.liveChartCanvas.addEventListener('touchend', () => {
      state.chart.isDragging = false;
      touchStartDist = 0;
    });
  }

  // Window Resize Auto-Refit for PC, Tablet and Mobile
  window.addEventListener('resize', () => {
    if (state.activeTab === 'tabChart' || el.liveChartCanvas) {
      renderChartCanvas();
    }
  });

  // Settings Form Submit
  if (el.formBotSettings) {
    el.formBotSettings.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(el.formBotSettings);
      const payload = {};
      formData.forEach((v, k) => payload[k] = v);

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json());

      if (res.success) {
        state.settings = res.data;
        alert('✅ Configuration saved successfully!');
        updateHeaderMetrics();
      }
    });
  }

  // Modal: Add Symbol
  if (el.btnAddSymbolModalBtn) el.btnAddSymbolModalBtn.addEventListener('click', () => el.modalAddSymbol.classList.add('active'));
  if (el.btnCloseAddSymbolModal) el.btnCloseAddSymbolModal.addEventListener('click', () => el.modalAddSymbol.classList.remove('active'));
  if (el.btnCancelAddSymbol) el.btnCancelAddSymbol.addEventListener('click', () => el.modalAddSymbol.classList.remove('active'));

  if (el.btnConfirmAddSymbol) {
    el.btnConfirmAddSymbol.addEventListener('click', async () => {
      const sym = el.inputNewSymbol.value.trim().toUpperCase();
      const cat = el.selectNewCategory.value;
      if (!sym) return alert('Please enter a valid symbol!');

      await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, category: cat })
      });

      el.modalAddSymbol.classList.remove('active');
      el.inputNewSymbol.value = '';

      const res = await fetch('/api/whitelist').then(r => r.json());
      if (res.success) state.whitelist = res.data;
      renderWhitelist();
      updateHeaderMetrics();
      populateChartSymbolOptions();
    });
  }

  // Modal: Edit Strategy
  if (el.btnCloseEditStratModal) el.btnCloseEditStratModal.addEventListener('click', () => el.modalEditStrategy.classList.remove('active'));
  if (el.btnCancelEditStrat) el.btnCancelEditStrat.addEventListener('click', () => el.modalEditStrategy.classList.remove('active'));

  if (el.formEditStrategy) {
    el.formEditStrategy.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(el.formEditStrategy);
      const payload = {};
      formData.forEach((v, k) => payload[k] = v);

      await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      el.modalEditStrategy.classList.remove('active');
      const res = await fetch('/api/whitelist').then(r => r.json());
      if (res.success) state.whitelist = res.data;
      renderWhitelist();
    });
  }

  // Modal: Trade Decision
  if (el.btnCloseDecisionModal) el.btnCloseDecisionModal.addEventListener('click', () => el.modalTradeDecision.classList.remove('active'));

  // Log Filters
  if (el.logFilterBtns) {
    el.logFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        el.logFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.logFilter = btn.dataset.filter || 'ALL';
        renderLogs();
      });
    });
  }

  // Clear Logs
  if (el.btnClearLogs) {
    el.btnClearLogs.addEventListener('click', async () => {
      await fetch('/api/logs/clear', { method: 'POST' });
      state.logs = [];
      renderLogs();
      updateLogCounters();
    });
  }

  // Copy Logs
  if (el.btnCopyLogs) {
    el.btnCopyLogs.addEventListener('click', () => {
      if (!state.logs || state.logs.length === 0) return;
      const text = state.logs.map(l => `[${l.timestamp}] [${l.category}] ${l.message}`).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        el.btnCopyLogs.textContent = '✅ Copied!';
        setTimeout(() => el.btnCopyLogs.textContent = '📋 Copy', 1500);
      });
    });
  }

  // Auto-scroll toggle
  if (el.chkAutoScroll) {
    el.chkAutoScroll.addEventListener('change', () => {
      state.autoScrollLogs = el.chkAutoScroll.checked;
    });
  }

  // Window Resize
  window.addEventListener('resize', () => {
    if (state.activeTab === 'tabChart') renderChartCanvas();
  });
}

function openDecisionModalFromCard(card) {
  const isLong = card.tradeDir === 'BUY';
  const badgeTitle = card.signalType.startsWith('FADE') ? (isLong ? '⚡ FADE LONG' : '⚡ FADE SHORT') : (isLong ? '▲ BUY TREND' : '▼ SELL TREND');
  const badgeClass = card.tradeDir;

  el.modalDecisionBadge.className = `status-badge-lg sig-badge ${badgeClass}`;
  el.modalDecisionBadge.textContent = badgeTitle;
  el.modalDecisionSymbol.textContent = `${state.chart.symbol} • ${state.chart.timeframe}`;

  el.modalDecisionBody.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; background: #1e293b; padding: 12px; border-radius: 8px; text-align: center; font-family: var(--font-mono); margin-bottom: 16px;">
      <div>
        <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase;">Entry</div>
        <div style="color: #f8fafc; font-weight: 700; font-size: 13px; margin-top: 2px;">${formatPrice(card.entryPrice)}</div>
      </div>
      <div>
        <div style="color: #10b981; font-size: 10px; text-transform: uppercase;">TP1 (50%)</div>
        <div style="color: #10b981; font-weight: 700; font-size: 13px; margin-top: 2px;">${formatPrice(card.tp1Price)}</div>
      </div>
      <div>
        <div style="color: #06b6d4; font-size: 10px; text-transform: uppercase;">TP2 (Liq)</div>
        <div style="color: #06b6d4; font-weight: 700; font-size: 13px; margin-top: 2px;">${formatPrice(card.tp2Price)}</div>
      </div>
      <div>
        <div style="color: #f43f5e; font-size: 10px; text-transform: uppercase;">Stop Loss</div>
        <div style="color: #f43f5e; font-weight: 700; font-size: 13px; margin-top: 2px;">${formatPrice(card.slPrice)}</div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 12px; font-size: 13px; line-height: 1.6;">
      <div style="background: #111a2e; padding: 12px; border-radius: 8px; border-left: 3px solid #38bdf8;">
        <div style="font-weight: 700; color: #38bdf8; font-size: 12px; margin-bottom: 4px;">1️⃣ TẠI SAO CHỌN SIDE & ĐIỂM ENTRY?</div>
        <div style="color: #cbd5e1;">${card.sideRationale || 'Nến đóng cửa xác nhận xu hướng rõ nét, ATR đạt chuẩn biến động và vùng cản thông thoáng.'}</div>
      </div>

      <div style="background: #111a2e; padding: 12px; border-radius: 8px; border-left: 3px solid #10b981;">
        <div style="font-weight: 700; color: #10b981; font-size: 12px; margin-bottom: 4px;">2️⃣ TẠI SAO CHỐT LỜI TẠI TP1 & TP2?</div>
        <div style="color: #cbd5e1;">
          • <b>TP1 (${formatPrice(card.tp1Price)}):</b> Mép vùng FVG đối diện chưa lấp. 👉 <i>Tự động dời Stop-Loss về Hòa Vốn (Breakeven +0.05%) sau khi TP1 cắn.</i><br>
          • <b>TP2 (${formatPrice(card.tp2Price)}):</b> Cụm thanh khoản Liquidity Pool đối diện.
        </div>
      </div>

      <div style="background: #111a2e; padding: 12px; border-radius: 8px; border-left: 3px solid #f43f5e;">
        <div style="font-weight: 700; color: #f43f5e; font-size: 12px; margin-bottom: 4px;">3️⃣ TẠI SAO ĐẶT SL TẠI MỨC NÀY?</div>
        <div style="color: #cbd5e1;">${card.slRationale || 'Đặt dưới Swing Low/High gần nhất kèm biên độ an toàn, bảo vệ vị thế khỏi râu nến giật.'}</div>
      </div>

      <div style="background: #111a2e; padding: 12px; border-radius: 8px; border-left: 3px solid #f59e0b;">
        <div style="font-weight: 700; color: #f59e0b; font-size: 12px; margin-bottom: 4px;">4️⃣ CHỈ SỐ ĐỊNH LƯỢNG & RỦI RO:</div>
        <div style="color: #cbd5e1; font-family: var(--font-mono); font-size: 12px;">
          • Tỷ lệ Risk / Reward (R:R) : <b>1 : ${(card.rrRatio || 2.0).toFixed(2)}</b><br>
          • Động cơ Biến động ATR    : <b>${(card.atrPct || 0.5).toFixed(2)}%</b> (Đạt chuẩn > 0.35%)<br>
          • Thời gian Tín hiệu       : <b>${new Date(card.time * 1000).toLocaleString()}</b>
        </div>
      </div>
    </div>
  `;

  el.modalTradeDecision.classList.add('active');
}

// ── LOG RENDERING FUNCTIONS ──
function renderLogs() {
  if (!el.terminalLogBody) return;
  const filter = state.logFilter || 'ALL';
  const logs = state.logs || [];

  const filtered = filter === 'ALL'
    ? logs
    : logs.filter(l => l.category === filter || (filter === 'SIGNAL' && l.level === 'SIGNAL') || (filter === 'TRADE' && l.level === 'TRADE'));

  if (filtered.length === 0) {
    el.terminalLogBody.innerHTML = `
      <div style="color: #64748b; font-style: italic; padding: 20px; text-align: center;">
        No logs recorded for category [${filter}]. Live stream active...
      </div>
    `;
    updateLogCounters();
    return;
  }

  el.terminalLogBody.innerHTML = filtered.map(l => formatLogHtml(l)).join('');
  updateLogCounters();

  if (state.autoScrollLogs !== false && el.terminalLogContainer) {
    el.terminalLogContainer.scrollTop = el.terminalLogContainer.scrollHeight;
  }
}

function appendSingleLog(logItem) {
  if (!el.terminalLogBody) return;
  const filter = state.logFilter || 'ALL';
  const matchesFilter = filter === 'ALL' || logItem.category === filter || (filter === 'SIGNAL' && logItem.level === 'SIGNAL') || (filter === 'TRADE' && logItem.level === 'TRADE');

  if (matchesFilter) {
    if (el.terminalLogBody.children.length === 1 && el.terminalLogBody.children[0].style.fontStyle === 'italic') {
      el.terminalLogBody.innerHTML = '';
    }

    const row = document.createElement('div');
    row.innerHTML = formatLogHtml(logItem);
    el.terminalLogBody.appendChild(row.firstElementChild || row);

    if (state.autoScrollLogs !== false && el.terminalLogContainer) {
      el.terminalLogContainer.scrollTop = el.terminalLogContainer.scrollHeight;
    }
  }
}

function formatLogHtml(l) {
  const isSignal = l.level === 'SIGNAL';
  const isTrade = l.level === 'TRADE';
  const lvlClass = l.level || 'INFO';
  const msgClass = (isSignal || isTrade) ? 'log-msg highlight-signal' : 'log-msg';

  return `
    <div class="log-row">
      <span class="log-time">${l.timestamp}</span>
      <span class="log-pill ${lvlClass}">[${l.category || l.level}]</span>
      <span class="${msgClass}">${escapeHtml(l.message)}</span>
    </div>
  `;
}

function updateLogCounters() {
  const count = state.logs ? state.logs.length : 0;
  if (el.badgeLogCount) el.badgeLogCount.textContent = count;
  if (el.cntLogAll) el.cntLogAll.textContent = count;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── BOOTSTRAP ──
window.addEventListener('DOMContentLoaded', () => {
  initDom();
  initEventListeners();
  fetchInitialData();
  initWebSocket();
});
