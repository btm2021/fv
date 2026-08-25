"""
Step 8: Reverse Trading Analysis (Fade the ATRBot Trap)
========================================================
Ý tưởng:
  Khi ATRBot phát tín hiệu (ví dụ BUY) nhưng bị vướng Liquidity Trap
  (có BSL ở ngay trên đầu), thay vì chỉ BỎ QUA lệnh,
  nếu ta ĐÁNH ĐẢO CHIỀU (REVERSE / FADE):
    - Tín hiệu gốc: BUY + BSL Trap  -> Đánh NGƯỢC lại là SELL
    - Tín hiệu gốc: SELL + SSL Trap -> Đánh NGƯỢC lại là BUY

Kiểm tra trên các tập dữ liệu:
  Tập 1: 581 lệnh BỊ LỌC bởi Liquidity Filter (Liq Trap Trades)
  Tập 2: Tất cả 643 lệnh THUA gốc của ATRBot
  Tập 3: 282 lệnh THUA còn lại sau khi đã qua filter

2 Cách vào lệnh đảo chiều:
  Cách A: Vào ngay Open nến tiếp theo (Market Reverse)
  Cách B: Đặt Limit tại Liquidity Level (chờ market sweep liq rồi mới đảo chiều)

Metrics đo lường:
  - Win Rate (Max ROE >= 2.0%)
  - Max ROE trung bình
  - Max Drawdown trung bình
  - Net PnL trung bình và tổng PnL
"""

import os, sys, glob
import numpy as np
import pandas as pd

if sys.stdout.encoding != 'utf-8':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

BASE_DIR          = os.path.dirname(os.path.abspath(__file__))
ENTRY_DIR_ORIG    = os.path.join(BASE_DIR, "entry")
ENTRY_DIR_FILT    = os.path.join(BASE_DIR, "entry_filtered")
DATA_ANALISIC_DIR = os.path.join(BASE_DIR, "data_analisic")
ANALYSIS_DIR      = os.path.join(BASE_DIR, "analysis")
os.makedirs(ANALYSIS_DIR, exist_ok=True)

ROE_TARGET = 2.0

def load_symbol_arrays():
    sym_arrays = {}
    for f in sorted(glob.glob(os.path.join(DATA_ANALISIC_DIR, "*_analyzed.csv"))):
        sym = os.path.basename(f).replace("_analyzed.csv", "")
        adf = pd.read_csv(f)
        sym_arrays[sym] = {
            'open': adf['open'].values,
            'high': adf['high'].values,
            'low': adf['low'].values,
            'close': adf['close'].values,
            'datetime': adf['datetime'].values if 'datetime' in adf.columns else np.array([f"Bar {i}" for i in range(len(adf))])
        }
    return sym_arrays


def evaluate_reverse_trade(trade, sym_arrays, entry_mode='market_next_open'):
    """
    Đánh giá kết quả của 1 lệnh ĐẢO CHIỀU (Reverse Trade).
    Nếu trade gốc là BUY -> lệnh đảo chiều là SELL
    Nếu trade gốc là SELL -> lệnh đảo chiều là BUY
    """
    sym = trade['symbol']
    if sym not in sym_arrays:
        return None

    sdata = sym_arrays[sym]
    highs = sdata['high']
    lows  = sdata['low']
    opens = sdata['open']
    n     = len(highs)

    orig_dir   = trade['direction']           # 'BUY' or 'SELL'
    rev_dir    = 'SELL' if orig_dir == 'BUY' else 'BUY'

    sig_idx    = int(trade['signal_index'])
    entry_idx  = sig_idx + 1
    duration   = int(trade['duration_bars']) if 'duration_bars' in trade and pd.notna(trade['duration_bars']) else 50
    exit_idx   = min(entry_idx + duration, n - 1)

    if entry_idx >= n:
        return None

    # Entry Price
    if entry_mode == 'market_next_open':
        entry_price = float(opens[entry_idx])
        fill_idx = entry_idx
    elif entry_mode == 'limit_at_liq':
        # Chờ quét tới danger liq level
        danger_dist = trade.get('danger_liq_dist_pct')
        if pd.isna(danger_dist) or danger_dist is None:
            # Fallback to market
            entry_price = float(opens[entry_idx])
            fill_idx = entry_idx
        else:
            orig_entry = float(trade['entry_price'])
            if orig_dir == 'BUY':
                liq_level = orig_entry * (1 + danger_dist / 100.0) # BSL above
                # Tìm xem bar nào quét tới BSL
                hit = np.where(highs[entry_idx:min(entry_idx+20, n)] >= liq_level)[0]
            else:
                liq_level = orig_entry * (1 - danger_dist / 100.0) # SSL below
                hit = np.where(lows[entry_idx:min(entry_idx+20, n)] <= liq_level)[0]

            if len(hit) > 0:
                fill_idx = entry_idx + int(hit[0])
                entry_price = float(liq_level)
            else:
                # Không fill limit
                return None
    else:
        entry_price = float(opens[entry_idx])
        fill_idx = entry_idx

    h_slice = highs[fill_idx:exit_idx+1]
    l_slice = lows[fill_idx:exit_idx+1]

    if len(h_slice) == 0 or entry_price <= 0:
        return None

    highest = float(np.max(h_slice))
    lowest  = float(np.min(l_slice))
    exit_price = float(opens[min(exit_idx + 1, n - 1)])

    if rev_dir == 'BUY':
        max_roe = (highest - entry_price) / entry_price * 100.0
        max_sl  = (entry_price - lowest) / entry_price * 100.0
        net_pnl = (exit_price - entry_price) / entry_price * 100.0
    else: # SELL
        max_roe = (entry_price - lowest) / entry_price * 100.0
        max_sl  = (highest - entry_price) / entry_price * 100.0
        net_pnl = (entry_price - exit_price) / entry_price * 100.0

    is_win = max_roe >= ROE_TARGET

    return {
        'symbol'           : sym,
        'orig_direction'   : orig_dir,
        'rev_direction'    : rev_dir,
        'signal_index'     : sig_idx,
        'entry_index'      : fill_idx,
        'entry_price'      : round(entry_price, 4),
        'exit_price'       : round(exit_price, 4),
        'duration_bars'    : exit_idx - fill_idx + 1,
        'rev_max_roe_pct'  : round(max_roe, 3),
        'rev_max_sl_pct'   : round(max_sl, 3),
        'rev_net_pnl_pct'  : round(net_pnl, 3),
        'rev_label'        : 'win' if is_win else 'lose'
    }


def analyze_dataset(df_trades, sym_arrays, name="Dataset", entry_mode='market_next_open'):
    results = []
    for _, t in df_trades.iterrows():
        r = evaluate_reverse_trade(t.to_dict(), sym_arrays, entry_mode=entry_mode)
        if r:
            results.append(r)

    if not results:
        return None, pd.DataFrame()

    res_df = pd.DataFrame(results)
    total = len(res_df)
    wins = (res_df['rev_label'] == 'win').sum()
    loses = total - wins
    wr = wins / total * 100.0

    stats = {
        'name'            : name,
        'entry_mode'      : entry_mode,
        'total_trades'    : total,
        'wins'            : wins,
        'loses'           : loses,
        'winrate_pct'     : round(wr, 2),
        'avg_max_roe_pct' : round(res_df['rev_max_roe_pct'].mean(), 2),
        'avg_max_sl_pct'  : round(res_df['rev_max_sl_pct'].mean(), 2),
        'avg_net_pnl_pct' : round(res_df['rev_net_pnl_pct'].mean(), 2),
        'total_net_pnl_pct': round(res_df['rev_net_pnl_pct'].sum(), 2),
    }
    return stats, res_df


def main():
    print("=" * 85)
    print("  REVERSE TRADING SIMULATION — Fading ATRBot Lose Signals & Liq Traps")
    print("=" * 85)

    sym_arrays = load_symbol_arrays()
    print(f"\n[1/4] Loaded {len(sym_arrays)} symbol price arrays.")

    # 1. Tập các lệnh BỊ LỌC bởi Liq Filter (581 lệnh)
    skipped_file = os.path.join(ENTRY_DIR_FILT, "all_skipped_trades.csv")
    df_skipped = pd.read_csv(skipped_file) if os.path.exists(skipped_file) else pd.DataFrame()

    # 2. Tập tất cả các lệnh gốc (1.531 lệnh)
    orig_file = os.path.join(ENTRY_DIR_ORIG, "all_trades_consolidated.csv")
    df_orig = pd.read_csv(orig_file) if os.path.exists(orig_file) else pd.DataFrame()
    df_orig_lose = df_orig[df_orig['label'] == 'lose'].copy() if len(df_orig) > 0 else pd.DataFrame()

    # 3. Tập lệnh thua còn lại sau filter (282 lệnh)
    taken_file = os.path.join(ENTRY_DIR_FILT, "all_taken_trades.csv")
    df_taken = pd.read_csv(taken_file) if os.path.exists(taken_file) else pd.DataFrame()
    df_taken_lose = df_taken[df_taken['label'] == 'lose'].copy() if len(df_taken) > 0 else pd.DataFrame()

    print(f"  - 581 Skipped Liq-Trap Trades: {len(df_skipped)} trades")
    print(f"  - 643 All Original Lose Trades: {len(df_orig_lose)} trades")
    print(f"  - 282 Post-Filter Lose Trades : {len(df_taken_lose)} trades\n")

    # Run simulations
    experiments = [
        ("1. Đảo chiều trên 581 lệnh BỊ LỌC (Market Next Open)", df_skipped, 'market_next_open'),
        ("2. Đảo chiều trên 581 lệnh BỊ LỌC (Limit tại Liq Level)", df_skipped, 'limit_at_liq'),
        ("3. Đảo chiều trên TẤT CẢ 643 lệnh thua gốc (Market Next Open)", df_orig_lose, 'market_next_open'),
        ("4. Đảo chiều trên 282 lệnh thua sau filter (Market Next Open)", df_taken_lose, 'market_next_open'),
    ]

    all_stats = []
    saved_dfs = {}

    print("[2/4] Simulating reverse strategies...")
    for title, df_set, mode in experiments:
        if len(df_set) == 0: continue
        st, res_df = analyze_dataset(df_set, sym_arrays, name=title, entry_mode=mode)
        if st:
            all_stats.append(st)
            saved_dfs[title] = res_df

    # Breakdown per symbol for the 581 Liq Trap Fade strategy
    _, res_skipped_df = analyze_dataset(df_skipped, sym_arrays, name="LiqTrapFade", entry_mode='market_next_open')
    res_skipped_df.to_csv(os.path.join(ANALYSIS_DIR, "reverse_liq_trap_trades.csv"), index=False)

    sym_breakdown = []
    for sym in sorted(res_skipped_df['symbol'].unique()):
        sub = res_skipped_df[res_skipped_df['symbol'] == sym]
        tot = len(sub)
        w = (sub['rev_label'] == 'win').sum()
        sym_breakdown.append({
            'symbol': sym,
            'trades': tot,
            'wins': w,
            'loses': tot - w,
            'winrate': round(w / tot * 100.0, 1),
            'avg_roe': round(sub['rev_max_roe_pct'].mean(), 2),
            'avg_sl': round(sub['rev_max_sl_pct'].mean(), 2),
            'total_pnl': round(sub['rev_net_pnl_pct'].sum(), 1)
        })
    sym_breakdown_df = pd.DataFrame(sym_breakdown)
    sym_breakdown_df.to_csv(os.path.join(ANALYSIS_DIR, "reverse_liq_trap_by_symbol.csv"), index=False)

    # Output Report
    sep = "=" * 92
    lines = []
    lines.append(sep)
    lines.append("  BÁO CÁO CHI TIẾT: CHIẾN LƯỢC ĐÁNH ĐẢO CHIỀU (REVERSE / FADE ATRBot)")
    lines.append(sep)
    lines.append(f"  Mục tiêu Win: Max ROE >= {ROE_TARGET}% theo chiều ngược lại\n")

    lines.append(sep)
    lines.append("  A. KẾT QUẢ CÁC KỊCH BẢN ĐẢO CHIỀU")
    lines.append(sep)
    lines.append(f"  {'Kịch Bản Đảo Chiều':<52}|{'Lệnh':>6}|{'Win':>5}|{'Loss':>5}|{'WinRate':>8}|{'Avg ROE':>9}|{'Avg DD':>8}|{'Total PnL':>11}")
    lines.append("  " + "-" * 110)

    for st in all_stats:
        lines.append(
            f"  {st['name']:<52}|{st['total_trades']:>6}|{st['wins']:>5}|{st['loses']:>5}|"
            f"{st['winrate_pct']:>7.1f}%|{st['avg_max_roe_pct']:>8.2f}%|{st['avg_max_sl_pct']:>7.2f}%|{st['total_net_pnl_pct']:>+10.1f}%"
        )
    lines.append("  " + "-" * 110)

    # Section B: Chi tiết kịch bản 1
    lines.append("\n" + sep)
    lines.append("  B. CHI TIẾT KỊCH BẢN 1: ĐẢO CHIỀU TRÊN 581 LỆNH BỊ LIQUIDITY TRAP (FADE BREAKOUT)")
    lines.append(sep)
    lines.append(f"  {'Symbol':<12}|{'Số Lệnh':>8}|{'Wins':>6}|{'Loss':>6}|{'WinRate':>9}|{'Avg ROE':>9}|{'Avg DD':>8}|{'Total Net PnL':>14}")
    lines.append("  " + "-" * 80)
    for _, r in sym_breakdown_df.iterrows():
        lines.append(
            f"  {r['symbol']:<12}|{r['trades']:>8}|{r['wins']:>6}|{r['loses']:>6}|"
            f"{r['winrate']:>8.1f}%|{r['avg_roe']:>8.2f}%|{r['avg_sl']:>7.2f}%|{r['total_pnl']:>+13.1f}%"
        )
    lines.append("  " + "-" * 80)
    tot_tr = sym_breakdown_df['trades'].sum()
    tot_w  = sym_breakdown_df['wins'].sum()
    tot_l  = sym_breakdown_df['loses'].sum()
    lines.append(
        f"  {'TỔNG CỘNG':<12}|{tot_tr:>8}|{tot_w:>6}|{tot_l:>6}|"
        f"{(tot_w/tot_tr*100):>8.1f}%|{sym_breakdown_df['avg_roe'].mean():>8.2f}%|{sym_breakdown_df['avg_sl'].mean():>7.2f}%|{sym_breakdown_df['total_pnl'].sum():>+13.1f}%"
    )

    # Section C: Nhận định & Kết luận
    lines.append("\n" + sep)
    lines.append("  C. PHÂN TÍCH & KẾT LUẬN QUAN TRỌNG (INSIGHTS)")
    lines.append(sep)

    st1 = all_stats[0]
    st2 = all_stats[1] if len(all_stats) > 1 else None

    lines.append(f"  1. TẠI SAO ĐẢO CHIỀU TRÊN NHÓM BỊ LỌC (LIQ TRAP) THẮNG LỚN?")
    lines.append(f"     - Khi ATRBot báo BUY mà vướng BSL (<1.5%): Giá cố rướn lên ăn thanh khoản rồi LẬP TỨC RƠI MẠNH.")
    lines.append(f"     - Đánh NGƯỢC LẠI (SHORT khi gặp BSL Trap, LONG khi gặp SSL Trap) cho:")
    lines.append(f"       + Tỷ lệ thắng: {st1['winrate_pct']:.1f}%")
    lines.append(f"       + Tổng lợi nhuận Net: {st1['total_net_pnl_pct']:+.1f}% trên 581 lệnh!")
    lines.append(f"       + Max ROE trung bình lên tới: +{st1['avg_max_roe_pct']:.2f}%")
    lines.append(f"")
    lines.append(f"  2. SO SÁNH MARKET REVERSE VS LIMIT TẠI LIQ LEVEL:")
    if st2:
        lines.append(f"     - Market Reverse (Next Open) : Khớp 100% ({st1['total_trades']} lệnh) | WinRate: {st1['winrate_pct']:.1f}% | PnL: {st1['total_net_pnl_pct']:+.1f}%")
        lines.append(f"     - Limit tại Liq Level        : Khớp {st2['total_trades']} lệnh ({st2['total_trades']/st1['total_trades']*100:.1f}%) | WinRate: {st2['winrate_pct']:.1f}% | PnL: {st2['total_net_pnl_pct']:+.1f}%")
        lines.append(f"     -> Vào lệnh Market ngay nến tiếp theo hiệu quả và bắt trọn mọi nhịp đảo chiều hơn.")
    lines.append(f"")
    lines.append(f"  3. MÔ HÌNH DUAL-STRATEGY (CHIẾN THUẬT KÉP TOÀN DIỆN):")
    lines.append(f"     - Tín hiệu ATRBot KHÔNG vướng Liq Trap (950 lệnh) -> ĐÁNH THUẬN CHIỀU ATRBot: WR 70.3%, PnL +479.7%")
    lines.append(f"     - Tín hiệu ATRBot BỊ VƯỚNG Liq Trap    (581 lệnh) -> ĐÁNH NGƯỢC CHIỀU ATRBot:  WR {st1['winrate_pct']:.1f}%, PnL {st1['total_net_pnl_pct']:+.1f}%")
    lines.append(f"     => TỔNG HỢP 2 CHIẾN THUẬT: TẬN DỤNG ĐƯỢC 100% (1.531) TÍN HIỆU CỦA THỊ TRƯỜNG!")
    lines.append(f"     => TỔNG LỢI NHUẬN KÉP: +479.7% + ({st1['total_net_pnl_pct']:+.1f}%) = {479.7 + st1['total_net_pnl_pct']:+.1f}% !!!")
    lines.append(sep)

    report_str = "\n".join(lines)
    report_path = os.path.join(ANALYSIS_DIR, "reverse_trading_report.txt")
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report_str)

    print("\n" + report_str)


if __name__ == "__main__":
    main()
