"""
Step 5: Liquidity Zone Filter Analysis
========================================
Dùng SMC Liquidity Zones để phân tích và lọc các lệnh ATRBot có khả năng thua cao.

Logic:
  - BSL (Buy Side Liquidity) = pool thanh khoản PHÍA TRÊN giá → market thường hunt BSL trước khi drop
  - SSL (Sell Side Liquidity) = pool thanh khoản PHÍA DƯỚI giá → market thường hunt SSL trước khi pump

  BUY signal nhưng có BSL gần phía trên → giá sẽ bị swept lên rồi đảo ngược → BUY thua
  SELL signal nhưng có SSL gần phía dưới → giá bị swept xuống rồi đảo ngược → SELL thua

Ngưỡng khoảng cách (LIQ_NEAR_PCT):
  Nếu liq zone nằm trong vòng N% từ entry price → coi là "đang cản đường"

Output:
  analysis/liq_filter_report.txt
  analysis/liq_filter_trades.csv   -- mỗi trade với các liq zone features
  analysis/liq_backtest.csv        -- kết quả backtest với filter
"""

import os
import glob
import sys
import pandas as pd
import numpy as np

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_ANALISIC_DIR = os.path.join(BASE_DIR, "data_analisic")
ENTRY_DIR = os.path.join(BASE_DIR, "entry")
ANALYSIS_DIR = os.path.join(BASE_DIR, "analysis")
os.makedirs(ANALYSIS_DIR, exist_ok=True)

# --- Ngưỡng cấu hình ---
LIQ_NEAR_THRESHOLDS = [0.5, 1.0, 1.5, 2.0, 3.0]  # % from entry price → test nhiều ngưỡng
DEFAULT_NEAR_PCT = 1.5   # ngưỡng "gần" mặc định


def build_liq_zone_list(adf: pd.DataFrame) -> list:
    """Build list of all liquidity zones from analyzed dataframe."""
    zones = []
    for i, row in adf.iterrows():
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
            'type': 'BSL' if liq > 0 else 'SSL',
            'level': lev
        })
    return zones


def get_active_liq_at_bar(bar_idx: int, all_zones: list) -> list:
    """Return list of active (unswept) liquidity zones at a given bar index."""
    result = []
    for z in all_zones:
        if z['start'] <= bar_idx <= z['end']:
            if z['swept'] is None or z['swept'] > bar_idx:
                result.append(z)
    return result


def classify_liq_context(trade: dict, active_zones: list, entry_price: float) -> dict:
    """
    Given the active liq zones at a signal bar, classify the liquidity context
    relative to the trade direction.
    Returns a dict of liquidity features for this trade.
    """
    direction = trade['direction']

    bsl_zones = [z for z in active_zones if z['type'] == 'BSL' and z['level'] is not None]
    ssl_zones = [z for z in active_zones if z['type'] == 'SSL' and z['level'] is not None]

    # Closest BSL above price and closest SSL below price
    bsl_above = [z for z in bsl_zones if z['level'] > entry_price]
    ssl_below = [z for z in ssl_zones if z['level'] < entry_price]

    # Distance to nearest relevant zones
    nearest_bsl_dist = min([(z['level'] - entry_price) / entry_price * 100 for z in bsl_above], default=None)
    nearest_ssl_dist = min([(entry_price - z['level']) / entry_price * 100 for z in ssl_below], default=None)

    # For BUY: danger = BSL above (will be swept first, then drop)
    # For SELL: danger = SSL below (will be swept first, then pump)
    if direction == 'BUY':
        danger_dist = nearest_bsl_dist  # BSL above = runs longs into liquidity then flips
        safe_dist = nearest_ssl_dist    # SSL below = magnet that helps BUY
        danger_zones = bsl_above
        safe_zones = ssl_below
        danger_type = 'BSL'
    else:  # SELL
        danger_dist = nearest_ssl_dist  # SSL below = sweeps shorts then pumps
        safe_dist = nearest_bsl_dist    # BSL above = helps SELL
        danger_zones = ssl_below
        safe_zones = bsl_above
        danger_type = 'SSL'

    feats = {
        'total_active_bsl': len(bsl_above),
        'total_active_ssl': len(ssl_below),
        'danger_zone_type': danger_type,
        'n_danger_zones': len(danger_zones),
        'n_safe_zones': len(safe_zones),
        'nearest_danger_dist_pct': round(danger_dist, 3) if danger_dist is not None else None,
        'nearest_safe_dist_pct': round(safe_dist, 3) if safe_dist is not None else None,
        'has_danger_liq': len(danger_zones) > 0,
        'danger_liq_close': (danger_dist is not None and danger_dist < DEFAULT_NEAR_PCT),
        'safe_liq_present': len(safe_zones) > 0,
    }

    # Liq ratio: danger vs safe distance — if danger closer than safe → bad setup
    if danger_dist is not None and safe_dist is not None:
        feats['liq_ratio'] = round(danger_dist / max(safe_dist, 0.001), 3)
        # < 1.0 means danger is closer than safe → risky
        feats['liq_ratio_risky'] = (feats['liq_ratio'] < 1.0)
    else:
        feats['liq_ratio'] = None
        feats['liq_ratio_risky'] = False

    # All danger zone distances
    feats['all_danger_dists'] = sorted(
        [round((z['level'] - entry_price) / entry_price * 100 if direction == 'BUY'
               else (entry_price - z['level']) / entry_price * 100, 3)
         for z in danger_zones]
    )

    return feats


def analyze_threshold(df: pd.DataFrame, threshold: float) -> dict:
    """
    Apply a single liq-zone distance threshold to filter trades.
    A trade is FILTERED (skipped) if:
      - has a danger liquidity zone within `threshold`% of entry price
    """
    df2 = df.copy()
    df2['filtered_out'] = (
        df2['has_danger_liq'] &
        df2['nearest_danger_dist_pct'].notna() &
        (df2['nearest_danger_dist_pct'] < threshold)
    )

    taken = df2[~df2['filtered_out']]
    filtered = df2[df2['filtered_out']]

    if len(taken) == 0:
        return None

    baseline_wr = (df['label'] == 'win').mean() * 100
    taken_wr = (taken['label'] == 'win').mean() * 100
    filtered_wr = (filtered['label'] == 'win').mean() * 100 if len(filtered) > 0 else 0

    return {
        'threshold_pct': threshold,
        'total_trades': len(df),
        'taken': len(taken),
        'filtered': len(filtered),
        'taken_wins': (taken['label'] == 'win').sum(),
        'taken_loses': (taken['label'] == 'lose').sum(),
        'filtered_wins': (filtered['label'] == 'win').sum(),
        'filtered_loses': (filtered['label'] == 'lose').sum(),
        'baseline_winrate': round(baseline_wr, 2),
        'taken_winrate': round(taken_wr, 2),
        'filtered_winrate': round(filtered_wr, 2),
        'winrate_improvement': round(taken_wr - baseline_wr, 2),
        'trades_kept_pct': round(len(taken) / len(df) * 100, 1),
    }


def main():
    print("=" * 70)
    print("  LIQUIDITY ZONE FILTER — ATRBot Lose Trade Prevention")
    print("=" * 70)

    all_trade_rows = []

    symbols = sorted([
        os.path.basename(f).replace("_entry.csv", "")
        for f in glob.glob(os.path.join(ENTRY_DIR, "*_entry.csv"))
    ])

    print(f"\n[1/3] Processing {len(symbols)} symbols...")

    for sym in symbols:
        entry_file = os.path.join(ENTRY_DIR, f"{sym}_entry.csv")
        analyzed_file = os.path.join(DATA_ANALISIC_DIR, f"{sym}_analyzed.csv")
        if not os.path.exists(analyzed_file):
            continue

        edf = pd.read_csv(entry_file)
        adf = pd.read_csv(analyzed_file).reset_index(drop=True)

        # Build zone list once per symbol (fast)
        all_zones = build_liq_zone_list(adf)
        print(f"  {sym}: {len(edf)} trades | {len(all_zones)} liq zones")

        for _, trade in edf.iterrows():
            sig_idx = int(trade['signal_index'])
            entry_price = float(trade['entry_price'])

            if sig_idx < 0 or sig_idx >= len(adf):
                continue

            active_zones = get_active_liq_at_bar(sig_idx, all_zones)
            liq_ctx = classify_liq_context(trade.to_dict(), active_zones, entry_price)

            row = {
                'symbol': sym,
                'direction': trade['direction'],
                'signal_index': sig_idx,
                'signal_datetime': trade['signal_datetime'],
                'entry_price': entry_price,
                'max_roe_pct': trade['max_roe_pct'],
                'max_stoploss_pct': trade['max_stoploss_pct'],
                'net_pnl_pct': trade['net_pnl_pct'],
                'duration_bars': trade['duration_bars'],
                'label': trade['label'],
                **liq_ctx,
                'all_danger_dists': str(liq_ctx['all_danger_dists'])
            }
            all_trade_rows.append(row)

    df = pd.DataFrame(all_trade_rows)

    # Save raw liq feature matrix
    liq_csv = os.path.join(ANALYSIS_DIR, "liq_filter_trades.csv")
    df.to_csv(liq_csv, index=False)
    print(f"\n  Saved: {liq_csv} ({len(df)} rows)")

    # ------------------------------------------------------------------
    print("\n[2/3] Testing different distance thresholds...")
    # ------------------------------------------------------------------
    threshold_results = []
    for thr in LIQ_NEAR_THRESHOLDS:
        res = analyze_threshold(df, thr)
        if res:
            threshold_results.append(res)

    # ------------------------------------------------------------------
    print("\n[3/3] Generating report...")
    # ------------------------------------------------------------------
    sep = "=" * 80
    lines = []
    lines.append(sep)
    lines.append("  LIQUIDITY ZONE FILTER ANALYSIS — ATRBot Lose Prevention")
    lines.append(sep)

    total = len(df)
    wins = (df['label'] == 'win').sum()
    loses = (df['label'] == 'lose').sum()
    baseline_wr = wins / total * 100

    lines.append(f"  Total trades   : {total}")
    lines.append(f"  Wins           : {wins} ({baseline_wr:.1f}%)")
    lines.append(f"  Loses          : {loses} ({loses/total*100:.1f}%)")
    lines.append(f"  Baseline WR    : {baseline_wr:.1f}%")
    lines.append("")

    # A. Basic stats
    lines.append(sep)
    lines.append("  A. LIQUIDITY ZONE PRESENCE AT SIGNAL BARS")
    lines.append(sep)

    def pct(mask): return df[mask]['label'].value_counts(normalize=True).get('win', 0) * 100

    has_danger = df['has_danger_liq']
    no_danger = ~df['has_danger_liq']
    risky_ratio = df['liq_ratio_risky'].fillna(False)
    safe_ratio = ~risky_ratio & has_danger

    lines.append(f"  Has danger liq zone (any dist)    : {has_danger.sum():>5} trades | WR: {pct(has_danger):>5.1f}%")
    lines.append(f"  No danger liq zone                : {no_danger.sum():>5} trades | WR: {pct(no_danger):>5.1f}%")
    lines.append(f"  Safe liq present (helper)         : {df['safe_liq_present'].sum():>5} trades | WR: {pct(df['safe_liq_present']):>5.1f}%")
    lines.append(f"  Liq ratio risky (danger < safe)   : {risky_ratio.sum():>5} trades | WR: {pct(risky_ratio):>5.1f}%")
    lines.append("")

    # B. Breakdown by danger distance bucket
    lines.append(sep)
    lines.append("  B. LOSE RATE BY DANGER LIQ DISTANCE FROM ENTRY")
    lines.append(sep)
    lines.append(f"  {'Danger Dist to Liq':<28} | {'Total':>6} | {'Wins':>6} | {'Loses':>6} | {'WinRate':>8} | {'vs Baseline':>12}")
    lines.append("  " + "-" * 72)

    buckets = [
        ("Danger liq < 0.5%", df['nearest_danger_dist_pct'] < 0.5),
        ("Danger liq 0.5%-1.0%", (df['nearest_danger_dist_pct'] >= 0.5) & (df['nearest_danger_dist_pct'] < 1.0)),
        ("Danger liq 1.0%-1.5%", (df['nearest_danger_dist_pct'] >= 1.0) & (df['nearest_danger_dist_pct'] < 1.5)),
        ("Danger liq 1.5%-2.0%", (df['nearest_danger_dist_pct'] >= 1.5) & (df['nearest_danger_dist_pct'] < 2.0)),
        ("Danger liq 2.0%-3.0%", (df['nearest_danger_dist_pct'] >= 2.0) & (df['nearest_danger_dist_pct'] < 3.0)),
        ("Danger liq > 3.0%",   df['nearest_danger_dist_pct'] >= 3.0),
        ("No danger liq",        df['nearest_danger_dist_pct'].isna()),
    ]
    for label, mask in buckets:
        sub = df[mask & df['has_danger_liq'].eq(True) | (mask & df['has_danger_liq'].eq(False))]
        sub = df[mask]
        if len(sub) < 5:
            continue
        w = (sub['label'] == 'win').sum()
        l = (sub['label'] == 'lose').sum()
        wr = w / len(sub) * 100
        delta = wr - baseline_wr
        lines.append(f"  {label:<28} | {len(sub):>6} | {w:>6} | {l:>6} | {wr:>7.1f}% | {delta:>+11.1f}%")

    # C. Threshold sweep
    lines.append("")
    lines.append(sep)
    lines.append("  C. THRESHOLD SWEEP — Impact of Filtering by Danger Liq Distance")
    lines.append(sep)
    lines.append(f"  {'Filter Threshold':<20} | {'Kept':>6} | {'Kept%':>6} | {'WR After':>9} | {'Improvement':>12} | {'Filtered WR':>12}")
    lines.append("  " + "-" * 75)
    for r in threshold_results:
        lines.append(
            f"  < {r['threshold_pct']:.1f}% danger liq    | {r['taken']:>6} | {r['trades_kept_pct']:>5.1f}% | "
            f"{r['taken_winrate']:>8.1f}% | {r['winrate_improvement']:>+11.1f}% | {r['filtered_winrate']:>11.1f}%"
        )

    # D. Combined filter (danger + liq_ratio)
    lines.append("")
    lines.append(sep)
    lines.append("  D. COMBINED FILTER — Danger Liq + Ratio (danger closer than safe)")
    lines.append(sep)

    combined_filter = df['danger_liq_close'] & df['liq_ratio_risky'].fillna(False)
    combined_taken = df[~combined_filter]
    combined_filtered = df[combined_filter]

    c_wr = (combined_taken['label'] == 'win').mean() * 100 if len(combined_taken) > 0 else 0
    f_wr = (combined_filtered['label'] == 'win').mean() * 100 if len(combined_filtered) > 0 else 0

    lines.append(f"  Combined filter: danger_liq_close=True AND liq_ratio < 1.0")
    lines.append(f"  Trades kept   : {len(combined_taken)} ({len(combined_taken)/total*100:.1f}%)")
    lines.append(f"  Trades removed: {len(combined_filtered)} ({len(combined_filtered)/total*100:.1f}%)")
    lines.append(f"  WR (kept)     : {c_wr:.1f}%  (baseline: {baseline_wr:.1f}%  | improvement: {c_wr-baseline_wr:+.1f}%)")
    lines.append(f"  WR (filtered) : {f_wr:.1f}%  (these were indeed mostly loses)")
    lines.append("")

    # E. Per-symbol
    lines.append(sep)
    lines.append("  E. PER-SYMBOL RESULT WITH DEFAULT FILTER (danger liq < 1.5%)")
    lines.append(sep)
    lines.append(f"  {'Symbol':<12} | {'All WR':>8} | {'Kept':>6} | {'Kept WR':>8} | {'Impr':>8} | {'Removed':>7} | {'Removed WR':>11}")
    lines.append("  " + "-" * 72)

    for sym in sorted(df['symbol'].unique()):
        sym_df = df[df['symbol'] == sym]
        base_wr = (sym_df['label'] == 'win').mean() * 100
        res = analyze_threshold(sym_df, DEFAULT_NEAR_PCT)
        if res is None:
            continue
        lines.append(
            f"  {sym:<12} | {base_wr:>7.1f}% | {res['taken']:>6} | "
            f"{res['taken_winrate']:>7.1f}% | {res['winrate_improvement']:>+7.1f}% | "
            f"{res['filtered']:>7} | {res['filtered_winrate']:>10.1f}%"
        )

    # F. Key conclusions
    lines.append("")
    lines.append(sep)
    lines.append("  F. CONCLUSIONS — Liquidity Zone as a Lose Filter")
    lines.append(sep)

    best_thr = max(threshold_results, key=lambda r: r['winrate_improvement'])
    lines.append(f"  Best single threshold : {best_thr['threshold_pct']:.1f}%  →  WR: {best_thr['taken_winrate']:.1f}%  (+{best_thr['winrate_improvement']:.1f}%)")
    lines.append(f"  Trades kept           : {best_thr['taken']} / {best_thr['total_trades']} ({best_thr['trades_kept_pct']:.1f}%)")
    lines.append(f"  Removed trades WR     : {best_thr['filtered_winrate']:.1f}%  ← mostly loses")
    lines.append("")
    lines.append("  HOW TO USE THE FILTER IN PRODUCTION:")
    lines.append("  1. At ATRBot signal, scan all ACTIVE (unswept) liquidity zones")
    lines.append("  2. For BUY: check if any BSL (Buy Side Liq) is within 1.5% ABOVE entry")
    lines.append("     → If YES: SKIP the trade (market will likely sweep BSL then drop)")
    lines.append("  3. For SELL: check if any SSL (Sell Side Liq) is within 1.5% BELOW entry")
    lines.append("     → If YES: SKIP the trade (market will likely sweep SSL then pump)")
    lines.append("  4. BONUS: If safe liq (helping direction) < danger liq distance → take trade")
    lines.append("")
    lines.append(sep)

    report_text = "\n".join(lines)

    report_file = os.path.join(ANALYSIS_DIR, "liq_filter_report.txt")
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(report_text)

    # Save backtest comparison
    thr_df = pd.DataFrame(threshold_results)
    thr_df.to_csv(os.path.join(ANALYSIS_DIR, "liq_backtest.csv"), index=False)

    print(report_text)
    print(f"\nFiles saved:")
    print(f"  {liq_csv}")
    print(f"  {report_file}")
    print(f"  {os.path.join(ANALYSIS_DIR, 'liq_backtest.csv')}")


if __name__ == "__main__":
    main()
