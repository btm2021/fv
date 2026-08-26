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

// ── 2. MAIN LIVESTREAM TRACKER APPLICATION ──
function LivestreamApp() {
  const [activeTab, setActiveTab] = useState('positions'); // positions, signals, orders, history, journal
  const [exchangeFilter, setExchangeFilter] = useState('ALL');
  const [pnlSortOrder, setPnlSortOrder] = useState('pnl_desc'); // pnl_desc, pnl_asc, roe_desc, size_desc, time_desc
  const [isStreamMode, setIsStreamMode] = useState(false); // OBS Studio compact broadcast mode
  const [searchQuery, setSearchQuery] = useState('');

  // Data States
  const [status, setStatus] = useState({});
  const [performance, setPerformance] = useState({});
  const [activePositions, setActivePositions] = useState([]);
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

  // Fetch Full Data
  const fetchData = useCallback(async () => {
    try {
      const [resStatus, resPos, resSig, resJour] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/positions').then(r => r.json()),
        fetch('/api/signals?limit=150').then(r => r.json()),
        fetch('/api/journal').then(r => r.json())
      ]);

      if (resStatus.success) {
        setStatus(resStatus.status || {});
        if (resStatus.stats) setPerformance(resStatus.stats);
      }
      if (resPos.success) {
        setActivePositions(resPos.positions || []);
      }
      if (resSig.success) {
        setSignals(resSig.data || []);
      }
      if (resJour.success && resJour.data && resJour.data.trades) {
        setClosedPositions(resJour.data.trades.filter(t => t.status !== 'ACTIVE'));
      }
    } catch (err) {
      console.warn('Livestream fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // WebSocket Live Connection
  useEffect(() => {
    fetchData();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:8080';
    const ws = new WebSocket(`${protocol}//${host}`);

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
        }
      } catch (err) {}
    };

    return () => {
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
      const pnlA = Number(a.net_pnl_usd) || 0;
      const pnlB = Number(b.net_pnl_usd) || 0;
      const roeA = Number(a.roe_pct) || 0;
      const roeB = Number(b.roe_pct) || 0;
      const sizeA = Number(a.pos_size_usd) || 0;
      const sizeB = Number(b.pos_size_usd) || 0;

      if (pnlSortOrder === 'pnl_desc') return pnlB - pnlA;
      if (pnlSortOrder === 'pnl_asc') return pnlA - pnlB;
      if (pnlSortOrder === 'roe_desc') return roeB - roeA;
      if (pnlSortOrder === 'size_desc') return sizeB - sizeA;
      return (b.open_time || 0) - (a.open_time || 0);
    });

    return list;
  }, [activePositions, exchangeFilter, searchQuery, pnlSortOrder]);

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
      const pnlA = Number(a.net_pnl_usd) || 0;
      const pnlB = Number(b.net_pnl_usd) || 0;
      if (pnlSortOrder === 'pnl_desc') return pnlB - pnlA;
      if (pnlSortOrder === 'pnl_asc') return pnlA - pnlB;
      return (b.close_time || b.open_time || 0) - (a.close_time || a.open_time || 0);
    });

    return list;
  }, [closedPositions, exchangeFilter, searchQuery, pnlSortOrder]);

  // Financial Stats
  const walletBalance = performance.wallet_balance || 1000.0;
  const unrealizedPnl = performance.unrealized_pnl_usd || 0.0;
  const realizedPnl = performance.net_realized_pnl_usd || 0.0;
  const winRate = performance.win_rate_pct || 0.0;
  const profitFactor = performance.profit_factor || 0.0;

  return (
    <div className="flex flex-col min-h-screen bg-[#080B11] text-slate-200 font-sans text-xs select-none pb-12">
      
      {/* ── 1. TOP LIVESTREAM HUD & BROADCAST HEADER ── */}
      <header className="sticky top-0 z-30 bg-[#0C101A]/95 backdrop-blur-md border-b border-binance-border px-3 sm:px-6 py-2.5 flex flex-col gap-2.5 shadow-lg">
        
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
            <span className="text-binance-yellow font-bold bg-[#141A28] px-2.5 py-1 rounded border border-binance-border">
              ⏱️ {timeStr}
            </span>

            {/* Stream OBS Mode Toggle */}
            <button
              className={`px-2.5 py-1 rounded font-bold border transition flex items-center gap-1 ${isStreamMode ? 'bg-binance-purple text-white border-binance-purple' : 'bg-binance-subpanel text-slate-300 border-binance-border hover:text-white'}`}
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

        {/* Second Line: Executive Metric Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 font-mono">
          <div className="p-2 bg-[#111726] rounded border border-binance-border flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">SỐ DƯ VÍ (EQUITY)</span>
            <span className="font-bold text-white text-sm">${formatPrice(walletBalance)}</span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-binance-border flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">PNL ĐANG CHẠY (UNREALIZED)</span>
            <span className={`font-black text-sm ${unrealizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
              {unrealizedPnl >= 0 ? '+' : ''}${formatPrice(unrealizedPnl)}
            </span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-binance-border flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">LÃI RÒNG ĐÃ CHỐT</span>
            <span className={`font-bold text-sm ${realizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>
              {realizedPnl >= 0 ? '+' : ''}${formatPrice(realizedPnl)}
            </span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-binance-border flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">WIN RATE (%)</span>
            <span className="font-bold text-binance-yellow text-sm">{winRate.toFixed(1)}%</span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-binance-border flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">PROFIT FACTOR</span>
            <span className="font-bold text-white text-sm">{profitFactor.toFixed(2)}</span>
          </div>
          <div className="p-2 bg-[#111726] rounded border border-binance-border flex flex-col justify-between">
            <span className="text-slate-400 text-[10px] uppercase font-bold">VỊ THẾ ĐANG MỞ</span>
            <span className="font-black text-binance-cyan text-sm">{activePositions.length} Lệnh Active</span>
          </div>
        </div>

      </header>

      {/* ── 2. TOOLBAR: TABS, PNL SORTING & EXCHANGE FILTERS ── */}
      <div className="px-3 sm:px-6 py-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-[#0B0E17] border-b border-binance-border font-mono">
        
        {/* Navigation Tabs */}
        <div className="flex items-center bg-[#111726] p-1 rounded-lg border border-binance-border gap-1 overflow-x-auto w-full md:w-auto">
          {[
            { id: 'positions', label: `🔴 Vị Thế Đang Mở (${activePositions.length})` },
            { id: 'signals', label: `⚡ Tín Hiệu Livestream (${signals.length})` },
            { id: 'history', label: `📜 Lịch Sử Lệnh (${closedPositions.length})` },
            { id: 'journal', label: `📖 Nhật Ký & Forensics` }
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

        {/* PnL Sort Controls & Search */}
        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
          
          {/* PnL Sort Dropdown Button */}
          <div className="flex items-center bg-[#111726] border border-binance-border rounded-lg px-2 py-1 gap-1.5 text-xs">
            <span className="text-slate-400 text-[11px] font-bold">📊 SẮP XẾP PNL:</span>
            <select
              value={pnlSortOrder}
              onChange={e => setPnlSortOrder(e.target.value)}
              className="bg-transparent text-binance-yellow font-bold focus:outline-none cursor-pointer"
            >
              <option value="pnl_desc" className="bg-[#111726] text-white">🟢 PnL Lãi Nhất ➔ Thấp</option>
              <option value="pnl_asc" className="bg-[#111726] text-white">🔴 PnL Lỗ Nhất ➔ Cao</option>
              <option value="roe_desc" className="bg-[#111726] text-white">🎯 ROE % Cao Nhất</option>
              <option value="size_desc" className="bg-[#111726] text-white">💵 Size Lệnh Lớn Nhất</option>
              <option value="time_desc" className="bg-[#111726] text-white">⏱️ Mới Nhất Trước</option>
            </select>
          </div>

          {/* Exchange Filter */}
          <div className="flex items-center bg-[#111726] border border-binance-border rounded-lg p-0.5 gap-0.5 text-[11px]">
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
            className="bg-[#111726] border border-binance-border rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-binance-yellow w-28 sm:w-36 font-mono"
          />

          <button
            className="bg-binance-subpanel hover:bg-binance-hover px-2.5 py-1 rounded-lg border border-binance-border text-xs font-bold text-slate-200 transition"
            onClick={fetchData}
            title="Tải lại dữ liệu"
          >
            🔄
          </button>
        </div>

      </div>

      {/* ── 3. MAIN TAB CONTENT ── */}
      <main className="flex-1 p-3 sm:p-6 overflow-y-auto">
        
        {/* ── TAB 1: ACTIVE POSITIONS ── */}
        {activeTab === 'positions' && (
          <div className="flex flex-col gap-4">
            
            {sortedActivePositions.length === 0 ? (
              <div className="py-16 text-center text-slate-500 bg-[#0C101A] border border-binance-border rounded-xl font-mono">
                <span className="text-3xl block mb-2">⚡</span>
                <span className="text-sm font-bold text-slate-400">Hiện không có vị thế mở nào khớp với bộ lọc.</span>
                <p className="text-[11px] text-slate-500 mt-1">Hệ thống Scanner 24/7 đang quét 3,945 cặp phái sinh để tìm tín hiệu SMC mới nhất.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {sortedActivePositions.map(pos => {
                  const isLong = (pos.direction || '').toUpperCase() === 'LONG';
                  const pnl = Number(pos.net_pnl_usd) || 0;
                  const roe = Number(pos.roe_pct) || 0;
                  const isProfit = pnl >= 0;

                  return (
                    <div
                      key={pos.id}
                      className={`p-4 rounded-xl border transition flex flex-col justify-between gap-3 bg-[#0F1420] ${isProfit ? 'border-emerald-500/60 shadow-lg shadow-emerald-950/20' : 'border-rose-500/60 shadow-lg shadow-rose-950/20'}`}
                    >
                      {/* Top: Symbol, Exchange & Side */}
                      <div className="flex items-center justify-between border-b border-binance-border pb-2.5 font-mono">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm text-white">{pos.symbol}</span>
                          <span className="text-[10px] bg-binance-card px-1.5 py-0.2 rounded border border-binance-borderSubtle font-bold text-slate-400">{pos.exchange || 'BINANCE'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded font-black text-[10.5px] ${isLong ? 'bg-binance-green/20 text-binance-green border border-binance-green/40' : 'bg-binance-red/20 text-binance-red border border-binance-red/40'}`}>
                            {isLong ? '▲ LONG' : '▼ SHORT'} {pos.leverage || 20}x
                          </span>
                        </div>
                      </div>

                      {/* Middle: Live PnL Strip */}
                      <div className="flex items-center justify-between py-1 bg-[#080B11] px-3 rounded-lg border border-binance-borderSubtle font-mono">
                        <div>
                          <span className="text-[10px] text-slate-400 block uppercase font-bold">LỢI NHUẬN (PNL)</span>
                          <span className={`text-xl font-black ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isProfit ? '+' : ''}${formatPrice(pnl)}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-400 block uppercase font-bold">TỶ SUẤT ROE</span>
                          <span className={`text-base font-black ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {roe >= 0 ? '+' : ''}{roe.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      {/* Prices Grid */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-[#121824] p-2.5 rounded-lg border border-binance-border/60">
                        <div>
                          <span className="text-slate-400 block text-[10px]">ENTRY:</span>
                          <b className="text-white">${formatPrice(pos.entry_price)}</b>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">MARK PRICE:</span>
                          <b className="text-binance-yellow">${formatPrice(pos.current_price || pos.entry_price)}</b>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">SIZE / MARGIN:</span>
                          <b className="text-white">${formatPrice(pos.pos_size_usd)} <span className="text-[10px] text-slate-400">(${formatPrice(pos.initial_margin)})</span></b>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">SL / TP1:</span>
                          <span className="text-rose-400 font-bold">${formatPrice(pos.sl_price)}</span> / <span className="text-emerald-400 font-bold">${formatPrice(pos.tp1_price)}</span>
                        </div>
                      </div>

                      {/* Notes / Rationale */}
                      {pos.notes && (
                        <div className="text-[10.5px] bg-binance-yellow/10 border border-binance-yellow/30 text-binance-yellow px-2 py-1 rounded truncate">
                          📝 {pos.notes}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-binance-border/60 font-mono">
                        <button
                          className="bg-binance-card hover:bg-binance-hover text-binance-cyan border border-binance-border px-2.5 py-1 rounded text-xs font-bold transition flex items-center gap-1"
                          onClick={() => setSelectedForensics(pos)}
                        >
                          <span>🔍</span>
                          <span>Báo Cáo Chi Tiết</span>
                        </button>
                        <button
                          className="bg-binance-red/80 hover:bg-binance-red text-white px-3 py-1 rounded text-xs font-bold transition shadow"
                          onClick={() => handleClosePosition(pos.id)}
                        >
                          ✕ Đóng Lệnh
                        </button>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* ── TAB 2: LIVESTREAM SIGNALS & RADAR ── */}
        {activeTab === 'signals' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {signals.slice(0, 60).map((sig, idx) => {
                const isLong = (sig.direction || '').toUpperCase() === 'LONG';
                return (
                  <div key={idx} className="p-3.5 bg-[#0F1420] border border-binance-border rounded-xl flex flex-col justify-between gap-2.5 font-mono">
                    <div className="flex items-center justify-between border-b border-binance-border pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-white">{sig.symbol}</span>
                        <span className="text-[10px] bg-binance-card px-1.5 py-0.2 rounded border border-binance-border text-slate-400">{sig.exchange || 'BINANCE'}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded font-black text-[10px] ${isLong ? 'bg-binance-green/20 text-binance-green' : 'bg-binance-red/20 text-binance-red'}`}>
                        {isLong ? '▲ LONG' : '▼ SHORT'} {sig.timeframe || '15m'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-[11px] bg-[#090D16] p-2 rounded border border-binance-borderSubtle">
                      <div>
                        <span className="text-slate-400 block text-[10px]">ENTRY:</span>
                        <b className="text-white">${formatPrice(sig.entry_price || sig.price)}</b>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">TP1:</span>
                        <b className="text-emerald-400">${formatPrice(sig.tp1_price || sig.target)}</b>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">STOP LOSS:</span>
                        <b className="text-rose-400">${formatPrice(sig.sl_price || sig.stop_loss)}</b>
                      </div>
                    </div>

                    <div className="text-[10.5px] text-slate-400 truncate">
                      {sig.rationale || sig.pattern || 'SMC Liquidity & FVG Retest Confirmation'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TAB 3: CLOSED HISTORY (SORTED PNL) ── */}
        {activeTab === 'history' && (
          <div className="bg-[#0F1420] border border-binance-border rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="bg-[#090D16] text-slate-400 sticky top-0 z-10 border-b border-binance-border text-[10px] uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Thời Gian</th>
                    <th className="py-2.5 px-3">Symbol / Sàn</th>
                    <th className="py-2.5 px-3">Vị Thế</th>
                    <th className="py-2.5 px-3">Entry → Exit</th>
                    <th className="py-2.5 px-3">Size Vị Thế</th>
                    <th className="py-2.5 px-3">PnL Thực Nhận</th>
                    <th className="py-2.5 px-3">Kết Quả</th>
                    <th className="py-2.5 px-3 text-right">Chi Tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-binance-border/40">
                  {sortedHistory.map(trade => {
                    const isLong = (trade.direction || '').toUpperCase() === 'LONG';
                    const pnl = Number(trade.net_pnl_usd) || 0;
                    const isWin = pnl > 0;

                    return (
                      <tr key={trade.id} className="hover:bg-binance-hover/50 transition cursor-pointer" onClick={() => setSelectedForensics(trade)}>
                        <td className="py-2.5 px-3 whitespace-nowrap text-slate-300">
                          {formatDate(trade.close_time || trade.open_time)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="text-white font-bold block">{trade.symbol}</span>
                          <span className="text-[9.5px] text-slate-400">{trade.exchange || 'BINANCE'}</span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded font-black text-[10px] ${isLong ? 'bg-binance-green/20 text-binance-green' : 'bg-binance-red/20 text-binance-red'}`}>
                            {isLong ? '▲ LONG' : '▼ SHORT'} {trade.leverage || 20}x
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          ${formatPrice(trade.entry_price)} → ${formatPrice(trade.exit_price || trade.current_price)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          ${formatPrice(trade.pos_size_usd)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-black">
                          <span className={isWin ? 'text-emerald-400' : 'text-rose-400'}>
                            {pnl >= 0 ? '+' : ''}${formatPrice(pnl)}
                          </span>
                          <span className="text-[10px] text-slate-400 block">{trade.roe_pct !== undefined ? `${Number(trade.roe_pct).toFixed(2)}% ROE` : ''}</span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isWin ? 'bg-emerald-950 text-emerald-400 border border-emerald-600/40' : 'bg-rose-950 text-rose-400 border border-rose-600/40'}`}>
                            {trade.exit_reason || trade.status || (isWin ? 'Chốt Lãi' : 'Cắt Lỗ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-right">
                          <button className="bg-binance-card hover:bg-binance-hover text-binance-cyan border border-binance-border px-2 py-1 rounded text-xs font-bold" onClick={(e) => { e.stopPropagation(); setSelectedForensics(trade); }}>
                            🔍 Chi Tiết
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 4: JOURNAL & STATS EMBED ── */}
        {activeTab === 'journal' && (
          <div className="bg-[#0F1420] border border-binance-border rounded-xl p-5 flex flex-col gap-4 font-mono">
            <span className="text-base font-extrabold text-binance-yellow flex items-center gap-2">
              <span>📖</span>
              <span>TỔNG HỢP NHẬT KÝ & HIỆU SUẤT TRADING JOURNAL</span>
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-[#111726] rounded border border-binance-border">
                <span className="text-slate-400 block text-[10px]">TỔNG LỆNH ĐÃ ĐÓNG:</span>
                <b className="text-white text-base">{closedPositions.length}</b>
              </div>
              <div className="p-3 bg-[#111726] rounded border border-binance-border">
                <span className="text-slate-400 block text-[10px]">WIN RATE TỔNG:</span>
                <b className="text-binance-yellow text-base">{winRate.toFixed(1)}%</b>
              </div>
              <div className="p-3 bg-[#111726] rounded border border-binance-border">
                <span className="text-slate-400 block text-[10px]">HỆ SỐ LỢI NHUẬN:</span>
                <b className="text-white text-base">{profitFactor.toFixed(2)}</b>
              </div>
              <div className="p-3 bg-[#111726] rounded border border-binance-border">
                <span className="text-slate-400 block text-[10px]">LÃI RÒNG:</span>
                <b className={`text-base ${realizedPnl >= 0 ? 'text-binance-green' : 'text-binance-red'}`}>{realizedPnl >= 0 ? '+' : ''}${formatPrice(realizedPnl)}</b>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <a href="/" className="bg-binance-yellow text-black font-bold px-4 py-2 rounded-lg text-xs transition">
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
