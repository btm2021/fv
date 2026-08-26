const { useState, useEffect, useCallback, useMemo, useRef } = React;

// ── UTILITY FUNCTIONS ──
function formatPrice(val, decimals = 2) {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  const num = Number(val);
  if (Math.abs(num) < 0.0001) return num.toFixed(6);
  if (Math.abs(num) < 0.01) return num.toFixed(4);
  if (Math.abs(num) < 1.0) return num.toFixed(4);
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDate(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  return d.toLocaleString('vi-VN', { hour12: false });
}

// ── 1. DETAILED FORENSICS MODAL (MATCHING MAIN TERMINAL) ──
function LivestreamForensicsModal({ data, onClose, onClosePosition }) {
  if (!data) return null;
  const isLong = (data.direction || '').toUpperCase() === 'LONG';
  const isActive = data.status === 'ACTIVE';
  const pnl = Number(data.net_pnl_usd) || 0;
  const roe = Number(data.roe_pct) || 0;
  const isWin = pnl > 0;

  const [noteText, setNoteText] = useState(data.notes || '');
  const [isSavingNote, setIsSavingNote] = useState(false);

  const handleSaveNote = async () => {
    setIsSavingNote(true);
    try {
      await fetch(`/api/positions/notes/${data.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: noteText })
      });
      data.notes = noteText;
      alert('Đã lưu ghi chú vào cơ sở dữ liệu!');
    } catch (e) {
      alert('Lỗi lưu ghi chú: ' + e.message);
    } finally {
      setIsSavingNote(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 font-sans text-xs text-slate-200" onClick={onClose}>
      <div className="bg-[#0B0E17] border border-binance-borderHighlight rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="p-4 border-b border-binance-border bg-[#0E1320] flex items-center justify-between font-mono shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xl">🔍</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base text-white">{data.symbol}</span>
                <span className="bg-binance-card px-2 py-0.5 rounded border border-binance-border text-[10px] text-slate-400 font-bold">{data.exchange || 'BINANCE'}</span>
                <span className={`px-2 py-0.5 rounded font-black text-[10px] ${isLong ? 'bg-binance-green/20 text-binance-green border border-binance-green/40' : 'bg-binance-red/20 text-binance-red border border-binance-red/40'}`}>
                  {isLong ? '▲ LONG' : '▼ SHORT'} {data.leverage || 20}x
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isActive ? 'bg-binance-cyan/20 text-binance-cyan border border-binance-cyan/40' : isWin ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}`}>
                  {isActive ? '⚡ ĐANG CHẠY' : isWin ? '✓ CHỐT LÃI' : '✕ CẮT LỖ'}
                </span>
              </div>
              <span className="text-[10px] text-slate-400">ID: {data.id} • Thời gian: {formatDate(data.open_time || data.created_at)}</span>
            </div>
          </div>
          <button className="text-slate-400 hover:text-white text-lg w-8 h-8 rounded-lg bg-binance-subpanel flex items-center justify-center" onClick={onClose}>✕</button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex flex-col gap-5 text-xs font-mono">
          
          {/* Section 1: PnL & Financial KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-[#111726] rounded-lg border border-binance-border">
              <span className="text-slate-400 text-[10px] uppercase block font-bold">LỢI NHUẬN RÒNG (NET PNL)</span>
              <span className={`text-lg font-black ${pnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
                {pnl >= 0 ? '+' : ''}${formatPrice(pnl)}
              </span>
              <span className="text-[10px] text-slate-400 block">{roe >= 0 ? '+' : ''}{roe.toFixed(2)}% ROE</span>
            </div>
            <div className="p-3 bg-[#111726] rounded-lg border border-binance-border">
              <span className="text-slate-400 text-[10px] uppercase block font-bold">GIÁ ENTRY / EXIT</span>
              <span className="text-white font-bold text-sm">${formatPrice(data.entry_price)}</span>
              <span className="text-[10px] text-slate-400 block">→ ${formatPrice(data.exit_price || data.current_price || data.entry_price)}</span>
            </div>
            <div className="p-3 bg-[#111726] rounded-lg border border-binance-border">
              <span className="text-slate-400 text-[10px] uppercase block font-bold">SIZE VỊ THẾ / MARGIN</span>
              <span className="text-white font-bold text-sm">${formatPrice(data.pos_size_usd)}</span>
              <span className="text-[10px] text-slate-400 block">Ký quỹ: ${formatPrice(data.initial_margin)}</span>
            </div>
            <div className="p-3 bg-[#111726] rounded-lg border border-binance-border">
              <span className="text-slate-400 text-[10px] uppercase block font-bold">MỤC TIÊU TP / SL</span>
              <span className="text-binance-green block font-bold text-[11px]">TP1: ${formatPrice(data.tp1_price)}</span>
              <span className="text-binance-red block font-bold text-[11px]">SL: ${formatPrice(data.sl_price)}</span>
            </div>
          </div>

          {/* Section 2: Technical Rationale */}
          <div className="p-4 bg-[#111726] rounded-lg border border-binance-border flex flex-col gap-2">
            <span className="text-binance-yellow font-bold text-xs uppercase flex items-center gap-1.5">
              <span>🎯</span>
              <span>LÝ DO KÍCH HOẠT LỆNH & THUẬT TOÁN (SMC RATIONALE)</span>
            </span>
            <div className="text-slate-300 leading-relaxed text-[11.5px] bg-[#090D16] p-3 rounded border border-binance-borderSubtle">
              {data.entry_rationale || data.market_regime || 'Kích hoạt theo cấu trúc Smart Money Concepts: Vùng mất cân bằng Fair Value Gap (FVG) retest, xác nhận độ dốc EMA 21 và động lượng CMO 14.'}
            </div>
          </div>

          {/* Section 3: User Notes */}
          <div className="p-4 bg-[#111726] rounded-lg border border-binance-border flex flex-col gap-2">
            <span className="text-white font-bold text-xs uppercase flex items-center gap-1.5">
              <span>📝</span>
              <span>GHI CHÚ CHI TIẾT (ORDER NOTES)</span>
            </span>
            <textarea
              className="w-full bg-[#090D16] border border-binance-border rounded p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-binance-yellow font-mono"
              rows="3"
              placeholder="Nhập ghi chú cá nhân, tâm lý giao dịch, điểm lưu ý..."
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
            />
            <div className="flex justify-end">
              <button
                className="bg-binance-yellow hover:bg-binance-yellowHover text-black font-bold px-3 py-1.5 rounded text-xs transition"
                onClick={handleSaveNote}
                disabled={isSavingNote}
              >
                {isSavingNote ? 'Đang lưu...' : '💾 Lưu Ghi Chú'}
              </button>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-3 border-t border-binance-border bg-[#0E1320] flex items-center justify-between shrink-0 font-mono">
          <div>
            {isActive && onClosePosition && (
              <button
                className="bg-binance-red hover:bg-red-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition"
                onClick={() => { onClosePosition(data.id); onClose(); }}
              >
                ✕ Đóng Vị Thế Ngay (Market Close)
              </button>
            )}
          </div>
          <button className="bg-binance-subpanel hover:bg-binance-hover px-4 py-1.5 rounded-lg text-xs font-bold text-white border border-binance-border" onClick={onClose}>
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
}

// ── TABLE HEADER CELL COMPONENT WITH INTERACTIVE SORTING ──
function SortableHeader({ title, sortKey, currentKey, currentDir, onSort, align = 'left', className = '' }) {
  const isActive = currentKey === sortKey;
  return (
    <th
      className={`py-2.5 px-3 whitespace-nowrap select-none transition-colors border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold tracking-wider cursor-pointer hover:bg-[#151D2F] hover:text-binance-yellow ${isActive ? 'text-binance-yellow' : 'text-slate-400'} ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <div className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end w-full' : ''}`}>
        <span>{title}</span>
        <span className={`text-[10px] font-mono ${isActive ? 'text-binance-yellow font-black' : 'text-slate-600'}`}>
          {isActive ? (currentDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </div>
    </th>
  );
}

// ── 2. MAIN LIVESTREAM TRACKER APPLICATION ──
function LivestreamApp() {
  const [activeTab, setActiveTab] = useState('positions'); // positions, orders, signals, history, journal
  const [exchangeFilter, setExchangeFilter] = useState('ALL');
  const [isStreamMode, setIsStreamMode] = useState(false); // OBS Studio compact broadcast mode
  const [searchQuery, setSearchQuery] = useState('');

  // Interactive Column Sorting States
  const [posSort, setPosSort] = useState({ key: 'pnl', dir: 'desc' });
  const [ordSort, setOrdSort] = useState({ key: 'time', dir: 'desc' });
  const [sigSort, setSigSort] = useState({ key: 'time', dir: 'desc' });
  const [histSort, setHistSort] = useState({ key: 'time', dir: 'desc' });

  const handlePosSort = (key) => {
    setPosSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  };

  const handleOrdSort = (key) => {
    setOrdSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  };

  const handleSigSort = (key) => {
    setSigSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  };

  const handleHistSort = (key) => {
    setHistSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  };

  // Data States
  const [status, setStatus] = useState({});
  const [performance, setPerformance] = useState({});
  const [activePositions, setActivePositions] = useState([]);
  const [limitOrders, setLimitOrders] = useState([]);
  const [signals, setSignals] = useState([]);
  const [closedPositions, setClosedPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedForensics, setSelectedForensics] = useState(null);

  // Live Clock
  const [timeStr, setTimeStr] = useState(new Date().toLocaleTimeString());
  useEffect(() => {
    const timer = setInterval(() => setTimeStr(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch Full Data (Identical to Main Terminal)
  const fetchData = useCallback(async () => {
    try {
      const exParam = exchangeFilter !== 'ALL' ? `?exchange=${exchangeFilter}` : '';
      const [resStatus, resPos, resSig, resJour] = await Promise.all([
        fetch(`/api/status${exParam}`).then(r => r.json()),
        fetch(`/api/positions${exParam}`).then(r => r.json()),
        fetch('/api/signals?limit=150').then(r => r.json()),
        fetch('/api/journal').then(r => r.json())
      ]);

      if (resStatus && resStatus.success) {
        setStatus(resStatus.status || {});
        if (resStatus.stats) setPerformance(resStatus.stats);
      }
      if (resPos && resPos.success) {
        const activeList = resPos.active || resPos.positions || [];
        setActivePositions(activeList);
        if (resPos.all) {
          setClosedPositions((resPos.all || []).filter(p => p.status !== 'ACTIVE'));
        }
        if (resPos.stats) {
          setPerformance(resPos.stats);
        }
      }
      if (resSig && resSig.success) {
        const sigList = resSig.data || [];
        setSignals(sigList);
        const activeSyms = new Set((resPos && (resPos.active || resPos.positions) ? (resPos.active || resPos.positions) : []).map(p => p.symbol));
        setLimitOrders(sigList.filter(s => s.signal_type && s.signal_type.startsWith('FADE') && !activeSyms.has(s.symbol)).slice(0, 30));
      }
      if (resJour && resJour.success && resJour.data && resJour.data.trades) {
        if (!resPos || !resPos.all) {
          setClosedPositions(resJour.data.trades.filter(t => t.status !== 'ACTIVE'));
        }
      }
    } catch (err) {
      console.warn('Livestream fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [exchangeFilter]);

  // WebSocket Live Connection + Periodic Auto-Polling (Identical to Main Terminal)
  useEffect(() => {
    fetchData();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:8080';
    const ws = new WebSocket(`${protocol}//${host}`);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'POSITIONS_UPDATE' && msg.data) {
          const pos = msg.data.active || msg.data.positions;
          if (pos) setActivePositions(pos);
          if (msg.data.stats) setPerformance(msg.data.stats);
          if (msg.data.all) setClosedPositions(msg.data.all.filter(p => p.status !== 'ACTIVE'));
        } else if (msg.type === 'SIGNALS_UPDATE' && msg.data && msg.data.signals) {
          setSignals(msg.data.signals);
        } else if (msg.type === 'NEW_SIGNAL' && msg.data) {
          setSignals(prev => [msg.data, ...prev.slice(0, 199)]);
        }
      } catch (err) {}
    };

    // Auto Poll every 3 seconds for continuous synchronization
    const pollInterval = setInterval(fetchData, 3000);

    return () => {
      clearInterval(pollInterval);
      try { ws.close(); } catch(e) {}
    };
  }, [fetchData]);

  // Handle Market Close Position
  const handleClosePosition = async (posId) => {
    if (!confirm('Đóng vị thế ngay lập tức theo giá thị trường?')) return;
    await fetch(`/api/positions/close/${posId}`, { method: 'POST' });
    fetchData();
  };

  // Sort & Filter Active Positions
  const sortedActivePositions = useMemo(() => {
    let list = activePositions.filter(p => {
      if (exchangeFilter !== 'ALL' && (p.exchange || 'BINANCE') !== exchangeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (p.symbol || '').toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q);
      }
      return true;
    });

    list.sort((a, b) => {
      const mult = posSort.dir === 'asc' ? 1 : -1;
      if (posSort.key === 'symbol') return mult * (a.symbol || '').localeCompare(b.symbol || '');
      if (posSort.key === 'exchange') return mult * (a.exchange || 'BINANCE').localeCompare(b.exchange || 'BINANCE');
      if (posSort.key === 'side') return mult * (a.direction || '').localeCompare(b.direction || '');
      if (posSort.key === 'size') return mult * ((Number(a.pos_size_usd) || 0) - (Number(b.pos_size_usd) || 0));
      if (posSort.key === 'entry') return mult * ((Number(a.entry_price) || 0) - (Number(b.entry_price) || 0));
      if (posSort.key === 'mark') return mult * ((Number(a.current_price || a.entry_price) || 0) - (Number(b.current_price || b.entry_price) || 0));
      if (posSort.key === 'liq') return mult * ((Number(a.liq_price) || 0) - (Number(b.liq_price) || 0));
      if (posSort.key === 'margin_ratio') return mult * ((Number(a.margin_ratio) || 0) - (Number(b.margin_ratio) || 0));
      if (posSort.key === 'pnl') return mult * ((Number(a.net_pnl_usd) || 0) - (Number(b.net_pnl_usd) || 0));
      if (posSort.key === 'roe') return mult * ((Number(a.roe_pct) || 0) - (Number(b.roe_pct) || 0));
      return mult * ((a.open_time || 0) - (b.open_time || 0));
    });

    return list;
  }, [activePositions, exchangeFilter, searchQuery, posSort]);

  // Sort & Filter Orders
  const sortedLimitOrders = useMemo(() => {
    let list = limitOrders.filter(o => {
      if (exchangeFilter !== 'ALL' && (o.exchange || 'BINANCE') !== exchangeFilter) return false;
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
      if (ordSort.key === 'type') return mult * (a.signal_type || '').localeCompare(b.signal_type || '');
      if (ordSort.key === 'entry') return mult * ((Number(a.entry_price || a.price) || 0) - (Number(b.entry_price || b.price) || 0));
      if (ordSort.key === 'tp1') return mult * ((Number(a.tp1_price || a.target) || 0) - (Number(b.tp1_price || b.target) || 0));
      if (ordSort.key === 'sl') return mult * ((Number(a.sl_price || a.stop_loss) || 0) - (Number(b.sl_price || b.stop_loss) || 0));
      return mult * ((a.timestamp || a.created_at || 0) - (b.timestamp || b.created_at || 0));
    });

    return list;
  }, [limitOrders, exchangeFilter, searchQuery, ordSort]);

  // Sort & Filter Signals
  const sortedSignals = useMemo(() => {
    let list = signals.filter(s => {
      if (exchangeFilter !== 'ALL' && (s.exchange || 'BINANCE') !== exchangeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (s.symbol || '').toLowerCase().includes(q) || (s.rationale || '').toLowerCase().includes(q);
      }
      return true;
    });

    list.sort((a, b) => {
      const mult = sigSort.dir === 'asc' ? 1 : -1;
      if (sigSort.key === 'symbol') return mult * (a.symbol || '').localeCompare(b.symbol || '');
      if (sigSort.key === 'tf') return mult * (a.timeframe || '').localeCompare(b.timeframe || '');
      if (sigSort.key === 'side') return mult * (a.direction || '').localeCompare(b.direction || '');
      if (sigSort.key === 'type') return mult * (a.signal_type || '').localeCompare(b.signal_type || '');
      if (sigSort.key === 'entry') return mult * ((Number(a.entry_price || a.price) || 0) - (Number(b.entry_price || b.price) || 0));
      if (sigSort.key === 'tp1') return mult * ((Number(a.tp1_price || a.target) || 0) - (Number(b.tp1_price || b.target) || 0));
      if (sigSort.key === 'tp2') return mult * ((Number(a.tp2_price) || 0) - (Number(b.tp2_price) || 0));
      if (sigSort.key === 'sl') return mult * ((Number(a.sl_price || a.stop_loss) || 0) - (Number(b.sl_price || b.stop_loss) || 0));
      return mult * ((a.timestamp || a.created_at || 0) - (b.timestamp || b.created_at || 0));
    });

    return list;
  }, [signals, exchangeFilter, searchQuery, sigSort]);

  // Sort & Filter History
  const sortedHistory = useMemo(() => {
    let list = closedPositions.filter(p => {
      if (exchangeFilter !== 'ALL' && (p.exchange || 'BINANCE') !== exchangeFilter) return false;
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
      if (histSort.key === 'reason') return mult * (a.exit_reason || a.status || '').localeCompare(b.exit_reason || b.status || '');
      return mult * ((a.close_time || a.open_time || 0) - (b.close_time || b.open_time || 0));
    });

    return list;
  }, [closedPositions, exchangeFilter, searchQuery, histSort]);

  // Financial Stats (Exact match with backend DB and Main Terminal)
  const walletBalance = performance.wallet_balance !== undefined ? Number(performance.wallet_balance) : 1000.0;
  const marginBalance = performance.margin_balance !== undefined ? Number(performance.margin_balance) : (performance.current_equity_usd !== undefined ? Number(performance.current_equity_usd) : walletBalance);
  const unrealizedPnl = performance.unrealized_pnl_usd !== undefined ? Number(performance.unrealized_pnl_usd) : 0.0;
  const realizedPnl = performance.net_profit_usd !== undefined ? Number(performance.net_profit_usd) : (performance.net_realized_pnl_usd !== undefined ? Number(performance.net_realized_pnl_usd) : 0.0);
  const winRate = performance.win_rate !== undefined ? Number(performance.win_rate) : (performance.win_rate_pct !== undefined ? Number(performance.win_rate_pct) : 0.0);
  const profitFactor = performance.profit_factor !== undefined ? Number(performance.profit_factor) : 0.0;

  return (
    <div className="flex flex-col min-h-screen bg-[#080B11] text-slate-200 font-sans text-xs select-none pb-12">
      
      {/* ── 1. TOP LIVESTREAM HUD & BROADCAST HEADER ── */}
      <header className="sticky top-0 z-30 bg-[#0C101A]/95 backdrop-blur-md border-b border-[#1E2638] px-3 sm:px-6 py-2.5 flex flex-col gap-2.5 shadow-lg">
        
        {/* Top Line: Live Badge, Clock & Actions */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          
          {/* Live Status Badge */}
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-red-500 pulse-live-dot"></span>
            <span className="font-extrabold text-sm sm:text-base text-white tracking-wider flex items-center gap-1.5">
              <span>🔴 LIVESTREAM ENTRY & POSITIONS MONITOR</span>
              <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/40 px-2 py-0.2 rounded font-mono font-bold">24/7 LIVE</span>
            </span>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-binance-yellow font-bold bg-[#141A28] px-2.5 py-1 rounded border border-[#1E2638]">
              ⏱️ {timeStr}
            </span>

            {/* Stream OBS Mode Toggle */}
            <button
              className={`px-2.5 py-1 rounded font-bold border transition flex items-center gap-1 ${isStreamMode ? 'bg-binance-purple text-white border-binance-purple' : 'bg-binance-subpanel text-slate-300 border-[#1E2638] hover:text-white'}`}
              onClick={() => setIsStreamMode(!isStreamMode)}
              title="Chế độ thu gọn chuyên dùng cho OBS Studio / Livestream"
            >
              <span>🎥</span>
              <span className="hidden sm:inline">{isStreamMode ? 'Stream Mode BẬT' : 'Stream Mode'}</span>
            </button>

            {/* Return to Main Terminal */}
            <a
              href="/"
              className="bg-binance-yellow hover:bg-binance-yellowHover text-black font-bold px-3 py-1 rounded border border-binance-yellow transition flex items-center gap-1 shadow"
              title="Quay về Terminal Giao Dịch Chính"
            >
              <span>📈</span>
              <span className="hidden sm:inline">Terminal Chính</span>
            </a>
          </div>

        </div>

        {/* Second Line: Executive Metric Strip (Exact match with Main Terminal) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 font-mono">
          <div className="p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">KÝ QUỸ MARGIN (EQUITY)</span>
            <span className="font-bold text-binance-yellow text-sm">${formatPrice(marginBalance)}</span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">SỐ DƯ VÍ (WALLET)</span>
            <span className="font-bold text-white text-sm">${formatPrice(walletBalance)}</span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">PNL ĐANG CHẠY (UNREALIZED)</span>
            <span className={`font-black text-sm ${unrealizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
              {unrealizedPnl >= 0 ? '+' : ''}${formatPrice(unrealizedPnl)}
            </span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">LÃI RÒNG ĐÃ CHỐT (NET PROFIT)</span>
            <span className={`font-bold text-sm ${realizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
              {realizedPnl >= 0 ? '+' : ''}${formatPrice(realizedPnl)}
            </span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">WIN RATE TỔNG</span>
            <span className="font-bold text-binance-yellow text-sm">{winRate.toFixed(1)}%</span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-[#1E2638] flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">VỊ THẾ ĐANG MỞ</span>
            <span className="font-black text-binance-cyan text-sm">{activePositions.length} Lệnh Active</span>
          </div>
        </div>

      </header>

      {/* ── 2. TOOLBAR: TABS, EXCHANGE FILTERS & SEARCH ── */}
      <div className="px-3 sm:px-6 py-2.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-[#0B0E17] border-b border-[#1E2638] font-mono">
        
        {/* Navigation Tabs */}
        <div className="flex items-center bg-[#111726] p-1 rounded-lg border border-[#1E2638] gap-1 overflow-x-auto w-full md:w-auto">
          {[
            { id: 'positions', label: `🔴 Vị Thế Đang Mở (${activePositions.length})` },
            { id: 'orders', label: `⏳ Lệnh Chờ Limit (${limitOrders.length})` },
            { id: 'signals', label: `⚡ Tín Hiệu Quét SMC (${signals.length})` },
            { id: 'history', label: `📜 Lịch Sử Lệnh (${closedPositions.length})` },
            { id: 'journal', label: `📖 Nhật Ký & Hiệu Suất` }
          ].map(tab => (
            <button
              key={tab.id}
              className={`px-3 py-1.5 rounded-md font-bold transition whitespace-nowrap text-xs ${activeTab === tab.id ? 'bg-binance-yellow text-black shadow' : 'text-slate-400 hover:text-white'}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Exchange Filter & Search */}
        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
          
          {/* Exchange Filter */}
          <div className="flex items-center bg-[#111726] border border-[#1E2638] rounded-lg p-0.5 gap-0.5 text-[11px]">
            {['ALL', 'BINANCE', 'BYBIT', 'OKX', 'BITGET', 'GATE', 'BINGX'].map(ex => (
              <button
                key={ex}
                className={`px-2 py-0.5 rounded font-bold transition ${exchangeFilter === ex ? 'bg-binance-active text-binance-yellow shadow' : 'text-slate-400 hover:text-white'}`}
                onClick={() => setExchangeFilter(ex)}
              >
                {ex}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Tìm symbol..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-[#111726] border border-[#1E2638] rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-binance-yellow w-28 sm:w-36 font-mono"
          />

          <button
            className="bg-binance-subpanel hover:bg-binance-hover px-2.5 py-1 rounded-lg border border-[#1E2638] text-xs font-bold text-slate-200 transition"
            onClick={fetchData}
            title="Tải lại dữ liệu"
          >
            🔄
          </button>
        </div>

      </div>

      {/* ── 3. MAIN TABLE CONTENT ── */}
      <main className="flex-1 p-3 sm:p-5 overflow-y-auto">
        
        {/* ── TAB 1: ACTIVE POSITIONS TABLE ── */}
        {activeTab === 'positions' && (
          <div className="bg-[#0B0E17] border border-[#1E2638] rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto max-h-[75vh]">
              <table className="w-full text-left font-mono text-[11px] border-separate border-spacing-0">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <SortableHeader title="Symbol / Sàn" sortKey="symbol" currentKey={posSort.key} currentDir={posSort.dir} onSort={handlePosSort} />
                    <SortableHeader title="Vị Thế" sortKey="side" currentKey={posSort.key} currentDir={posSort.dir} onSort={handlePosSort} />
                    <SortableHeader title="Size / Margin" sortKey="size" currentKey={posSort.key} currentDir={posSort.dir} onSort={handlePosSort} />
                    <SortableHeader title="Entry Price" sortKey="entry" currentKey={posSort.key} currentDir={posSort.dir} onSort={handlePosSort} />
                    <SortableHeader title="Mark Price" sortKey="mark" currentKey={posSort.key} currentDir={posSort.dir} onSort={handlePosSort} />
                    <SortableHeader title="Liq Price" sortKey="liq" currentKey={posSort.key} currentDir={posSort.dir} onSort={handlePosSort} />
                    <SortableHeader title="Margin %" sortKey="margin_ratio" currentKey={posSort.key} currentDir={posSort.dir} onSort={handlePosSort} />
                    <SortableHeader title="PnL ($ / ROE %)" sortKey="pnl" currentKey={posSort.key} currentDir={posSort.dir} onSort={handlePosSort} />
                    <th className="py-2.5 px-3 whitespace-nowrap border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400">Mục Tiêu TP1 / SL</th>
                    <th className="py-2.5 px-3 whitespace-nowrap border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400">Ghi Chú</th>
                    <th className="py-2.5 px-3 whitespace-nowrap border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedActivePositions.length === 0 ? (
                    <tr>
                      <td colSpan="11" className="py-16 text-center text-slate-500 font-mono border-b border-[#161D2C]">
                        <span className="text-2xl block mb-1">⚡</span>
                        <span className="text-sm font-bold text-slate-400">Không có vị thế mở nào đang hoạt động.</span>
                        <p className="text-[11px] text-slate-500 mt-1">Scanner 24/7 đang quét 3,945 cặp phái sinh trên 6 sàn.</p>
                      </td>
                    </tr>
                  ) : (
                    sortedActivePositions.map(pos => {
                      const isLong = ['BUY', 'LONG'].includes((pos.direction || '').toUpperCase());
                      const pnl = Number(pos.net_pnl_usd) || 0;
                      const roe = Number(pos.roe_pct) || 0;
                      const isProfit = pnl >= 0;

                      return (
                        <tr
                          key={pos.id}
                          className={`hover:bg-[#151D2F] transition cursor-pointer ${isProfit ? 'bg-emerald-950/10' : 'bg-rose-950/10'}`}
                          onClick={() => setSelectedForensics(pos)}
                        >
                          <td className="py-2 px-3 whitespace-nowrap font-bold text-white border-b border-[#161D2C]">
                            <div className="flex items-center gap-1.5">
                              <span>{pos.symbol}</span>
                              <span className="text-[9px] bg-binance-card px-1.5 py-0.2 rounded border border-[#1E2638] text-slate-400 font-bold">{pos.exchange || 'BINANCE'}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap border-b border-[#161D2C]">
                            <span className={`px-2 py-0.5 rounded font-black text-[10px] ${isLong ? 'bg-binance-green/20 text-binance-green border border-binance-green/40' : 'bg-binance-red/20 text-binance-red border border-binance-red/40'}`}>
                              {isLong ? '▲ LONG' : '▼ SHORT'} {pos.leverage || 20}x
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap border-b border-[#161D2C]">
                            <span className="text-white font-bold">${formatPrice(pos.pos_size_usd)}</span>
                            <span className="text-[9.5px] text-slate-400 block">Ký quỹ: ${formatPrice(pos.initial_margin)}</span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-white border-b border-[#161D2C]">
                            ${formatPrice(pos.entry_price)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-bold text-binance-yellow border-b border-[#161D2C]">
                            ${formatPrice(pos.current_price || pos.entry_price)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-rose-400 border-b border-[#161D2C]">
                            ${formatPrice(pos.liq_price)}
                          </td>
                          <td className={`py-2 px-3 whitespace-nowrap font-bold border-b border-[#161D2C] ${(pos.margin_ratio || 0) > 80 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {(pos.margin_ratio || 0).toFixed(2)}%
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-black border-b border-[#161D2C]">
                            <span className={`text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isProfit ? '+' : ''}${formatPrice(pnl)}
                            </span>
                            <span className={`text-[10px] block ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                              ({roe >= 0 ? '+' : ''}{roe.toFixed(2)}% ROE)
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-[10.5px] border-b border-[#161D2C]">
                            <span className="text-emerald-400 font-bold">${formatPrice(pos.tp1_price)}</span>
                            <span className="text-slate-500 mx-1">/</span>
                            <span className="text-rose-400 font-bold">${formatPrice(pos.sl_price)}</span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-[10.5px] text-slate-400 max-w-[150px] truncate border-b border-[#161D2C]">
                            {pos.notes ? `📝 ${pos.notes}` : (pos.side_rationale || '--')}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-right border-b border-[#161D2C]" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                className="bg-binance-card hover:bg-binance-hover text-binance-cyan border border-[#1E2638] px-2 py-1 rounded text-[10.5px] font-bold transition"
                                onClick={() => setSelectedForensics(pos)}
                              >
                                🔍 Chi Tiết
                              </button>
                              <button
                                className="bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1 rounded text-[10.5px] font-bold transition shadow"
                                onClick={() => handleClosePosition(pos.id)}
                              >
                                ✕ Đóng
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
          </div>
        )}

        {/* ── TAB 2: OPEN LIMIT ORDERS TABLE ── */}
        {activeTab === 'orders' && (
          <div className="bg-[#0B0E17] border border-[#1E2638] rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto max-h-[75vh]">
              <table className="w-full text-left font-mono text-[11px] border-separate border-spacing-0">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <SortableHeader title="Thời Gian" sortKey="time" currentKey={ordSort.key} currentDir={ordSort.dir} onSort={handleOrdSort} />
                    <SortableHeader title="Symbol / Sàn" sortKey="symbol" currentKey={ordSort.key} currentDir={ordSort.dir} onSort={handleOrdSort} />
                    <SortableHeader title="Chiều Lệnh" sortKey="side" currentKey={ordSort.key} currentDir={ordSort.dir} onSort={handleOrdSort} />
                    <SortableHeader title="Loại Lệnh" sortKey="type" currentKey={ordSort.key} currentDir={ordSort.dir} onSort={handleOrdSort} />
                    <SortableHeader title="Giá Đặt Limit" sortKey="entry" currentKey={ordSort.key} currentDir={ordSort.dir} onSort={handleOrdSort} />
                    <SortableHeader title="Mục Tiêu TP1" sortKey="tp1" currentKey={ordSort.key} currentDir={ordSort.dir} onSort={handleOrdSort} />
                    <SortableHeader title="Cắt Lỗ SL" sortKey="sl" currentKey={ordSort.key} currentDir={ordSort.dir} onSort={handleOrdSort} />
                    <th className="py-2.5 px-3 whitespace-nowrap border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400">Trạng Thái</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLimitOrders.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="py-16 text-center text-slate-500 font-mono border-b border-[#161D2C]">
                        <span className="text-2xl block mb-1">⏳</span>
                        <span className="text-sm font-bold text-slate-400">Không có lệnh Limit / FADE nào đang chờ khớp.</span>
                      </td>
                    </tr>
                  ) : (
                    sortedLimitOrders.map((ord, idx) => {
                      const isLong = ['BUY', 'LONG'].includes((ord.direction || '').toUpperCase());
                      return (
                        <tr key={idx} className="hover:bg-[#151D2F] transition">
                          <td className="py-2 px-3 whitespace-nowrap text-slate-400 text-[10px] border-b border-[#161D2C]">
                            {formatDate(ord.timestamp || ord.created_at)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-bold text-white border-b border-[#161D2C]">
                            <div className="flex items-center gap-1.5">
                              <span>{ord.symbol}</span>
                              <span className="text-[9px] bg-binance-card px-1.5 py-0.2 rounded border border-[#1E2638] text-slate-400">{ord.exchange || 'BINANCE'}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap border-b border-[#161D2C]">
                            <span className={`px-2 py-0.5 rounded font-black text-[10px] ${isLong ? 'bg-binance-green/20 text-binance-green' : 'bg-binance-red/20 text-binance-red'}`}>
                              {isLong ? '▲ BUY LIMIT' : '▼ SELL LIMIT'}
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-binance-yellow font-bold border-b border-[#161D2C]">
                            {ord.signal_type || 'FADE_LIMIT'}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-bold text-white border-b border-[#161D2C]">
                            ${formatPrice(ord.entry_price || ord.price)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-emerald-400 font-bold border-b border-[#161D2C]">
                            ${formatPrice(ord.tp1_price || ord.target)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-rose-400 font-bold border-b border-[#161D2C]">
                            ${formatPrice(ord.sl_price || ord.stop_loss)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap border-b border-[#161D2C]">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-binance-cyan/20 text-binance-cyan border border-binance-cyan/40">
                              ⚡ Chờ Khớp
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 3: LIVESTREAM SIGNALS RADAR TABLE ── */}
        {activeTab === 'signals' && (
          <div className="bg-[#0B0E17] border border-[#1E2638] rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto max-h-[75vh]">
              <table className="w-full text-left font-mono text-[11px] border-separate border-spacing-0">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <SortableHeader title="Thời Gian" sortKey="time" currentKey={sigSort.key} currentDir={sigSort.dir} onSort={handleSigSort} />
                    <SortableHeader title="Symbol / Sàn" sortKey="symbol" currentKey={sigSort.key} currentDir={sigSort.dir} onSort={handleSigSort} />
                    <SortableHeader title="Khung TF" sortKey="tf" currentKey={sigSort.key} currentDir={sigSort.dir} onSort={handleSigSort} />
                    <SortableHeader title="Chiều Lệnh" sortKey="side" currentKey={sigSort.key} currentDir={sigSort.dir} onSort={handleSigSort} />
                    <SortableHeader title="Loại Tín Hiệu" sortKey="type" currentKey={sigSort.key} currentDir={sigSort.dir} onSort={handleSigSort} />
                    <SortableHeader title="Entry Đề Xuất" sortKey="entry" currentKey={sigSort.key} currentDir={sigSort.dir} onSort={handleSigSort} />
                    <SortableHeader title="Chốt Lời TP1" sortKey="tp1" currentKey={sigSort.key} currentDir={sigSort.dir} onSort={handleSigSort} />
                    <SortableHeader title="Chốt Lời TP2" sortKey="tp2" currentKey={sigSort.key} currentDir={sigSort.dir} onSort={handleSigSort} />
                    <SortableHeader title="Cắt Lỗ SL" sortKey="sl" currentKey={sigSort.key} currentDir={sigSort.dir} onSort={handleSigSort} />
                    <th className="py-2.5 px-3 whitespace-nowrap border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400">Lý Do Kỹ Thuật</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSignals.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="py-16 text-center text-slate-500 font-mono border-b border-[#161D2C]">
                        <span className="text-2xl block mb-1">⚡</span>
                        <span className="text-sm font-bold text-slate-400">Chưa có tín hiệu SMC nào trong danh sách.</span>
                      </td>
                    </tr>
                  ) : (
                    sortedSignals.slice(0, 100).map((sig, idx) => {
                      const isLong = ['BUY', 'LONG'].includes((sig.direction || '').toUpperCase());
                      return (
                        <tr key={idx} className="hover:bg-[#151D2F] transition">
                          <td className="py-2 px-3 whitespace-nowrap text-slate-400 text-[10px] border-b border-[#161D2C]">
                            {formatDate(sig.timestamp || sig.created_at)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-bold text-white border-b border-[#161D2C]">
                            <div className="flex items-center gap-1.5">
                              <span>{sig.symbol}</span>
                              <span className="text-[9px] bg-binance-card px-1.5 py-0.2 rounded border border-[#1E2638] text-slate-400">{sig.exchange || 'BINANCE'}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-binance-cyan font-bold border-b border-[#161D2C]">
                            {sig.timeframe || '5m'}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap border-b border-[#161D2C]">
                            <span className={`px-2 py-0.5 rounded font-black text-[10px] ${isLong ? 'bg-binance-green/20 text-binance-green' : 'bg-binance-red/20 text-binance-red'}`}>
                              {isLong ? '▲ BUY' : '▼ SELL'}
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-binance-yellow font-bold border-b border-[#161D2C]">
                            {sig.signal_type}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-bold text-white border-b border-[#161D2C]">
                            ${formatPrice(sig.entry_price || sig.price)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-emerald-400 font-bold border-b border-[#161D2C]">
                            ${formatPrice(sig.tp1_price || sig.target)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-emerald-300 font-bold border-b border-[#161D2C]">
                            ${formatPrice(sig.tp2_price)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-rose-400 font-bold border-b border-[#161D2C]">
                            ${formatPrice(sig.sl_price || sig.stop_loss)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-slate-400 text-[10.5px] max-w-[200px] truncate border-b border-[#161D2C]">
                            {sig.rationale || sig.pattern || 'SMC FVG & Liquidity Sweep Confirmation'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 4: CLOSED HISTORY TABLE ── */}
        {activeTab === 'history' && (
          <div className="bg-[#0B0E17] border border-[#1E2638] rounded-xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto max-h-[75vh]">
              <table className="w-full text-left font-mono text-[11px] border-separate border-spacing-0">
                <thead className="sticky top-0 z-20">
                  <tr>
                    <SortableHeader title="Thời Gian Đóng" sortKey="time" currentKey={histSort.key} currentDir={histSort.dir} onSort={handleHistSort} />
                    <SortableHeader title="Symbol / Sàn" sortKey="symbol" currentKey={histSort.key} currentDir={histSort.dir} onSort={handleHistSort} />
                    <SortableHeader title="Vị Thế" sortKey="side" currentKey={histSort.key} currentDir={histSort.dir} onSort={handleHistSort} />
                    <th className="py-2.5 px-3 whitespace-nowrap border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400">Entry → Exit</th>
                    <SortableHeader title="Size Vị Thế" sortKey="size" currentKey={histSort.key} currentDir={histSort.dir} onSort={handleHistSort} />
                    <SortableHeader title="PnL Thực Nhận" sortKey="pnl" currentKey={histSort.key} currentDir={histSort.dir} onSort={handleHistSort} />
                    <SortableHeader title="Tỷ Suất ROE" sortKey="roe" currentKey={histSort.key} currentDir={histSort.dir} onSort={handleHistSort} />
                    <SortableHeader title="Kết Quả / Lý Do" sortKey="reason" currentKey={histSort.key} currentDir={histSort.dir} onSort={handleHistSort} />
                    <th className="py-2.5 px-3 whitespace-nowrap border-b border-[#1E2638] bg-[#090D16] text-[10.5px] uppercase font-bold text-slate-400 text-right">Chi Tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHistory.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="py-16 text-center text-slate-500 font-mono border-b border-[#161D2C]">
                        <span className="text-2xl block mb-1">📜</span>
                        <span className="text-sm font-bold text-slate-400">Chưa có lịch sử lệnh đã đóng.</span>
                      </td>
                    </tr>
                  ) : (
                    sortedHistory.map(trade => {
                      const isLong = ['BUY', 'LONG'].includes((trade.direction || '').toUpperCase());
                      const pnl = Number(trade.net_pnl_usd) || 0;
                      const isWin = pnl > 0;

                      return (
                        <tr
                          key={trade.id}
                          className="hover:bg-[#151D2F] transition cursor-pointer"
                          onClick={() => setSelectedForensics(trade)}
                        >
                          <td className="py-2 px-3 whitespace-nowrap text-slate-400 text-[10px] border-b border-[#161D2C]">
                            {formatDate(trade.close_time || trade.open_time)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-bold text-white border-b border-[#161D2C]">
                            <div className="flex items-center gap-1.5">
                              <span>{trade.symbol}</span>
                              <span className="text-[9px] text-slate-400 bg-binance-card px-1.5 py-0.2 rounded border border-[#1E2638]">{trade.exchange || 'BINANCE'}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap border-b border-[#161D2C]">
                            <span className={`px-2 py-0.5 rounded font-black text-[10px] ${isLong ? 'bg-binance-green/20 text-binance-green' : 'bg-binance-red/20 text-binance-red'}`}>
                              {isLong ? '▲ LONG' : '▼ SHORT'} {trade.leverage || 20}x
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-slate-200 border-b border-[#161D2C]">
                            ${formatPrice(trade.entry_price)} → ${formatPrice(trade.exit_price || trade.current_price)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-white font-bold border-b border-[#161D2C]">
                            ${formatPrice(trade.pos_size_usd)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap font-black border-b border-[#161D2C]">
                            <span className={`text-sm ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {pnl >= 0 ? '+' : ''}${formatPrice(pnl)}
                            </span>
                          </td>
                          <td className={`py-2 px-3 whitespace-nowrap font-bold border-b border-[#161D2C] ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {trade.roe_pct !== undefined ? `${Number(trade.roe_pct) >= 0 ? '+' : ''}${Number(trade.roe_pct).toFixed(2)}%` : '--'}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap border-b border-[#161D2C]">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isWin ? 'bg-emerald-950 text-emerald-400 border border-emerald-600/40' : 'bg-rose-950 text-rose-400 border border-rose-600/40'}`}>
                              {trade.exit_reason || trade.status || (isWin ? 'Chốt Lãi' : 'Cắt Lỗ')}
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-right border-b border-[#161D2C]" onClick={e => e.stopPropagation()}>
                            <button
                              className="bg-binance-card hover:bg-binance-hover text-binance-cyan border border-[#1E2638] px-2 py-1 rounded text-xs font-bold transition"
                              onClick={() => setSelectedForensics(trade)}
                            >
                              🔍 Chi Tiết
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 5: JOURNAL & STATS TABLE ── */}
        {activeTab === 'journal' && (
          <div className="bg-[#0B0E17] border border-[#1E2638] rounded-xl p-5 flex flex-col gap-4 font-mono shadow-2xl">
            <span className="text-base font-extrabold text-binance-yellow flex items-center gap-2">
              <span>📖</span>
              <span>TỔNG HỢP NHẬT KÝ & HIỆU SUẤT TRADING JOURNAL</span>
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-[#111726] rounded border border-[#1E2638]">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">TỔNG LỆNH ĐÃ ĐÓNG:</span>
                <b className="text-white text-lg">{closedPositions.length}</b>
              </div>
              <div className="p-3 bg-[#111726] rounded border border-[#1E2638]">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">WIN RATE TỔNG:</span>
                <b className="text-binance-yellow text-lg">{winRate.toFixed(1)}%</b>
              </div>
              <div className="p-3 bg-[#111726] rounded border border-[#1E2638]">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">HỆ SỐ LỢI NHUẬN:</span>
                <b className="text-white text-lg">{profitFactor.toFixed(2)}</b>
              </div>
              <div className="p-3 bg-[#111726] rounded border border-[#1E2638]">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">LÃI RÒNG:</span>
                <b className={`text-lg ${realizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>{realizedPnl >= 0 ? '+' : ''}${formatPrice(realizedPnl)}</b>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <a href="/" className="bg-binance-yellow hover:bg-binance-yellowHover text-black font-bold px-4 py-2 rounded-lg text-xs transition shadow">
                Mở Lịch PnL & Xuất Báo Cáo JSON Đầy Đủ Trên Terminal ➔
              </a>
            </div>
          </div>
        )}

      </main>

      {/* ── 4. FORENSICS MODAL ── */}
      {selectedForensics && (
        <LivestreamForensicsModal
          data={selectedForensics}
          onClose={() => setSelectedForensics(null)}
          onClosePosition={handleClosePosition}
        />
      )}

    </div>
  );
}

// Mount Livestream React Root
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<LivestreamApp />);
