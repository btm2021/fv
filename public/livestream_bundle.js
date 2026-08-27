const {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef
} = React;

// ── UTILITY FUNCTIONS ──
function formatPrice(val, decimals = 2) {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  const num = Number(val);
  if (Math.abs(num) < 0.0001) return num.toFixed(6);
  if (Math.abs(num) < 0.01) return num.toFixed(4);
  if (Math.abs(num) < 1.0) return num.toFixed(4);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}
function formatDate(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  return d.toLocaleString('vi-VN', {
    hour12: false
  });
}
function formatRelativeTime(ts) {
  if (!ts) return '--';
  const sec = Math.max(0, Math.floor((Date.now() - (ts < 10000000000 ? ts * 1000 : ts)) / 1000));
  if (sec < 5) return 'vừa xong';
  if (sec < 60) return `${sec}s trước`;
  if (sec < 3600) return `${Math.floor(sec / 60)}p trước`;
  return `${Math.floor(sec / 3600)}h trước`;
}

// ── GLOBAL ALL-MARKET BINANCE TICKERS STREAM (0MS WEBSOCKET) ──
const GlobalMarketStreamManager = {
  binanceWs: null,
  listeners: new Set(),
  cachedPrices: {},
  subscribe(listener) {
    this.listeners.add(listener);
    if (Object.keys(this.cachedPrices).length > 0) {
      listener(this.cachedPrices);
    }
    if (!this.binanceWs) this.initBinance();
    return () => this.listeners.delete(listener);
  },
  emit(updates) {
    const finalBatch = {};
    for (const [key, val] of Object.entries(updates)) {
      const prev = this.cachedPrices[key];
      const prevPrice = prev ? prev.price : val.price;
      let tickDir = 'equal';
      if (prev && val.price > prevPrice) tickDir = 'up';else if (prev && val.price < prevPrice) tickDir = 'down';else if (prev) tickDir = prev.tickDir || 'equal';
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
    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
      const arr = await res.json();
      if (Array.isArray(arr)) {
        const batch = {};
        for (let i = 0; i < arr.length; i++) {
          const t = arr[i];
          const p = parseFloat(t.lastPrice) || 0;
          const chg = parseFloat(t.priceChangePercent) || 0;
          const vol = parseFloat(t.quoteVolume) || 0;
          batch['BINANCE_' + t.symbol] = {
            price: p,
            change24h: chg,
            vol
          };
          batch[t.symbol] = {
            price: p,
            change24h: chg,
            vol
          };
        }
        this.emit(batch);
      }
    } catch (e) {}
  },
  initBinance() {
    this.fetchInitialSnapshot();
    try {
      const ws = new WebSocket('wss://fstream.binance.com/ws/!ticker@arr');
      this.binanceWs = ws;
      ws.onmessage = e => {
        try {
          const arr = JSON.parse(e.data);
          if (Array.isArray(arr)) {
            const batch = {};
            for (let i = 0; i < arr.length; i++) {
              const t = arr[i];
              const p = parseFloat(t.c) || 0;
              const chg = parseFloat(t.P) || 0;
              const vol = parseFloat(t.q) || 0;
              batch['BINANCE_' + t.s] = {
                price: p,
                change24h: chg,
                vol
              };
              batch[t.s] = {
                price: p,
                change24h: chg,
                vol
              };
            }
            this.emit(batch);
          }
        } catch (err) {}
      };
      ws.onclose = () => setTimeout(() => this.initBinance(), 4000);
    } catch (e) {}
  }
};

// ── DIRECT BROWSER-TO-BINANCE KLINE CLIENT ──
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
  async fetchCandles(symbol, timeframe = '5m') {
    return await this.fetchBinance(symbol, timeframe);
  },
  subscribeKline(symbol, timeframe, onTick) {
    let isClosed = false;
    const safeClose = () => {
      isClosed = true;
      try {
        if (rawWs) rawWs.close();
      } catch (e) {}
    };
    let rawWs = null;
    try {
      const sym = symbol.toLowerCase();
      rawWs = new WebSocket(`wss://fstream.binance.com/ws/${sym}@kline_${timeframe}`);
      rawWs.onmessage = e => {
        if (isClosed) return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.k) {
            const k = msg.k;
            onTick({
              time: Math.floor(k.t / 1000),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v)
            });
          }
        } catch (err) {}
      };
    } catch (e) {}
    return {
      close: safeClose,
      rawWs
    };
  }
};

// ── DEFAULT INDICATORS SPECIFICATION ──
const DEFAULT_INDICATOR_INSTANCES = [{
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
    orderType: 'MARKET',
    leverage: 20,
    marginMode: 'ISOLATED',
    riskPct: 1.0,
    tp1Ratio: 1.5,
    tp1ClosePct: 50,
    tp2Ratio: 3.0,
    autoBreakeven: true
  },
  styles: {
    bullishColor: '#10B981',
    bearishColor: '#F43F5E',
    neutralColor: '#F0B90B',
    boxOpacity: 0.18,
    showRationaleTooltip: true
  }
}, {
  id: 'inst_atrbot_1',
  type: 'atrbot',
  name: 'ATR Dynamic Bands',
  visible: true,
  inputs: {
    period: 14,
    multiplier: 2.0
  },
  styles: {
    upperColor: '#F0B90B',
    lowerColor: '#F0B90B',
    lineWidth: 1
  }
}, {
  id: 'inst_smc_1',
  type: 'smc',
  name: 'Smart Money Concepts',
  visible: true,
  inputs: {
    swingLookback: 20,
    fvgThreshold: 0.5
  },
  styles: {
    bslColor: '#10B981',
    sslColor: '#F43F5E',
    fvgBullColor: 'rgba(16, 185, 129, 0.15)',
    fvgBearColor: 'rgba(244, 63, 94, 0.15)'
  }
}];

// ── FULL EMBEDDED LIGHTWEIGHT CANDLE CHART COMPONENT ──
function FullStat2CandleChart({
  symbol,
  timeframe = '15m',
  exchange = 'BINANCE',
  onTfChange,
  instances = DEFAULT_INDICATOR_INSTANCES
}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (typeof LightweightCharts === 'undefined') return;
    const chart = LightweightCharts.createChart(chartContainerRef.current, {
      layout: {
        background: {
          color: '#080B11'
        },
        textColor: '#94A3B8',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace'
      },
      grid: {
        vertLines: {
          color: 'rgba(30, 41, 59, 0.4)'
        },
        horzLines: {
          color: 'rgba(30, 41, 59, 0.4)'
        }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: '#F0B90B',
          width: 1,
          style: 2
        },
        horzLine: {
          color: '#F0B90B',
          width: 1,
          style: 2
        }
      },
      timeScale: {
        borderColor: '#1E293B',
        timeVisible: true,
        secondsVisible: false
      },
      rightPriceScale: {
        borderColor: '#1E293B',
        autoScale: true
      }
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#F43F5E',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#F43F5E'
    });
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: {
        type: 'volume'
      },
      priceScaleId: '',
      scaleMargins: {
        top: 0.82,
        bottom: 0
      }
    });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Load initial candles
    let isCancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const candles = await DirectExchangeClient.fetchCandles(symbol, timeframe);
        if (!isCancelled && candles && candles.length > 0) {
          candleSeries.setData(candles.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
          })));
          volumeSeries.setData(candles.map(c => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'
          })));
          chart.timeScale().fitContent();
        }
      } catch (e) {} finally {
        if (!isCancelled) setLoading(false);
      }
    }
    loadData();

    // Subscribe live kline
    const sub = DirectExchangeClient.subscribeKline(symbol, timeframe, kline => {
      if (isCancelled) return;
      candleSeries.update({
        time: kline.time,
        open: kline.open,
        high: kline.high,
        low: kline.low,
        close: kline.close
      });
      volumeSeries.update({
        time: kline.time,
        value: kline.volume,
        color: kline.close >= kline.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'
      });
    });
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      isCancelled = true;
      sub.close();
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [symbol, timeframe]);
  return /*#__PURE__*/React.createElement("div", {
    className: "w-full h-full flex flex-col relative bg-[#080B11]"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between p-2 bg-[#0C101A] border-b border-[#1E293B] shrink-0 font-mono text-xs"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-white text-xs"
  }, symbol), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-binance-yellow bg-binance-active px-1.5 py-0.2 rounded font-bold"
  }, exchange)), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-1"
  }, ['1m', '5m', '15m', '1h', '4h', '1d'].map(tf => /*#__PURE__*/React.createElement("button", {
    key: tf,
    className: `px-2 py-0.5 rounded text-[10px] font-bold transition ${timeframe === tf ? 'bg-binance-yellow text-black' : 'text-slate-400 hover:text-white bg-[#151C2C]'}`,
    onClick: () => onTfChange && onTfChange(tf)
  }, tf)))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 relative",
    ref: chartContainerRef
  }, loading && /*#__PURE__*/React.createElement("div", {
    className: "absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-10 text-xs font-mono text-binance-yellow"
  }, /*#__PURE__*/React.createElement("span", {
    className: "animate-spin mr-2"
  }, "⚡"), " Đang tải nến và chỉ báo trực tiếp từ Binance...")));
}

// ── FULL 1:1 DEEP QUANTITATIVE ORDER & TRADE FORENSICS INTELLIGENCE MODAL ──
function OrderForensicsModal({
  data,
  marketPrices = {},
  onClose,
  onClosePosition
}) {
  if (!data) return null;
  const [activeSection, setActiveSection] = useState('sec-flow');
  const [modalTf, setModalTf] = useState(data.timeframe || data.tf || '15m');
  const scrollContainerRef = useRef(null);

  // Trade Notes Persistence
  const [tradeNote, setTradeNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [saveNoteSuccess, setSaveNoteSuccess] = useState(false);
  const isLong = data.direction === 'BUY' || data.signal_type && data.signal_type.includes('BUY') || data.side && data.side.toUpperCase() === 'BUY' || data.direction === 'LONG';
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
    return () => {
      isCancelled = true;
    };
  }, [targetId]);
  const handleSaveNote = async () => {
    setIsSavingNote(true);
    try {
      await fetch(`/api/notes/${targetId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          symbol,
          note_text: tradeNote
        })
      });
      setSaveNoteSuccess(true);
      setTimeout(() => setSaveNoteSuccess(false), 2500);
    } catch (err) {} finally {
      setIsSavingNote(false);
    }
  };

  // Realtime Market Price resolution
  const pKey1 = `${exchange}_${symbol}`;
  const pKey2 = symbol;
  const livePriceObj = marketPrices[pKey1] || marketPrices[pKey2] || {};
  const currentPrice = livePriceObj.price || data.current_price || data.entry_price || 0;

  // Targets
  const entryPrice = parseFloat(data.entry_price || data.price || currentPrice) || 1;
  const tp1Price = parseFloat(data.tp1_price || (isLong ? entryPrice * 1.015 : entryPrice * 0.985));
  const tp2Price = parseFloat(data.tp2_price || (isLong ? entryPrice * 1.035 : entryPrice * 0.965));
  const slPrice = parseFloat(data.sl_price || (isLong ? entryPrice * 0.988 : entryPrice * 1.012));
  const leverage = parseInt(data.leverage) || 20;
  const marginUsed = parseFloat(data.initial_margin || data.margin_used || data.margin || 100);
  const posSizeUsd = parseFloat(data.pos_size_usd) || marginUsed * leverage;

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
  const rrRatio = slMovePct > 0 ? tp1MovePct / slMovePct : 2.0;

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
    unPnlPct = data.roe_pct !== undefined ? data.roe_pct : marginUsed > 0 ? unPnlUsd / marginUsed * 100 : 0;
  }

  // Progress to TP1
  let progressPct = 0;
  if (isLong) {
    if (currentPrice >= tp1Price) progressPct = 100;else if (currentPrice <= slPrice) progressPct = 0;else progressPct = Math.max(0, Math.min(100, (currentPrice - entryPrice) / (tp1Price - entryPrice) * 100));
  } else {
    if (currentPrice <= tp1Price) progressPct = 100;else if (currentPrice >= slPrice) progressPct = 0;else progressPct = Math.max(0, Math.min(100, (entryPrice - currentPrice) / (entryPrice - tp1Price) * 100));
  }
  const isActive = data.id && data.status === 'ACTIVE';
  const navItems = [{
    id: 'sec-flow',
    icon: '🧠',
    label: '1. Flow Phân Tích & Rationale',
    desc: 'Logic kích hoạt & bộ lọc 4 bước'
  }, {
    id: 'sec-targets',
    icon: '🎯',
    label: '2. Mốc Giá, PnL & Quản Lý Size',
    desc: 'Entry, TP, SL & Báo Cáo Sizing'
  }, {
    id: 'sec-status',
    icon: '⚡',
    label: '3. Tình Trạng Lệnh Thực Tế',
    desc: 'Tiến trình TP1 & PnL Realtime'
  }, {
    id: 'sec-smc',
    icon: '📐',
    label: '4. Cấu Trúc Smart Money',
    desc: 'Thanh khoản BSL/SSL & FVG'
  }, {
    id: 'sec-chart',
    icon: '📊',
    label: `5. ${symbol} • ${modalTf} Chart`,
    desc: 'Biểu đồ nến & bộ công cụ vẽ'
  }, {
    id: 'sec-notes',
    icon: '📝',
    label: '6. Ghi Chú Lệnh (Trade Journal)',
    desc: 'Lưu ghi chú cá nhân vào DB'
  }, {
    id: 'sec-engine',
    icon: '📜',
    label: '7. Thông Số Thuật Toán & Audit',
    desc: 'ID, thời gian & cài đặt bảo mật'
  }];
  const handleNavClick = (e, id) => {
    e.preventDefault();
    setActiveSection(id);
    const target = document.getElementById(id);
    if (target && scrollContainerRef.current) {
      const topOffset = target.offsetTop - scrollContainerRef.current.offsetTop - 8;
      scrollContainerRef.current.scrollTo({
        top: Math.max(0, topOffset),
        behavior: 'smooth'
      });
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4 md:p-6 select-none font-sans",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "bg-binance-panel border border-binance-borderHighlight rounded-2xl w-full max-w-6xl xl:max-w-7xl h-[92vh] flex flex-col overflow-hidden shadow-2xl text-xs",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 border-b border-binance-border bg-binance-subpanel flex flex-wrap items-center justify-between gap-3 shrink-0"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: `px-2.5 py-1 rounded font-black text-xs font-mono shadow ${isLong ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-rose-950 text-rose-400 border border-rose-500/40'}`
  }, isLong ? '▲ LONG / BUY' : '▼ SHORT / SELL'), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 font-extrabold text-sm text-white"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-base tracking-wide font-mono"
  }, symbol), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-400 bg-binance-card px-2 py-0.5 rounded border border-binance-borderSubtle font-mono"
  }, exchange, " • ", leverage, "x ISOLATED • ", modalTf)), /*#__PURE__*/React.createElement("span", {
    className: "hidden sm:inline-block bg-binance-active text-binance-yellow text-[10.5px] px-2.5 py-0.5 rounded font-bold border border-binance-yellow/30 font-mono tracking-wide"
  }, data.strategy_name || data.signal_type || 'STAT2 VIDYA + SMC QUANTITATIVE ENGINE')), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 bg-binance-card/80 px-3 py-1 rounded border border-binance-borderSubtle font-mono"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 text-[10px] font-semibold uppercase"
  }, "MARK:"), /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-white text-xs"
  }, "$", formatPrice(currentPrice)), /*#__PURE__*/React.createElement("span", {
    className: `font-bold text-xs ${unPnlUsd >= 0 ? 'text-binance-green' : 'text-binance-red'}`
  }, "(", unPnlUsd >= 0 ? '+' : '', "$", formatPrice(unPnlUsd), " / ", unPnlPct >= 0 ? '+' : '', unPnlPct.toFixed(2), "%)")), /*#__PURE__*/React.createElement("button", {
    className: "text-slate-400 hover:text-white text-base font-bold w-7 h-7 flex items-center justify-center rounded bg-binance-card hover:bg-binance-hover border border-binance-border transition",
    onClick: onClose,
    title: "Đóng Hộp Thoại"
  }, "✕"))), /*#__PURE__*/React.createElement("div", {
    className: "flex-1 flex overflow-hidden"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "w-60 sm:w-72 bg-binance-subpanel/80 border-r border-binance-border flex flex-col justify-between shrink-0 p-3 overflow-y-auto font-sans"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex flex-col gap-1.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-400 font-bold uppercase tracking-wider px-2 pb-1 flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", null, "📑"), /*#__PURE__*/React.createElement("span", null, "MỤC LỤC PHÂN TÍCH")), navItems.map(item => /*#__PURE__*/React.createElement("a", {
    key: item.id,
    href: `#${item.id}`,
    onClick: e => handleNavClick(e, item.id),
    className: `px-3 py-2.5 rounded-lg flex flex-col gap-0.5 transition border ${activeSection === item.id ? 'bg-binance-card border-binance-yellow text-binance-yellow shadow-md' : 'border-transparent text-slate-400 hover:text-white hover:bg-binance-card/50'}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 font-bold text-xs"
  }, /*#__PURE__*/React.createElement("span", null, item.icon), /*#__PURE__*/React.createElement("span", {
    className: activeSection === item.id ? 'text-white' : ''
  }, item.label)), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-400 pl-5 font-medium"
  }, item.desc)))), /*#__PURE__*/React.createElement("div", {
    className: "p-3 bg-binance-card rounded-lg border border-binance-border flex flex-col gap-2 mt-4 text-[11px] font-mono shadow-inner"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] font-bold text-slate-300 uppercase border-b border-binance-border pb-1 tracking-wider flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("span", null, "TỔNG QUAN RỦI RO & LỢI NHUẬN"), /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow"
  }, "USD & ROI")), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Tỷ Lệ R:R:"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-yellow font-bold"
  }, "1 : ", rrRatio.toFixed(2))), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Lợi Nhuận TP1:"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-green font-bold"
  }, "+$", formatPrice(tp1Usd), " (+", tp1Roi.toFixed(1), "%)")), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Lợi Nhuận TP2:"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-green font-bold"
  }, "+$", formatPrice(tp2Usd), " (+", tp2Roi.toFixed(1), "%)")), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between items-center"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Rủi Ro SL:"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-red font-bold"
  }, "-$", formatPrice(slUsd), " (-", slLossPct.toFixed(1), "%)")))), /*#__PURE__*/React.createElement("main", {
    ref: scrollContainerRef,
    className: "flex-1 p-4 sm:p-6 overflow-y-auto flex flex-col gap-6 bg-binance-panel"
  }, /*#__PURE__*/React.createElement("section", {
    id: "sec-flow",
    className: "flex flex-col gap-3.5 scroll-mt-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between border-b border-binance-border pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow"
  }, "🧠"), /*#__PURE__*/React.createElement("span", null, "1. FLOW PHÂN TÍCH ĐỘNG LƯỢNG & RATIONALE (AI FORENSICS)")), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] bg-binance-card text-slate-300 px-2.5 py-0.5 rounded font-bold border border-binance-border font-mono"
  }, "SMC + ATR FLOW")), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 md:grid-cols-2 gap-3.5 font-sans"
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-white text-xs border-b border-binance-border pb-1 uppercase tracking-wider flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", null, "💡"), /*#__PURE__*/React.createElement("span", null, "Bối Cảnh Thị Trường (Market Regime)")), /*#__PURE__*/React.createElement("div", {
    className: "text-[11.5px] text-slate-300 leading-relaxed"
  }, data.market_regime || 'Thị trường đang trong xu hướng mạnh mẽ với động lượng CMO 14 đồng thuận và biến động ATR nằm trong ngưỡng an toàn.')), /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-white text-xs border-b border-binance-border pb-1 uppercase tracking-wider flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", null, "⚡"), /*#__PURE__*/React.createElement("span", null, "Lý Do Vào Lệnh (Entry Rationale)")), /*#__PURE__*/React.createElement("div", {
    className: "text-[11.5px] text-slate-300 leading-relaxed"
  }, data.entry_rationale || data.side_rationale || 'Phát hiện cấu trúc phá vỡ thanh khoản và kiểm định vùng mất cân bằng Fair Value Gap thành công.')))), /*#__PURE__*/React.createElement("section", {
    id: "sec-targets",
    className: "flex flex-col gap-3.5 scroll-mt-4 font-mono"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between border-b border-binance-border pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide font-sans"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow"
  }, "🎯"), /*#__PURE__*/React.createElement("span", null, "2. MỐC GIÁ MỤC TIÊU, PNL KỲ VỌNG & QUẢN LÝ VỐN")), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-400 font-mono"
  }, "RISK REWARD 1 : ", rrRatio.toFixed(2))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 sm:grid-cols-4 gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 text-[10px] uppercase font-bold"
  }, "GIÁ ENTRY VÀO LỆNH"), /*#__PURE__*/React.createElement("span", {
    className: "text-base font-black text-white"
  }, "$", formatPrice(entryPrice)), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-400"
  }, "Vốn Margin: $", formatPrice(marginUsed))), /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 bg-binance-card rounded-xl border border-emerald-500/30 bg-emerald-950/10 flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-emerald-400 text-[10px] uppercase font-bold"
  }, "CHỐT LỜI 1 (TP1)"), /*#__PURE__*/React.createElement("span", {
    className: "text-base font-black text-binance-green"
  }, "$", formatPrice(tp1Price)), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-emerald-400"
  }, "+", tp1Roi.toFixed(1), "% ROE (+$", formatPrice(tp1Usd), ")")), /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 bg-binance-card rounded-xl border border-emerald-500/30 bg-emerald-950/10 flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-emerald-400 text-[10px] uppercase font-bold"
  }, "CHỐT LỜI 2 (TP2)"), /*#__PURE__*/React.createElement("span", {
    className: "text-base font-black text-binance-green"
  }, "$", formatPrice(tp2Price)), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-emerald-400"
  }, "+", tp2Roi.toFixed(1), "% ROE (+$", formatPrice(tp2Usd), ")")), /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 bg-binance-card rounded-xl border border-rose-500/30 bg-rose-950/10 flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-rose-400 text-[10px] uppercase font-bold"
  }, "CẮT LỖ (STOP LOSS)"), /*#__PURE__*/React.createElement("span", {
    className: "text-base font-black text-binance-red"
  }, "$", formatPrice(slPrice)), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-rose-400"
  }, "-", slLossPct.toFixed(1), "% ROE (-$", formatPrice(slUsd), ")")))), /*#__PURE__*/React.createElement("section", {
    id: "sec-status",
    className: "flex flex-col gap-3.5 scroll-mt-4 font-mono"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between border-b border-binance-border pb-2 font-sans"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow"
  }, "⚡"), /*#__PURE__*/React.createElement("span", null, "3. TÌNH TRẠNG THỰC TẾ & TIẾN TRÌNH LỆNH")), /*#__PURE__*/React.createElement("span", {
    className: `px-2.5 py-0.5 rounded text-[10px] font-bold ${isActive ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/40' : 'bg-binance-card text-slate-400'}`
  }, isActive ? '⚡ VỊ THẾ ĐANG HOẠT ĐỘNG' : data.exit_reason || data.status || 'ĐÃ ĐÓNG')), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 text-xs font-bold"
  }, "Tiến trình đạt mục tiêu TP1:"), /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow font-bold text-xs"
  }, progressPct.toFixed(1), "%")), /*#__PURE__*/React.createElement("div", {
    className: "w-full bg-binance-bg rounded-full h-3 overflow-hidden border border-binance-borderSubtle"
  }, /*#__PURE__*/React.createElement("div", {
    className: "h-full bg-gradient-to-r from-binance-yellow to-binance-green transition-all duration-300",
    style: {
      width: `${progressPct}%`
    }
  })))), /*#__PURE__*/React.createElement("section", {
    id: "sec-smc",
    className: "flex flex-col gap-3.5 scroll-mt-4 font-sans"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between border-b border-binance-border pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow"
  }, "📐"), /*#__PURE__*/React.createElement("span", null, "4. CẤU TRÚC THANH KHOẢN SMART MONEY CONCEPTS"))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 md:grid-cols-2 gap-3.5"
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-white text-xs border-b border-binance-border pb-1 uppercase tracking-wider"
  }, "THANH KHOẢN BSL / SSL"), /*#__PURE__*/React.createElement("div", {
    className: "text-[11.5px] text-slate-300 leading-relaxed"
  }, "• ", /*#__PURE__*/React.createElement("b", null, "Vùng Thanh Khoản:"), " ", isLong ? 'Sell-Side Liquidity (SSL) đã được quét cạn' : 'Buy-Side Liquidity (BSL) đã được quét cạn', ".", /*#__PURE__*/React.createElement("br", null), "• ", /*#__PURE__*/React.createElement("b", null, "Động Lượng CMO:"), " ", data.cmo_val ? Number(data.cmo_val).toFixed(1) : '+24.5', " (Xác nhận dòng tiền đảo chiều mạnh).")), /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-white text-xs border-b border-binance-border pb-1 uppercase tracking-wider"
  }, "MẤT CÂN BẰNG FAIR VALUE GAP (FVG)"), /*#__PURE__*/React.createElement("div", {
    className: "text-[11.5px] text-slate-300 leading-relaxed"
  }, "• ", /*#__PURE__*/React.createElement("b", null, "Vùng FVG:"), " ", isLong ? 'Bullish FVG retest thành công' : 'Bearish FVG retest thành công', ".", /*#__PURE__*/React.createElement("br", null), "• ", /*#__PURE__*/React.createElement("b", null, "Biến Động ATR%:"), " ", data.atr_pct ? Number(data.atr_pct).toFixed(2) : '0.65', "% (Biến động lý tưởng cho đòn bẩy ", leverage, "x).")))), /*#__PURE__*/React.createElement("section", {
    id: "sec-chart",
    className: "flex flex-col gap-3.5 scroll-mt-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between border-b border-binance-border pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide font-sans"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow"
  }, "📊"), /*#__PURE__*/React.createElement("span", null, "5. ", symbol, " • ", exchange, " • ", modalTf, " Chart Trực Tiếp")), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] bg-binance-yellow/20 text-binance-yellow px-2.5 py-0.5 rounded font-bold border border-binance-yellow/30 font-mono"
  }, "LIVE BINANCE WEBSOCKET")), /*#__PURE__*/React.createElement("div", {
    className: "w-full h-[400px] bg-[#080B11] border border-binance-border rounded-xl overflow-hidden shadow-xl flex flex-col relative"
  }, /*#__PURE__*/React.createElement(FullStat2CandleChart, {
    symbol: symbol,
    timeframe: modalTf,
    exchange: exchange,
    onTfChange: setModalTf,
    instances: DEFAULT_INDICATOR_INSTANCES
  }))), /*#__PURE__*/React.createElement("section", {
    id: "sec-notes",
    className: "flex flex-col gap-3.5 scroll-mt-4 font-sans"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between border-b border-binance-border pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow"
  }, "📝"), /*#__PURE__*/React.createElement("span", null, "6. GHI CHÚ VÀO LỆNH & NHẬT KÝ GIAO DỊCH (TRADE JOURNAL)")), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-400 font-mono"
  }, "AUTO-SYNCED TO DB")), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between"
  }, /*#__PURE__*/React.createElement("label", {
    className: "font-bold text-white text-xs flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", null, "✍️"), /*#__PURE__*/React.createElement("span", null, "Ghi chú cá nhân cho lệnh ", symbol, " (", exchange, "):")), saveNoteSuccess && /*#__PURE__*/React.createElement("span", {
    className: "text-[11px] text-binance-green font-bold flex items-center gap-1"
  }, /*#__PURE__*/React.createElement("span", null, "✅"), /*#__PURE__*/React.createElement("span", null, "Đã lưu thành công vào DB!"))), /*#__PURE__*/React.createElement("textarea", {
    className: "w-full h-24 p-3 bg-binance-panel border border-binance-borderSubtle rounded-lg text-white font-mono text-xs focus:outline-none focus:border-binance-yellow transition resize-none placeholder-slate-500",
    placeholder: "Nhập ghi chú quan sát, tâm lý giao dịch hoặc lý do quản lý lệnh này...",
    value: tradeNote,
    onChange: e => setTradeNote(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between pt-1 font-mono"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-400"
  }, "Độ dài: ", tradeNote.length, " ký tự"), /*#__PURE__*/React.createElement("button", {
    className: "bg-binance-yellow hover:bg-binance-yellowHover text-black font-bold px-4 py-1.5 rounded-lg text-xs transition shadow flex items-center gap-1.5",
    onClick: handleSaveNote,
    disabled: isSavingNote
  }, /*#__PURE__*/React.createElement("span", null, isSavingNote ? '⏳' : '💾'), /*#__PURE__*/React.createElement("span", null, isSavingNote ? 'Đang lưu...' : 'Lưu Ghi Chú'))))), /*#__PURE__*/React.createElement("section", {
    id: "sec-engine",
    className: "flex flex-col gap-3.5 scroll-mt-4 font-mono"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between border-b border-binance-border pb-2 font-sans"
  }, /*#__PURE__*/React.createElement("span", {
    className: "font-extrabold text-sm text-slate-100 flex items-center gap-2 uppercase tracking-wide"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow"
  }, "📜"), /*#__PURE__*/React.createElement("span", null, "7. THÔNG SỐ KỸ THUẬT & AUDIT TRAIL")), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] text-slate-400 font-mono"
  }, "SECURITY AUDIT")), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-binance-card rounded-xl border border-binance-border flex flex-col gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 block text-[10px] uppercase font-bold tracking-wider"
  }, "ID LỆNH / SIGNAL"), /*#__PURE__*/React.createElement("b", {
    className: "text-white"
  }, data.id || 'SIG_' + (data.timestamp || Date.now()))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 block text-[10px] uppercase font-bold tracking-wider"
  }, "THỜI GIAN"), /*#__PURE__*/React.createElement("b", {
    className: "text-white"
  }, formatDate(data.open_time || data.created_at || data.timestamp))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 block text-[10px] uppercase font-bold tracking-wider"
  }, "CHIẾN LƯỢC"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-yellow"
  }, data.strategy_name || 'STAT2 Pro Box')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 block text-[10px] uppercase font-bold tracking-wider"
  }, "BẢO VỆ VỐN"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-green"
  }, "Auto Breakeven"))))))), /*#__PURE__*/React.createElement("div", {
    className: "p-3.5 border-t border-binance-border flex items-center justify-between bg-binance-subpanel shrink-0 font-mono"
  }, /*#__PURE__*/React.createElement("div", null, isActive && onClosePosition && /*#__PURE__*/React.createElement("button", {
    className: "bg-binance-red hover:bg-red-600 text-white font-bold px-4 py-1.5 rounded-lg text-xs transition shadow flex items-center gap-1 font-sans",
    onClick: () => {
      onClosePosition(data.id);
      onClose();
    }
  }, "✕ Đóng Vị Thế Ngay (Market Close)")), /*#__PURE__*/React.createElement("button", {
    className: "bg-binance-card hover:bg-binance-hover px-5 py-1.5 rounded-lg text-xs font-bold text-white border border-binance-border transition",
    onClick: onClose
  }, "Đóng"))));
}

// ── TABLE HEADER CELL COMPONENT WITH INTERACTIVE SORTING ──
function SortableHeader({
  title,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = 'left',
  className = ''
}) {
  const isActive = currentKey === sortKey;
  return /*#__PURE__*/React.createElement("th", {
    className: `py-2.5 px-3 whitespace-nowrap select-none transition-colors border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold tracking-wider cursor-pointer hover:bg-[#151D2F] hover:text-binance-yellow ${isActive ? 'text-binance-yellow' : 'text-slate-400'} ${align === 'right' ? 'text-right' : 'text-left'} ${className}`,
    onClick: () => onSort(sortKey)
  }, /*#__PURE__*/React.createElement("div", {
    className: `inline-flex items-center gap-1 ${align === 'right' ? 'justify-end w-full' : ''}`
  }, /*#__PURE__*/React.createElement("span", null, title), /*#__PURE__*/React.createElement("span", {
    className: "text-[9px] opacity-70"
  }, isActive ? currentDir === 'asc' ? '▲' : '▼' : '⇅')));
}

// ── MAIN LIVESTREAM TRACKER APPLICATION (REAL-TIME WEBSOCKET SYNC) ──
function LivestreamApp() {
  const [activeTab, setActiveTab] = useState('positions'); // positions, orders, signals, history, journal
  const [isStreamMode, setIsStreamMode] = useState(false); // OBS Studio compact broadcast mode
  const [searchQuery, setSearchQuery] = useState('');

  // Sorting States
  const [posSort, setPosSort] = useState({
    key: 'time',
    dir: 'desc'
  });
  const [ordSort, setOrdSort] = useState({
    key: 'time',
    dir: 'desc'
  });
  const [sigSort, setSigSort] = useState({
    key: 'time',
    dir: 'desc'
  });
  const [histSort, setHistSort] = useState({
    key: 'time',
    dir: 'desc'
  });

  // Data States
  const [activePositions, setActivePositions] = useState([]);
  const [limitOrders, setLimitOrders] = useState([]);
  const [signals, setSignals] = useState([]);
  const [closedPositions, setClosedPositions] = useState([]);
  const [performance, setPerformance] = useState({});
  const [marketPrices, setMarketPrices] = useState({});
  const [timeStr, setTimeStr] = useState('');
  const [wsStatus, setWsStatus] = useState('connecting'); // 'connected', 'connecting', 'disconnected'

  // Forensics Modal State
  const [selectedForensics, setSelectedForensics] = useState(null);

  // Subscribe to live browser MiniTickers
  useEffect(() => {
    const unsub = GlobalMarketStreamManager.subscribe(prices => {
      setMarketPrices(prev => ({
        ...prev,
        ...prices
      }));
    });
    return () => unsub();
  }, []);

  // Update Clock
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('vi-VN', {
        hour12: false
      }) + ' UTC+7');
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Initial Data Fetch Function
  const fetchData = useCallback(async () => {
    try {
      const [resStatus, resSig, resPos] = await Promise.all([fetch('/api/status?exchange=BINANCE').then(r => r.json()), fetch('/api/signals?limit=150&exchange=BINANCE').then(r => r.json()), fetch('/api/positions?exchange=BINANCE').then(r => r.json())]);
      if (resStatus.success && resStatus.data) {
        setPerformance(resStatus.data.performance || {});
        setActivePositions(resStatus.data.active_positions || []);
      }
      if (resSig.success && Array.isArray(resSig.data)) {
        setSignals(resSig.data);
        setLimitOrders(resSig.data.filter(s => s.signal_type && s.signal_type.startsWith('FADE')).slice(0, 30));
      }
      if (resPos.success && Array.isArray(resPos.data)) {
        setClosedPositions(resPos.data.filter(p => p.status !== 'ACTIVE'));
      }
    } catch (e) {}
  }, []);

  // ── WEBSOCKET REAL-TIME CONNECTION (ZERO CONTINUOUS HTTP POLLING) ──
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const connectWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        setWsStatus('connected');
        fetchData(); // Sync once on connect
      };
      ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data);
          const type = msg.type;
          const data = msg.data;
          if (type === 'POSITIONS_UPDATE') {
            if (data.active) setActivePositions(data.active);
            if (data.stats) setPerformance(data.stats);
            if (data.all) setClosedPositions(data.all.filter(p => p.status !== 'ACTIVE'));
          } else if (type === 'SIGNALS_UPDATE') {
            if (data.signals) {
              setSignals(data.signals);
              setLimitOrders((data.signals || []).filter(s => s.signal_type && s.signal_type.startsWith('FADE')).slice(0, 30));
            }
          } else if (type === 'NEW_SIGNAL') {
            setSignals(prev => [data, ...prev.filter(s => s.id !== data.id)].slice(0, 150));
            if (data.signal_type && data.signal_type.startsWith('FADE')) {
              setLimitOrders(prev => [data, ...prev.filter(s => s.id !== data.id)].slice(0, 30));
            }
          } else if (type === 'POSITION_CLOSED' || type === 'STATUS_UPDATE' || type === 'SERVER_REBOOT') {
            fetchData();
          }
        } catch (e) {}
      };
      ws.onclose = () => {
        setWsStatus('fallback');
        wsRef.current = null;
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connectWebSocket();
          }, 3000);
        }
      };
      ws.onerror = () => {
        setWsStatus('fallback');
        try {
          ws.close();
        } catch (e) {}
      };
    } catch (e) {
      setWsStatus('fallback');
    }
  }, [fetchData]);

  // Connect on mount
  useEffect(() => {
    connectWebSocket();
    fetchData();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (e) {}
      }
    };
  }, [connectWebSocket, fetchData]);

  // ── RESILIENT AUTO-POLLING FALLBACK WHEN WEBSOCKET IS BLOCKED OR DISCONNECTED ──
  useEffect(() => {
    let pollTimer = null;
    if (wsStatus !== 'connected') {
      // High-speed 1.5s fallback polling ensures uninterrupted live data on VPS/DuckDNS
      pollTimer = setInterval(() => {
        fetchData();
      }, 1500);
    }
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [wsStatus, fetchData]);

  // Handle Manual Market Close
  const handleClosePosition = async posId => {
    try {
      const res = await fetch(`/api/positions/close/${posId}`, {
        method: 'POST'
      }).then(r => r.json());
      if (res.success) {
        fetchData();
      }
    } catch (e) {}
  };

  // Sort helper
  const handleSort = (type, key) => {
    const setFn = type === 'pos' ? setPosSort : type === 'ord' ? setOrdSort : type === 'sig' ? setSigSort : setHistSort;
    setFn(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Sort & Filter Active Positions
  const sortedPositions = useMemo(() => {
    let list = activePositions.filter(p => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (p.symbol || '').toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q);
      }
      return true;
    });
    list.sort((a, b) => {
      const mult = posSort.dir === 'asc' ? 1 : -1;
      if (posSort.key === 'symbol') return mult * (a.symbol || '').localeCompare(b.symbol || '');
      if (posSort.key === 'side') return mult * (a.direction || '').localeCompare(b.direction || '');
      if (posSort.key === 'size') return mult * ((Number(a.pos_size_usd) || 0) - (Number(b.pos_size_usd) || 0));
      if (posSort.key === 'entry') return mult * ((Number(a.entry_price) || 0) - (Number(b.entry_price) || 0));
      if (posSort.key === 'mark') {
        const pA = marketPrices[a.symbol] && marketPrices[a.symbol].price || a.current_price || 0;
        const pB = marketPrices[b.symbol] && marketPrices[b.symbol].price || b.current_price || 0;
        return mult * (pA - pB);
      }
      if (posSort.key === 'pnl') return mult * ((Number(a.net_pnl_usd) || 0) - (Number(b.net_pnl_usd) || 0));
      if (posSort.key === 'roe') return mult * ((Number(a.roe_pct) || 0) - (Number(b.roe_pct) || 0));
      if (posSort.key === 'tp1') return mult * ((Number(a.tp1_price) || 0) - (Number(b.tp1_price) || 0));
      if (posSort.key === 'sl') return mult * ((Number(a.sl_price) || 0) - (Number(b.sl_price) || 0));
      return mult * ((a.open_time || a.created_at || 0) - (b.open_time || b.created_at || 0));
    });
    return list;
  }, [activePositions, searchQuery, posSort, marketPrices]);

  // Sort & Filter Limit Orders
  const sortedLimitOrders = useMemo(() => {
    let list = limitOrders.filter(o => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (o.symbol || '').toLowerCase().includes(q);
      }
      return true;
    });
    list.sort((a, b) => {
      const mult = ordSort.dir === 'asc' ? 1 : -1;
      if (ordSort.key === 'symbol') return mult * (a.symbol || '').localeCompare(b.symbol || '');
      if (ordSort.key === 'side') return mult * (a.direction || '').localeCompare(b.direction || '');
      if (ordSort.key === 'price') return mult * ((Number(a.entry_price) || 0) - (Number(b.entry_price) || 0));
      return mult * ((a.timestamp || 0) - (b.timestamp || 0));
    });
    return list;
  }, [limitOrders, searchQuery, ordSort]);

  // Sort & Filter Signals
  const sortedSignals = useMemo(() => {
    let list = signals.filter(s => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (s.symbol || '').toLowerCase().includes(q) || (s.signal_type || '').toLowerCase().includes(q);
      }
      return true;
    });
    list.sort((a, b) => {
      const mult = sigSort.dir === 'asc' ? 1 : -1;
      if (sigSort.key === 'symbol') return mult * (a.symbol || '').localeCompare(b.symbol || '');
      if (sigSort.key === 'type') return mult * (a.signal_type || '').localeCompare(b.signal_type || '');
      if (sigSort.key === 'side') return mult * (a.direction || '').localeCompare(b.direction || '');
      if (sigSort.key === 'entry') return mult * ((Number(a.entry_price || a.price) || 0) - (Number(b.entry_price || b.price) || 0));
      return mult * ((a.timestamp || a.created_at || 0) - (b.timestamp || b.created_at || 0));
    });
    return list;
  }, [signals, searchQuery, sigSort]);

  // Sort & Filter History
  const sortedHistory = useMemo(() => {
    let list = closedPositions.filter(p => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (p.symbol || '').toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q);
      }
      return true;
    });
    list.sort((a, b) => {
      const mult = histSort.dir === 'asc' ? 1 : -1;
      if (histSort.key === 'symbol') return mult * (a.symbol || '').localeCompare(b.symbol || '');
      if (histSort.key === 'side') return mult * (a.direction || '').localeCompare(b.direction || '');
      if (histSort.key === 'size') return mult * ((Number(a.pos_size_usd) || 0) - (Number(b.pos_size_usd) || 0));
      if (histSort.key === 'pnl') return mult * ((Number(a.net_pnl_usd) || 0) - (Number(b.net_pnl_usd) || 0));
      if (histSort.key === 'roe') return mult * ((Number(a.roe_pct) || 0) - (Number(b.roe_pct) || 0));
      return mult * ((a.close_time || a.open_time || 0) - (b.close_time || b.open_time || 0));
    });
    return list;
  }, [closedPositions, searchQuery, histSort]);

  // Financial Stats
  const walletBalance = performance.wallet_balance !== undefined ? Number(performance.wallet_balance) : 10000.0;
  const marginBalance = performance.margin_balance !== undefined ? Number(performance.margin_balance) : walletBalance;
  const unrealizedPnl = performance.unrealized_pnl_usd !== undefined ? Number(performance.unrealized_pnl_usd) : 0.0;
  const realizedPnl = performance.net_profit_usd !== undefined ? Number(performance.net_profit_usd) : 0.0;
  const winRate = performance.win_rate !== undefined ? Number(performance.win_rate) : 0.0;
  return /*#__PURE__*/React.createElement("div", {
    className: "flex flex-col min-h-screen bg-[#080B11] text-slate-200 font-sans text-xs select-none pb-12"
  }, /*#__PURE__*/React.createElement("header", {
    className: "sticky top-0 z-30 bg-[#0C101A]/95 backdrop-blur-md border-b border-[#1E2638] px-3 sm:px-6 py-2.5 flex flex-col gap-2.5 shadow-lg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-between flex-wrap gap-2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2.5"
  }, /*#__PURE__*/React.createElement("span", {
    className: "w-3 h-3 rounded-full bg-red-500 pulse-live-dot"
  }), /*#__PURE__*/React.createElement("span", {
    className: "font-extrabold text-sm sm:text-base text-white tracking-wider flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", null, "🔴 LIVESTREAM REALTIME MONITOR"), /*#__PURE__*/React.createElement("span", {
    className: "text-[10px] bg-red-500/20 text-red-400 border border-red-500/40 px-2 py-0.2 rounded font-mono font-bold"
  }, "24/7 LIVE"))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 font-mono text-xs"
  }, /*#__PURE__*/React.createElement("span", {
    className: `px-2.5 py-1 rounded border text-[11px] font-bold flex items-center gap-1.5 ${wsStatus === 'connected' ? 'bg-emerald-950 text-emerald-400 border-emerald-500/40' : 'bg-amber-950 text-amber-400 border-amber-500/40'}`
  }, /*#__PURE__*/React.createElement("span", {
    className: `w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`
  }), /*#__PURE__*/React.createElement("span", null, wsStatus === 'connected' ? 'WEBSOCKET STREAMING (0ms)' : 'RECONNECTING WS...')), /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow font-bold bg-[#141A28] px-2.5 py-1 rounded border border-[#1E2638]"
  }, "⏱️ ", timeStr), /*#__PURE__*/React.createElement("button", {
    className: `px-2.5 py-1 rounded font-bold border transition flex items-center gap-1 ${isStreamMode ? 'bg-binance-purple text-white border-binance-purple' : 'bg-binance-subpanel text-slate-300 border-[#1E2638] hover:text-white'}`,
    onClick: () => setIsStreamMode(!isStreamMode),
    title: "Chế độ thu gọn OBS Studio"
  }, /*#__PURE__*/React.createElement("span", null, "📺"), /*#__PURE__*/React.createElement("span", {
    className: "hidden sm:inline"
  }, "OBS Mode")))), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 font-mono"
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 text-[10px] uppercase font-bold"
  }, "KÝ QUỸ MARGIN (EQUITY)"), /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-binance-yellow text-sm"
  }, "$", formatPrice(marginBalance))), /*#__PURE__*/React.createElement("div", {
    className: "p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 text-[10px] uppercase font-bold"
  }, "SỐ DƯ VÍ (WALLET)"), /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-white text-sm"
  }, "$", formatPrice(walletBalance))), /*#__PURE__*/React.createElement("div", {
    className: "p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 text-[10px] uppercase font-bold"
  }, "PNL ĐANG CHẠY (UNREALIZED)"), /*#__PURE__*/React.createElement("span", {
    className: `font-black text-sm ${unrealizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`
  }, unrealizedPnl >= 0 ? '+' : '', "$", formatPrice(unrealizedPnl))), /*#__PURE__*/React.createElement("div", {
    className: "p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 text-[10px] uppercase font-bold"
  }, "LÃI RÒNG ĐÃ CHỐT (NET PROFIT)"), /*#__PURE__*/React.createElement("span", {
    className: `font-bold text-sm ${realizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`
  }, realizedPnl >= 0 ? '+' : '', "$", formatPrice(realizedPnl))), /*#__PURE__*/React.createElement("div", {
    className: "p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 text-[10px] uppercase font-bold"
  }, "WIN RATE TỔNG"), /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-binance-yellow text-sm"
  }, winRate.toFixed(1), "%")), /*#__PURE__*/React.createElement("div", {
    className: "p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400 text-[10px] uppercase font-bold"
  }, "VỊ THẾ ĐANG MỞ"), /*#__PURE__*/React.createElement("span", {
    className: "font-black text-binance-cyan text-sm"
  }, activePositions.length, " Lệnh Active")))), /*#__PURE__*/React.createElement("div", {
    className: "px-3 sm:px-6 py-2.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-[#0B0E17] border-b border-[#1E2638] font-mono"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center bg-[#111726] p-1 rounded-lg border border-[#1E2638] gap-1 overflow-x-auto w-full md:w-auto"
  }, [{
    id: 'positions',
    label: `🔴 Vị Thế Đang Mở (${activePositions.length})`
  }, {
    id: 'orders',
    label: `⏳ Lệnh Chờ Limit (${limitOrders.length})`
  }, {
    id: 'signals',
    label: `⚡ Tín Hiệu Quét SMC (${signals.length})`
  }, {
    id: 'history',
    label: `📜 Lịch Sử Lệnh (${closedPositions.length})`
  }, {
    id: 'journal',
    label: `📖 Nhật Ký & Hiệu Suất`
  }].map(tab => /*#__PURE__*/React.createElement("button", {
    key: tab.id,
    className: `px-3 py-1.5 rounded-md font-bold transition whitespace-nowrap text-xs ${activeTab === tab.id ? 'bg-binance-yellow text-black shadow' : 'text-slate-400 hover:text-white'}`,
    onClick: () => setActiveTab(tab.id)
  }, tab.label))), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-2 flex-wrap w-full md:w-auto justify-end"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center bg-[#111726] border border-[#1E2638] rounded-lg px-2.5 py-1 text-[11px] font-bold text-binance-yellow shadow gap-1"
  }, /*#__PURE__*/React.createElement("span", null, "🔶"), /*#__PURE__*/React.createElement("span", null, "Binance Futures (USDT-M)")), /*#__PURE__*/React.createElement("input", {
    type: "text",
    placeholder: "Tìm symbol...",
    value: searchQuery,
    onChange: e => setSearchQuery(e.target.value),
    className: "bg-[#111726] border border-[#1E2638] rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-binance-yellow w-28 sm:w-36 font-mono"
  }), /*#__PURE__*/React.createElement("button", {
    className: "bg-binance-subpanel hover:bg-binance-hover px-2.5 py-1 rounded-lg border border-[#1E2638] text-xs font-bold text-slate-200 transition",
    onClick: fetchData,
    title: "Đồng bộ lại dữ liệu ngay lập tức"
  }, "🔄"))), /*#__PURE__*/React.createElement("main", {
    className: "flex-1 px-3 sm:px-6 py-4 flex flex-col gap-4"
  }, activeTab === 'positions' && /*#__PURE__*/React.createElement("div", {
    className: "bg-[#0C101A] rounded-xl border border-[#1E2638] overflow-hidden shadow-xl flex flex-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "overflow-x-auto"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-left border-collapse font-mono"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement(SortableHeader, {
    title: "CẶP GIAO DỊCH",
    sortKey: "symbol",
    currentKey: posSort.key,
    currentDir: posSort.dir,
    onSort: k => handleSort('pos', k)
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "VỊ THẾ / ĐÒN BẨY",
    sortKey: "side",
    currentKey: posSort.key,
    currentDir: posSort.dir,
    onSort: k => handleSort('pos', k)
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "SIZE / MARGIN",
    sortKey: "size",
    currentKey: posSort.key,
    currentDir: posSort.dir,
    onSort: k => handleSort('pos', k),
    align: "right"
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "ENTRY / MARK",
    sortKey: "mark",
    currentKey: posSort.key,
    currentDir: posSort.dir,
    onSort: k => handleSort('pos', k),
    align: "right"
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "LÃI/LỖ RÒNG (PNL)",
    sortKey: "pnl",
    currentKey: posSort.key,
    currentDir: posSort.dir,
    onSort: k => handleSort('pos', k),
    align: "right"
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "ROE %",
    sortKey: "roe",
    currentKey: posSort.key,
    currentDir: posSort.dir,
    onSort: k => handleSort('pos', k),
    align: "right"
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "MỤC TIÊU TP1 / SL",
    sortKey: "tp1",
    currentKey: posSort.key,
    currentDir: posSort.dir,
    onSort: k => handleSort('pos', k)
  }), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-center text-slate-400"
  }, "THAO TÁC"))), /*#__PURE__*/React.createElement("tbody", {
    className: "divide-y divide-[#151C2C] text-xs"
  }, sortedPositions.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "8",
    className: "py-12 text-center text-slate-500"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-2xl block mb-2"
  }, "⚡"), "Không có vị thế active nào đang mở. Hệ thống đang quét 500+ cặp hợp đồng Binance...")) : sortedPositions.map(pos => {
    const isLong = (pos.direction || '').toUpperCase() === 'BUY' || (pos.direction || '').toUpperCase() === 'LONG';
    const pKey = pos.symbol;
    const livePrice = marketPrices[pKey] && marketPrices[pKey].price || pos.current_price || pos.entry_price || 0;
    let liveNetPnl = Number(pos.net_pnl_usd) || 0;
    let liveRoe = Number(pos.roe_pct) || 0;
    if (pos.entry_price > 0 && livePrice > 0) {
      const rawDiff = isLong ? (livePrice - pos.entry_price) / pos.entry_price : (pos.entry_price - livePrice) / pos.entry_price;
      liveRoe = rawDiff * 100 * (pos.leverage || 20);
      liveNetPnl = (pos.initial_margin || 100) * (liveRoe / 100) - (pos.fee_usd || 1.0);
    }
    return /*#__PURE__*/React.createElement("tr", {
      key: pos.id,
      className: "hover:bg-[#111726] transition cursor-pointer",
      onClick: () => setSelectedForensics({
        ...pos,
        current_price: livePrice,
        net_pnl_usd: liveNetPnl,
        roe_pct: liveRoe
      })
    }, /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 font-bold text-white flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", null, pos.symbol), /*#__PURE__*/React.createElement("span", {
      className: "text-[9.5px] text-binance-yellow bg-binance-card px-1 rounded border border-[#1E2638]"
    }, "BINANCE")), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: `px-2 py-0.5 rounded text-[10px] font-black ${isLong ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-rose-950 text-rose-400 border border-rose-500/40'}`
    }, isLong ? '▲ LONG' : '▼ SHORT', " ", pos.leverage || 20, "x")), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-white font-bold block"
    }, "$", formatPrice(pos.pos_size_usd)), /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] text-slate-400"
    }, "Margin: $", formatPrice(pos.initial_margin))), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-slate-300 block"
    }, "$", formatPrice(pos.entry_price)), /*#__PURE__*/React.createElement("span", {
      className: "text-white font-bold block"
    }, "$", formatPrice(livePrice))), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right"
    }, /*#__PURE__*/React.createElement("span", {
      className: `font-black text-sm ${liveNetPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`
    }, liveNetPnl >= 0 ? '+' : '', "$", formatPrice(liveNetPnl))), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right"
    }, /*#__PURE__*/React.createElement("span", {
      className: `font-black text-xs ${liveRoe >= 0 ? 'text-binance-green' : 'text-binance-red'}`
    }, liveRoe >= 0 ? '+' : '', liveRoe.toFixed(2), "%")), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-binance-green font-bold block text-[11px]"
    }, "TP1: $", formatPrice(pos.tp1_price)), /*#__PURE__*/React.createElement("span", {
      className: "text-binance-red font-bold block text-[11px]"
    }, "SL: $", formatPrice(pos.sl_price))), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-center",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-center gap-1.5"
    }, /*#__PURE__*/React.createElement("button", {
      className: "bg-binance-cyan/15 hover:bg-binance-cyan/30 text-binance-cyan border border-binance-cyan/40 px-2 py-1 rounded text-[10.5px] font-bold transition",
      onClick: () => setSelectedForensics({
        ...pos,
        current_price: livePrice,
        net_pnl_usd: liveNetPnl,
        roe_pct: liveRoe
      })
    }, "🔍 Chi Tiết"), /*#__PURE__*/React.createElement("button", {
      className: "bg-binance-red hover:bg-red-600 text-white px-2 py-1 rounded text-[10.5px] font-bold transition",
      onClick: () => handleClosePosition(pos.id),
      title: "Đóng vị thế ngay tại giá thị trường"
    }, "✕ Đóng"))));
  }))))), activeTab === 'orders' && /*#__PURE__*/React.createElement("div", {
    className: "bg-[#0C101A] rounded-xl border border-[#1E2638] overflow-hidden shadow-xl flex flex-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "overflow-x-auto"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-left border-collapse font-mono"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement(SortableHeader, {
    title: "SYMBOL",
    sortKey: "symbol",
    currentKey: ordSort.key,
    currentDir: ordSort.dir,
    onSort: k => handleSort('ord', k)
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "LOẠI LỆNH",
    sortKey: "side",
    currentKey: ordSort.key,
    currentDir: ordSort.dir,
    onSort: k => handleSort('ord', k)
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "GIÁ LIMIT ENTRY",
    sortKey: "price",
    currentKey: ordSort.key,
    currentDir: ordSort.dir,
    onSort: k => handleSort('ord', k),
    align: "right"
  }), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-right text-slate-400"
  }, "GIÁ MARK HIỆN TẠI"), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400"
  }, "TP1 / SL MỤC TIÊU"), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-center text-slate-400"
  }, "THAO TÁC"))), /*#__PURE__*/React.createElement("tbody", {
    className: "divide-y divide-[#151C2C] text-xs"
  }, sortedLimitOrders.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "6",
    className: "py-12 text-center text-slate-500"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-2xl block mb-2"
  }, "⏳"), "Không có lệnh chờ Limit nào đang đặt.")) : sortedLimitOrders.map(ord => {
    const isLong = ord.direction === 'BUY' || ord.signal_type && ord.signal_type.includes('LONG');
    const pKey = ord.symbol;
    const livePrice = marketPrices[pKey] && marketPrices[pKey].price || ord.price || ord.entry_price || 0;
    return /*#__PURE__*/React.createElement("tr", {
      key: ord.id || ord.timestamp,
      className: "hover:bg-[#111726] transition cursor-pointer",
      onClick: () => setSelectedForensics(ord)
    }, /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 font-bold text-white flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", null, ord.symbol), /*#__PURE__*/React.createElement("span", {
      className: "text-[9.5px] text-binance-yellow bg-binance-card px-1 rounded border border-[#1E2638]"
    }, "BINANCE")), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: `px-2 py-0.5 rounded text-[10px] font-black ${isLong ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-rose-950 text-rose-400 border border-rose-500/40'}`
    }, isLong ? 'LIMIT BUY' : 'LIMIT SELL')), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right font-bold text-binance-yellow"
    }, "$", formatPrice(ord.entry_price || ord.price)), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right text-white font-mono"
    }, "$", formatPrice(livePrice)), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-binance-green font-bold block text-[11px]"
    }, "TP1: $", formatPrice(ord.tp1_price)), /*#__PURE__*/React.createElement("span", {
      className: "text-binance-red font-bold block text-[11px]"
    }, "SL: $", formatPrice(ord.sl_price))), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-center",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("button", {
      className: "bg-binance-cyan/15 hover:bg-binance-cyan/30 text-binance-cyan border border-binance-cyan/40 px-2.5 py-1 rounded text-[10.5px] font-bold transition",
      onClick: () => setSelectedForensics(ord)
    }, "🔍 Chi Tiết")));
  }))))), activeTab === 'signals' && /*#__PURE__*/React.createElement("div", {
    className: "bg-[#0C101A] rounded-xl border border-[#1E2638] overflow-hidden shadow-xl flex flex-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "overflow-x-auto"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-left border-collapse font-mono"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement(SortableHeader, {
    title: "SYMBOL",
    sortKey: "symbol",
    currentKey: sigSort.key,
    currentDir: sigSort.dir,
    onSort: k => handleSort('sig', k)
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "LOẠI TÍN HIỆU",
    sortKey: "type",
    currentKey: sigSort.key,
    currentDir: sigSort.dir,
    onSort: k => handleSort('sig', k)
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "HƯỚNG",
    sortKey: "side",
    currentKey: sigSort.key,
    currentDir: sigSort.dir,
    onSort: k => handleSort('sig', k)
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "ENTRY",
    sortKey: "entry",
    currentKey: sigSort.key,
    currentDir: sigSort.dir,
    onSort: k => handleSort('sig', k),
    align: "right"
  }), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400"
  }, "TP1 / TP2 / SL"), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-right text-slate-400"
  }, "R:R"), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-right text-slate-400"
  }, "THỜI GIAN"), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-center text-slate-400"
  }, "THAO TÁC"))), /*#__PURE__*/React.createElement("tbody", {
    className: "divide-y divide-[#151C2C] text-xs"
  }, sortedSignals.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "8",
    className: "py-12 text-center text-slate-500"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-2xl block mb-2"
  }, "📡"), "Đang quét liên tục 500+ cặp hợp đồng Binance Futures...")) : sortedSignals.map(sig => {
    const isLong = sig.direction === 'BUY';
    return /*#__PURE__*/React.createElement("tr", {
      key: sig.id || sig.timestamp,
      className: "hover:bg-[#111726] transition cursor-pointer",
      onClick: () => setSelectedForensics(sig)
    }, /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 font-bold text-white flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", null, sig.symbol), /*#__PURE__*/React.createElement("span", {
      className: "text-[9.5px] text-slate-400 bg-binance-card px-1 rounded"
    }, sig.timeframe || '15m')), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-binance-yellow font-bold"
    }, sig.signal_type), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: `px-2 py-0.5 rounded text-[10px] font-black ${isLong ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-rose-950 text-rose-400 border border-rose-500/40'}`
    }, isLong ? '▲ LONG' : '▼ SHORT')), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right font-bold text-white"
    }, "$", formatPrice(sig.entry_price || sig.price)), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-binance-green font-bold text-[11px] block"
    }, "TP1: $", formatPrice(sig.tp1_price), " • TP2: $", formatPrice(sig.tp2_price)), /*#__PURE__*/React.createElement("span", {
      className: "text-binance-red font-bold text-[11px] block"
    }, "SL: $", formatPrice(sig.sl_price))), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right font-bold text-binance-yellow"
    }, "1 : ", (sig.rr_ratio || 2.0).toFixed(2)), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right text-slate-400"
    }, formatRelativeTime(sig.timestamp || sig.created_at)), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-center",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("button", {
      className: "bg-binance-cyan/15 hover:bg-binance-cyan/30 text-binance-cyan border border-binance-cyan/40 px-2.5 py-1 rounded text-[10.5px] font-bold transition",
      onClick: () => setSelectedForensics(sig)
    }, "🔍 Chi Tiết")));
  }))))), activeTab === 'history' && /*#__PURE__*/React.createElement("div", {
    className: "bg-[#0C101A] rounded-xl border border-[#1E2638] overflow-hidden shadow-xl flex flex-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "overflow-x-auto"
  }, /*#__PURE__*/React.createElement("table", {
    className: "w-full text-left border-collapse font-mono"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement(SortableHeader, {
    title: "SYMBOL",
    sortKey: "symbol",
    currentKey: histSort.key,
    currentDir: histSort.dir,
    onSort: k => handleSort('hist', k)
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "VỊ THẾ",
    sortKey: "side",
    currentKey: histSort.key,
    currentDir: histSort.dir,
    onSort: k => handleSort('hist', k)
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "SIZE / MARGIN",
    sortKey: "size",
    currentKey: histSort.key,
    currentDir: histSort.dir,
    onSort: k => handleSort('hist', k),
    align: "right"
  }), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-right text-slate-400"
  }, "ENTRY / EXIT"), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "LÃI/LỖ RÒNG",
    sortKey: "pnl",
    currentKey: histSort.key,
    currentDir: histSort.dir,
    onSort: k => handleSort('hist', k),
    align: "right"
  }), /*#__PURE__*/React.createElement(SortableHeader, {
    title: "ROE %",
    sortKey: "roe",
    currentKey: histSort.key,
    currentDir: histSort.dir,
    onSort: k => handleSort('hist', k),
    align: "right"
  }), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400"
  }, "KẾT QUẢ / LÝ DO"), /*#__PURE__*/React.createElement("th", {
    className: "py-2.5 px-3 border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-center text-slate-400"
  }, "THAO TÁC"))), /*#__PURE__*/React.createElement("tbody", {
    className: "divide-y divide-[#151C2C] text-xs"
  }, sortedHistory.length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "8",
    className: "py-12 text-center text-slate-500"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-2xl block mb-2"
  }, "📜"), "Chưa có lịch sử lệnh đã đóng.")) : sortedHistory.map(pos => {
    const isLong = (pos.direction || '').toUpperCase() === 'BUY' || (pos.direction || '').toUpperCase() === 'LONG';
    const pnl = Number(pos.net_pnl_usd) || 0;
    const roe = Number(pos.roe_pct) || 0;
    const isWin = pnl > 0 || pos.status && pos.status.startsWith('TP');
    return /*#__PURE__*/React.createElement("tr", {
      key: pos.id,
      className: "hover:bg-[#111726] transition cursor-pointer",
      onClick: () => setSelectedForensics(pos)
    }, /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 font-bold text-white flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", null, pos.symbol), /*#__PURE__*/React.createElement("span", {
      className: "text-[9.5px] text-binance-yellow bg-binance-card px-1 rounded"
    }, "BINANCE")), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: `px-2 py-0.5 rounded text-[10px] font-black ${isLong ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`
    }, isLong ? 'LONG' : 'SHORT', " ", pos.leverage || 20, "x")), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-white font-bold block"
    }, "$", formatPrice(pos.pos_size_usd)), /*#__PURE__*/React.createElement("span", {
      className: "text-[10px] text-slate-400"
    }, "Margin: $", formatPrice(pos.initial_margin))), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400 block"
    }, "$", formatPrice(pos.entry_price)), /*#__PURE__*/React.createElement("span", {
      className: "text-white font-bold block"
    }, "→ $", formatPrice(pos.exit_price || pos.current_price))), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right"
    }, /*#__PURE__*/React.createElement("span", {
      className: `font-black text-sm ${pnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`
    }, pnl >= 0 ? '+' : '', "$", formatPrice(pnl))), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-right"
    }, /*#__PURE__*/React.createElement("span", {
      className: `font-black text-xs ${roe >= 0 ? 'text-binance-green' : 'text-binance-red'}`
    }, roe >= 0 ? '+' : '', roe.toFixed(2), "%")), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: `px-2 py-0.5 rounded text-[10px] font-bold ${isWin ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' : 'bg-rose-950 text-rose-400 border border-rose-500/40'}`
    }, pos.status || pos.exit_reason || 'CLOSED')), /*#__PURE__*/React.createElement("td", {
      className: "py-3 px-3 text-center",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("button", {
      className: "bg-binance-cyan/15 hover:bg-binance-cyan/30 text-binance-cyan border border-binance-cyan/40 px-2.5 py-1 rounded text-[10.5px] font-bold transition",
      onClick: () => setSelectedForensics(pos)
    }, "🔍 Chi Tiết")));
  }))))), activeTab === 'journal' && /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 md:grid-cols-3 gap-4 font-mono"
  }, /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-[#0C101A] rounded-xl border border-[#1E2638] flex flex-col gap-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-yellow font-bold text-sm uppercase flex items-center gap-1.5 font-sans"
  }, /*#__PURE__*/React.createElement("span", null, "📊"), /*#__PURE__*/React.createElement("span", null, "HIỆU SUẤT TÀI KHOẢN")), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between border-b border-[#151C2C] pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Tổng Số Lệnh:"), /*#__PURE__*/React.createElement("b", {
    className: "text-white font-bold"
  }, performance.total_trades || closedPositions.length)), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between border-b border-[#151C2C] pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Số Lệnh Thắng:"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-green font-bold"
  }, performance.wins || 0)), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between border-b border-[#151C2C] pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Số Lệnh Thua:"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-red font-bold"
  }, performance.losses || 0)), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between border-b border-[#151C2C] pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Tỷ Lệ Thắng (Win Rate):"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-yellow font-black"
  }, winRate.toFixed(1), "%")), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Profit Factor:"), /*#__PURE__*/React.createElement("b", {
    className: "text-white font-bold"
  }, performance.profit_factor ? Number(performance.profit_factor).toFixed(2) : '0.00'))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-[#0C101A] rounded-xl border border-[#1E2638] flex flex-col gap-3"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-green font-bold text-sm uppercase flex items-center gap-1.5 font-sans"
  }, /*#__PURE__*/React.createElement("span", null, "💰"), /*#__PURE__*/React.createElement("span", null, "DÒNG TIỀN LỢI NHUẬN")), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between border-b border-[#151C2C] pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Số Dư Ký Quỹ (Equity):"), /*#__PURE__*/React.createElement("b", {
    className: "text-binance-yellow font-bold"
  }, "$", formatPrice(marginBalance))), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between border-b border-[#151C2C] pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Số Dư Ví (Wallet):"), /*#__PURE__*/React.createElement("b", {
    className: "text-white font-bold"
  }, "$", formatPrice(walletBalance))), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between border-b border-[#151C2C] pb-2"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Lãi Ròng Đã Chốt:"), /*#__PURE__*/React.createElement("b", {
    className: `font-black ${realizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`
  }, realizedPnl >= 0 ? '+' : '', "$", formatPrice(realizedPnl))), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-slate-400"
  }, "Unrealized PnL:"), /*#__PURE__*/React.createElement("b", {
    className: `font-black ${unrealizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`
  }, unrealizedPnl >= 0 ? '+' : '', "$", formatPrice(unrealizedPnl)))), /*#__PURE__*/React.createElement("div", {
    className: "p-4 bg-[#0C101A] rounded-xl border border-[#1E2638] flex flex-col gap-3 font-sans"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-binance-cyan font-bold text-sm uppercase flex items-center gap-1.5"
  }, /*#__PURE__*/React.createElement("span", null, "🛡️"), /*#__PURE__*/React.createElement("span", null, "QUẢN TRỊ RỦI RO BINANCE")), /*#__PURE__*/React.createElement("div", {
    className: "text-slate-300 text-xs leading-relaxed flex flex-col gap-2 font-mono"
  }, /*#__PURE__*/React.createElement("div", null, "• Sàn Giao Dịch: ", /*#__PURE__*/React.createElement("b", {
    className: "text-binance-yellow"
  }, "Binance Futures (USDT-M)")), /*#__PURE__*/React.createElement("div", null, "• Quy Mô Vị Thế: ", /*#__PURE__*/React.createElement("b", {
    className: "text-white"
  }, "1.0% Equity / Trade")), /*#__PURE__*/React.createElement("div", null, "• Đòn Bẩy Tiêu Chuẩn: ", /*#__PURE__*/React.createElement("b", {
    className: "text-white"
  }, "20x Isolated")), /*#__PURE__*/React.createElement("div", null, "• Tỷ Lệ Chốt Lời / Cắt Lỗ: ", /*#__PURE__*/React.createElement("b", {
    className: "text-binance-green"
  }, "TP1 1.5R • TP2 3.0R")), /*#__PURE__*/React.createElement("div", null, "• Bảo Vệ Vốn: ", /*#__PURE__*/React.createElement("b", {
    className: "text-binance-green"
  }, "Auto Breakeven + Trailing SL")))))), selectedForensics && /*#__PURE__*/React.createElement(OrderForensicsModal, {
    data: selectedForensics,
    marketPrices: marketPrices,
    onClose: () => setSelectedForensics(null),
    onClosePosition: handleClosePosition
  }));
}

// ── RENDER ROOT COMPONENT ──
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(/*#__PURE__*/React.createElement(LivestreamApp, null));
}