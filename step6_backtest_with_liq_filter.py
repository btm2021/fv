"""
Step 6: ATRBot Backtest WITH Liquidity Zone Filter
====================================================
Chạy lại toàn bộ backtest ATRBot nhưng có thêm rule lọc lệnh dựa trên Liquidity Zone:

RULE:
  BUY  signal → kiểm tra BSL (Buy Side Liquidity) trong vòng LIQ_FILTER_PCT phía TRÊN
                → Nếu có → BỎ QUA lệnh này
  SELL signal → kiểm tra SSL (Sell Side Liquidity) trong vòng LIQ_FILTER_PCT phía DƯỚI
                → Nếu có → BỎ QUA lệnh này

Output:
  entry_filtered/  → CSV entry đã lọc từng symbol
  entry_filtered/summary_filtered.csv
  entry_filtered/comparison_report.txt  → So sánh trước/sau filter
"""

import os
import sys
import glob
import numpy as np
import pandas as pd

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_ANALISIC_DIR = os.path.join(BASE_DIR, "data_analisic")
ENTRY_DIR_ORIG = os.path.join(BASE_DIR, "entry")           # kết quả cũ (không filter)
ENTRY_DIR_NEW  = os.path.join(BASE_DIR, "entry_filtered")  # kết quả mới (có filter)

ROE_THRESHOLD_PCT = 2.0    # lệnh win nếu giá chạy đúng hướng >= 2%
LIQ_FILTER_PCT    = 1.5    # ngưỡng: bỏ qua nếu danger liq trong vòng 1.5% từ entry


# ──────────────────────────────────────────────
# Helper: build danh sách liq zones từ analyzed
# ──────────────────────────────────────────────
def build_liq_zones(df: pd.DataFrame) -> list:
    zones = []
    for i, row in df.iterrows():
        liq = row['smc_liquidity']
        if pd.isna(liq) or liq == 0:
            continue
        liq_end = int(row['smc_liq_end_index']) if pd.notna(row['smc_liq_end_index']) else 999999
        swept_raw = row['smc_liq_swept_index']
        swept = int(swept_raw) if (pd.notna(swept_raw) and swept_raw > 0) else None
        lev = float(row['smc_liq_level']) if pd.notna(row['smc_liq_level']) else None
        zones.append({
            'start': i,
            'end': liq_end,
            'swept': swept,
            'type': 'BSL' if liq > 0 else 'SSL',  # BSL = phía trên, SSL = phía dưới
            'level': lev
        })
    return zones


def get_active_zones_at(bar_idx: int, zones: list) -> list:
    """Trả về danh sách liq zones đang hoạt động tại bar bar_idx (chưa bị sweep)."""
    result = []
    for z in zones:
        if z['start'] <= bar_idx <= z['end']:
            if z['swept'] is None or z['swept'] > bar_idx:
                result.append(z)
    return result


def is_danger_liq_nearby(bar_idx: int, direction: str, entry_price: float,
                          zones: list, threshold_pct: float) -> tuple:
    """
    Kiểm tra xem có liq zone nguy hiểm gần entry không.

    BUY  → nguy hiểm nếu có BSL trong vòng threshold_pct% PHÍA TRÊN entry
    SELL → nguy hiểm nếu có SSL trong vòng threshold_pct% PHÍA DƯỚI entry

    Trả về: (is_dangerous: bool, nearest_danger_pct: float or None, zone_type: str)
    """
    active = get_active_zones_at(bar_idx, zones)

    if direction == 'BUY':
        # BSL phía trên = market sẽ hunt lên sweep rồi drop
        danger_zones = [
            z for z in active
            if z['type'] == 'BSL' and z['level'] is not None and z['level'] > entry_price
        ]
        dists = [(z['level'] - entry_price) / entry_price * 100 for z in danger_zones]
    else:  # SELL
        # SSL phía dưới = market sẽ hunt xuống sweep rồi pump
        danger_zones = [
            z for z in active
            if z['type'] == 'SSL' and z['level'] is not None and z['level'] < entry_price
        ]
        dists = [(entry_price - z['level']) / entry_price * 100 for z in danger_zones]

    if not dists:
        return False, None, ''

    nearest = min(dists)
    is_danger = nearest < threshold_pct
    zone_label = 'BSL' if direction == 'BUY' else 'SSL'
    return is_danger, round(nearest, 3), zone_label


# ──────────────────────────────────────────────
# Core backtest (với filter)
# ──────────────────────────────────────────────
def evaluate_with_filter(file_path: str) -> tuple:
    """
    Chạy backtest cho 1 symbol với Liq Zone Filter.
    Trả về (trades_taken_df, trades_skipped_df)
    """
    sym = os.path.basename(file_path).replace("_analyzed.csv", "")
    df = pd.read_csv(file_path).reset_index(drop=True)
    n = len(df)

    opens      = df['open'].values
    highs      = df['high'].values
    lows       = df['low'].values
    closes     = df['close'].values
    timestamps = df['timestamp'].values
    datetimes  = df['datetime'].values if 'datetime' in df.columns else [f"Bar {i}" for i in range(n)]
    buys       = df['atrbot_buy'].fillna(False).astype(bool).values
    sells      = df['atrbot_sell'].fillna(False).astype(bool).values

    # Build liq zones một lần duy nhất
    all_liq_zones = build_liq_zones(df)

    # Lấy tất cả signal bars
    signals = []
    for i in range(n):
        if buys[i]:
            signals.append((i, 'BUY'))
        elif sells[i]:
            signals.append((i, 'SELL'))

    taken_trades   = []
    skipped_trades = []

    for s_idx, (sig_bar, direction) in enumerate(signals):
        entry_bar = sig_bar + 1
        if entry_bar >= n:
            break

        entry_price = float(opens[entry_bar])

        # ── LIQ FILTER CHECK ──
        is_danger, danger_dist, zone_type = is_danger_liq_nearby(
            sig_bar, direction, entry_price, all_liq_zones, LIQ_FILTER_PCT
        )

        # Tìm exit bar
        if s_idx < len(signals) - 1:
            exit_signal_bar, _ = signals[s_idx + 1]
            exit_bar = exit_signal_bar
        else:
            exit_bar = n - 1
        if exit_bar < entry_bar:
            exit_bar = entry_bar

        # Tính các metrics
        cycle_highs = highs[entry_bar:exit_bar + 1]
        cycle_lows  = lows[entry_bar:exit_bar + 1]
        if len(cycle_highs) == 0 or entry_price <= 0:
            continue

        highest = float(np.max(cycle_highs))
        lowest  = float(np.min(cycle_lows))

        if exit_bar + 1 < n:
            exit_price = float(opens[exit_bar + 1])
            exit_dt    = datetimes[exit_bar + 1]
            exit_time  = int(timestamps[exit_bar + 1])
        else:
            exit_price = float(closes[exit_bar])
            exit_dt    = datetimes[exit_bar]
            exit_time  = int(timestamps[exit_bar])

        if direction == 'BUY':
            max_roe      = (highest - entry_price) / entry_price * 100
            max_sl       = (entry_price - lowest) / entry_price * 100
            net_pnl      = (exit_price - entry_price) / entry_price * 100
            peak_fav     = highest
            max_adv      = lowest
        else:
            max_roe      = (entry_price - lowest) / entry_price * 100
            max_sl       = (highest - entry_price) / entry_price * 100
            net_pnl      = (entry_price - exit_price) / entry_price * 100
            peak_fav     = lowest
            max_adv      = highest

        label = 'win' if max_roe >= ROE_THRESHOLD_PCT else 'lose'
        duration = exit_bar - entry_bar + 1

        record = {
            'entry_id'          : len(taken_trades) + len(skipped_trades) + 1,
            'symbol'            : sym,
            'direction'         : direction,
            'signal_index'      : sig_bar,
            'signal_datetime'   : datetimes[sig_bar],
            'entry_index'       : entry_bar,
            'entry_datetime'    : datetimes[entry_bar],
            'entry_price'       : round(entry_price, 4),
            'exit_datetime'     : exit_dt,
            'exit_price'        : round(exit_price, 4),
            'duration_bars'     : duration,
            'max_roe_pct'       : round(max_roe, 3),
            'max_stoploss_pct'  : round(max_sl, 3),
            'net_pnl_pct'       : round(net_pnl, 3),
            'label'             : label,
            'liq_filtered'      : is_danger,
            'danger_liq_dist_pct': danger_dist,
            'danger_zone_type'  : zone_type,
        }

        if is_danger:
            skipped_trades.append(record)
        else:
            taken_trades.append(record)

    return pd.DataFrame(taken_trades), pd.DataFrame(skipped_trades)


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
def main():
    os.makedirs(ENTRY_DIR_NEW, exist_ok=True)

    sep = "=" * 90
    print(sep)
    print("  ATRBot + Liquidity Zone Filter — Backtest Verification")
    print(f"  Rule: Bỏ qua lệnh khi danger liq zone < {LIQ_FILTER_PCT}% từ entry price")
    print(sep)

    analyzed_files = sorted(glob.glob(os.path.join(DATA_ANALISIC_DIR, "*_analyzed.csv")))

    all_taken   = []
    all_skipped = []
    sym_results = []

    for f in analyzed_files:
        sym = os.path.basename(f).replace("_analyzed.csv", "")
        print(f"\n  Processing {sym}...")
        taken_df, skipped_df = evaluate_with_filter(f)

        # Save per-symbol CSV
        if len(taken_df) > 0:
            taken_df.to_csv(os.path.join(ENTRY_DIR_NEW, f"{sym}_filtered_entry.csv"), index=False)
            all_taken.append(taken_df)
        if len(skipped_df) > 0:
            skipped_df.to_csv(os.path.join(ENTRY_DIR_NEW, f"{sym}_skipped_entry.csv"), index=False)
            all_skipped.append(skipped_df)

        total_orig   = len(taken_df) + len(skipped_df)
        taken_wins   = (taken_df['label'] == 'win').sum() if len(taken_df) > 0 else 0
        taken_loses  = (taken_df['label'] == 'lose').sum() if len(taken_df) > 0 else 0
        skip_wins    = (skipped_df['label'] == 'win').sum() if len(skipped_df) > 0 else 0
        skip_loses   = (skipped_df['label'] == 'lose').sum() if len(skipped_df) > 0 else 0
        orig_wins    = taken_wins + skip_wins
        orig_loses   = taken_loses + skip_loses
        orig_wr      = orig_wins / total_orig * 100 if total_orig > 0 else 0
        taken_wr     = taken_wins / len(taken_df) * 100 if len(taken_df) > 0 else 0
        skip_wr      = skip_wins / len(skipped_df) * 100 if len(skipped_df) > 0 else 0

        print(f"    Before filter : {total_orig:>4} trades | WR: {orig_wr:.1f}%")
        print(f"    After filter  : {len(taken_df):>4} trades | WR: {taken_wr:.1f}%  (+{taken_wr-orig_wr:.1f}%)")
        print(f"    Skipped       : {len(skipped_df):>4} trades | WR: {skip_wr:.1f}%  ← mostly loses")

        sym_results.append({
            'symbol'           : sym,
            'total_signals'    : total_orig,
            'taken'            : len(taken_df),
            'skipped'          : len(skipped_df),
            'orig_wins'        : orig_wins,
            'orig_loses'       : orig_loses,
            'orig_winrate'     : round(orig_wr, 2),
            'taken_wins'       : int(taken_wins),
            'taken_loses'      : int(taken_loses),
            'taken_winrate'    : round(taken_wr, 2),
            'skipped_wins'     : int(skip_wins),
            'skipped_loses'    : int(skip_loses),
            'skipped_winrate'  : round(skip_wr, 2),
            'winrate_gain'     : round(taken_wr - orig_wr, 2),
            'orig_avg_net_pnl' : round((pd.concat([taken_df, skipped_df])['net_pnl_pct'].mean()) if total_orig > 0 else 0, 3),
            'taken_avg_net_pnl': round(taken_df['net_pnl_pct'].mean() if len(taken_df) > 0 else 0, 3),
            'orig_total_pnl'   : round((pd.concat([taken_df, skipped_df])['net_pnl_pct'].sum()) if total_orig > 0 else 0, 2),
            'taken_total_pnl'  : round(taken_df['net_pnl_pct'].sum() if len(taken_df) > 0 else 0, 2),
        })

    # ── OVERALL ──
    master_taken   = pd.concat(all_taken, ignore_index=True) if all_taken else pd.DataFrame()
    master_skipped = pd.concat(all_skipped, ignore_index=True) if all_skipped else pd.DataFrame()
    master_all     = pd.concat([master_taken, master_skipped], ignore_index=True)

    if len(master_taken) > 0:
        master_taken.to_csv(os.path.join(ENTRY_DIR_NEW, "all_taken_trades.csv"), index=False)
    if len(master_skipped) > 0:
        master_skipped.to_csv(os.path.join(ENTRY_DIR_NEW, "all_skipped_trades.csv"), index=False)

    summary_df = pd.DataFrame(sym_results)
    summary_df.to_csv(os.path.join(ENTRY_DIR_NEW, "summary_filtered.csv"), index=False)

    # ── REPORT ──
    lines = []
    lines.append(sep)
    lines.append("  BACKTEST COMPARISON REPORT — Before vs After Liquidity Zone Filter")
    lines.append(sep)
    lines.append(f"  Filter Rule : Bỏ qua lệnh khi danger liq zone cách entry < {LIQ_FILTER_PCT}%")
    lines.append(f"    BUY  signal → có BSL (phía trên) trong {LIQ_FILTER_PCT}% → SKIP")
    lines.append(f"    SELL signal → có SSL (phía dưới) trong {LIQ_FILTER_PCT}% → SKIP")
    lines.append("")

    # Table header
    col = f"  {'SYMBOL':<12}|{'SIGNALS':>8}|{'TAKEN':>7}|{'SKIP':>6}|{'WR BEF':>9}|{'WR AFT':>9}|{'GAIN':>7}|{'PNL BEF':>9}|{'PNL AFT':>9}"
    lines.append(col)
    lines.append("  " + "-" * 88)

    for r in sym_results:
        lines.append(
            f"  {r['symbol']:<12}|{r['total_signals']:>8}|{r['taken']:>7}|{r['skipped']:>6}"
            f"|{r['orig_winrate']:>8.1f}%|{r['taken_winrate']:>8.1f}%|{r['winrate_gain']:>+6.1f}%"
            f"|{r['orig_total_pnl']:>+8.1f}%|{r['taken_total_pnl']:>+8.1f}%"
        )

    lines.append("  " + "-" * 88)

    # Totals
    tot_sig    = summary_df['total_signals'].sum()
    tot_taken  = summary_df['taken'].sum()
    tot_skip   = summary_df['skipped'].sum()
    tot_orig_w = summary_df['orig_wins'].sum()
    tot_orig_l = summary_df['orig_loses'].sum()
    tot_tak_w  = summary_df['taken_wins'].sum()
    tot_tak_l  = summary_df['taken_loses'].sum()
    tot_skip_w = summary_df['skipped_wins'].sum()
    tot_skip_l = summary_df['skipped_loses'].sum()
    wr_orig    = tot_orig_w / tot_sig * 100 if tot_sig > 0 else 0
    wr_taken   = tot_tak_w / tot_taken * 100 if tot_taken > 0 else 0
    wr_skip    = tot_skip_w / tot_skip * 100 if tot_skip > 0 else 0
    pnl_orig   = master_all['net_pnl_pct'].sum() if len(master_all) > 0 else 0
    pnl_taken  = master_taken['net_pnl_pct'].sum() if len(master_taken) > 0 else 0

    lines.append(
        f"  {'OVERALL':<12}|{tot_sig:>8}|{tot_taken:>7}|{tot_skip:>6}"
        f"|{wr_orig:>8.1f}%|{wr_taken:>8.1f}%|{wr_taken-wr_orig:>+6.1f}%"
        f"|{pnl_orig:>+8.1f}%|{pnl_taken:>+8.1f}%"
    )
    lines.append("")

    lines.append(sep)
    lines.append("  DETAILED BREAKDOWN")
    lines.append(sep)
    lines.append(f"  {'':30} {'BEFORE FILTER':>20} {'AFTER FILTER':>20} {'SKIPPED':>20}")
    lines.append(f"  {'':30} {'─'*18:>20} {'─'*18:>20} {'─'*18:>20}")
    lines.append(f"  {'Total trades':<30} {tot_sig:>20} {tot_taken:>20} {tot_skip:>20}")
    lines.append(f"  {'Wins':<30} {tot_orig_w:>20} {tot_tak_w:>20} {tot_skip_w:>20}")
    lines.append(f"  {'Loses':<30} {tot_orig_l:>20} {tot_tak_l:>20} {tot_skip_l:>20}")
    lines.append(f"  {'Win Rate':<30} {wr_orig:>19.1f}% {wr_taken:>19.1f}% {wr_skip:>19.1f}%")
    lines.append(f"  {'Total Net PnL':<30} {pnl_orig:>+19.1f}% {pnl_taken:>+19.1f}%")

    if len(master_taken) > 0 and len(master_all) > 0:
        avg_roe_orig  = master_all['max_roe_pct'].mean()
        avg_roe_taken = master_taken['max_roe_pct'].mean()
        avg_sl_orig   = master_all['max_stoploss_pct'].mean()
        avg_sl_taken  = master_taken['max_stoploss_pct'].mean()
        lines.append(f"  {'Avg Max ROE':<30} {avg_roe_orig:>+19.2f}% {avg_roe_taken:>+19.2f}%")
        lines.append(f"  {'Avg Max Drawdown':<30} {avg_sl_orig:>-19.2f}% {avg_sl_taken:>-19.2f}%")

    lines.append("")
    lines.append(sep)
    lines.append("  VERDICT")
    lines.append(sep)
    gain = wr_taken - wr_orig
    kept_pct = tot_taken / tot_sig * 100

    lines.append(f"  Winrate improvement : {wr_orig:.1f}%  →  {wr_taken:.1f}%  (GAIN: {gain:+.1f}%)")
    lines.append(f"  Trades kept         : {tot_taken} / {tot_sig}  ({kept_pct:.1f}% of all signals)")
    lines.append(f"  Trades skipped      : {tot_skip} ({100-kept_pct:.1f}%)  →  WR của phần bị bỏ: {wr_skip:.1f}%")
    lines.append(f"")
    lines.append(f"  => Filter hiệu quả: bỏ {100-kept_pct:.0f}% lệnh có liq zone gần,")
    lines.append(f"     tăng WR từ {wr_orig:.1f}% lên {wr_taken:.1f}% (+{gain:.1f}%)")
    lines.append(f"     Phần bị lọc ra có WR {wr_skip:.1f}% → xác nhận đây đúng là lệnh xấu.")
    lines.append(sep)

    report_text = "\n".join(lines)

    report_file = os.path.join(ENTRY_DIR_NEW, "comparison_report.txt")
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(report_text)

    print("\n" + report_text)
    print(f"\n  Files saved to: {ENTRY_DIR_NEW}/")
    print(f"    comparison_report.txt")
    print(f"    summary_filtered.csv")
    print(f"    all_taken_trades.csv  ({len(master_taken)} rows)")
    print(f"    all_skipped_trades.csv ({len(master_skipped)} rows)")
    print(f"    <sym>_filtered_entry.csv  (10 symbols)")


if __name__ == "__main__":
    main()
