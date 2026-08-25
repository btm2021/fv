"""
Step 4: Lose Pattern Discovery
Joins entry data with SMC + ATRBot + VSR indicator context around each signal bar
Then uses statistical analysis + feature engineering to find patterns
that distinguish LOSING trades from WINNING trades.

Features extracted at signal bar and surrounding window:
- ATRBot: atr_value, trend_age, trail_gap_pct
- VSR: vsr_active, vsr_spike_recent, proximity_to_vsr_zone
- SMC: near_ob, ob_aligned_with_direction, near_fvg, fvg_aligned
       near_swing_high, near_swing_low, bos_choch_recent
       liquidity_nearby, liquidity_swept_recently
- Price structure: atr_ratio, candle_body_pct, volume_ratio, price_vs_trail

Output:
  analysis/lose_pattern_report.txt  -- Human readable pattern report
  analysis/feature_matrix.csv       -- Feature matrix for all trades (win + lose)
  analysis/lose_patterns.csv        -- Top lose patterns ranked by prevalence
"""

import os
import sys
import glob
import json
import warnings
import numpy as np
import pandas as pd
from collections import Counter, defaultdict
from itertools import combinations

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

warnings.filterwarnings('ignore')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_ANALISIC_DIR = os.path.join(BASE_DIR, "data_analisic")
ENTRY_DIR = os.path.join(BASE_DIR, "entry")
ANALYSIS_DIR = os.path.join(BASE_DIR, "analysis")

CONTEXT_BARS_BEFORE = 20   # Look-back window before signal
CONTEXT_BARS_AFTER = 5     # Look-ahead after signal (just for price action features)


def load_all_data():
    """Load all entry CSV and analyzed CSV files"""
    all_entries = []
    sym_data = {}

    for entry_file in sorted(glob.glob(os.path.join(ENTRY_DIR, "*_entry.csv"))):
        sym = os.path.basename(entry_file).replace("_entry.csv", "")
        analyzed_file = os.path.join(DATA_ANALISIC_DIR, f"{sym}_analyzed.csv")
        if not os.path.exists(analyzed_file):
            print(f"  [WARNING] Missing analyzed file for {sym}, skipping.")
            continue

        edf = pd.read_csv(entry_file)
        adf = pd.read_csv(analyzed_file)
        # Reset index so we can use integer positional index
        adf = adf.reset_index(drop=True)

        all_entries.append((sym, edf, adf))
        sym_data[sym] = adf
        print(f"  Loaded {len(edf)} trades for {sym} (analyzed: {len(adf)} bars)")

    return all_entries, sym_data


def extract_features_for_trade(trade: dict, adf: pd.DataFrame) -> dict:
    """
    Extract indicator context features for a single trade at the signal bar.
    """
    sig_idx = int(trade['signal_index'])
    direction = trade['direction']  # 'BUY' or 'SELL'
    entry_price = float(trade['entry_price'])

    n = len(adf)
    if sig_idx < 0 or sig_idx >= n:
        return None

    bar = adf.iloc[sig_idx]
    prev_start = max(0, sig_idx - CONTEXT_BARS_BEFORE)
    ctx = adf.iloc[prev_start:sig_idx + 1]

    feats = {
        'symbol': trade['symbol'],
        'direction': direction,
        'signal_index': sig_idx,
        'signal_datetime': trade.get('signal_datetime', ''),
        'entry_price': entry_price,
        'max_roe_pct': trade['max_roe_pct'],
        'max_stoploss_pct': trade['max_stoploss_pct'],
        'net_pnl_pct': trade['net_pnl_pct'],
        'duration_bars': trade['duration_bars'],
        'label': trade['label']
    }

    close = float(bar['close'])
    atr = float(bar['atrbot_atr']) if pd.notna(bar['atrbot_atr']) else np.nan
    trail1 = float(bar['atrbot_trail1']) if pd.notna(bar['atrbot_trail1']) else np.nan
    trail2 = float(bar['atrbot_trail2']) if pd.notna(bar['atrbot_trail2']) else np.nan
    trend = int(bar['atrbot_trend']) if pd.notna(bar['atrbot_trend']) else 0

    # ---- ATRBot Features ----
    if close > 0 and not np.isnan(atr):
        feats['atr_pct_of_price'] = round(atr / close * 100, 3)
    else:
        feats['atr_pct_of_price'] = np.nan

    if not np.isnan(trail1) and not np.isnan(trail2) and close > 0:
        feats['trail_gap_pct'] = round(abs(trail1 - trail2) / close * 100, 3)
    else:
        feats['trail_gap_pct'] = np.nan

    if not np.isnan(trail2) and close > 0:
        feats['price_vs_trail2_pct'] = round((close - trail2) / close * 100, 3)
    else:
        feats['price_vs_trail2_pct'] = np.nan

    # Trend age: how many consecutive bars in current trend direction
    trend_age = 0
    for i in range(sig_idx - 1, max(0, sig_idx - 100) - 1, -1):
        t = int(adf.iloc[i]['atrbot_trend']) if pd.notna(adf.iloc[i]['atrbot_trend']) else 0
        if t == trend:
            trend_age += 1
        else:
            break
    feats['trend_age_bars'] = trend_age
    feats['trend_age_bucket'] = (
        'fresh' if trend_age <= 5 else
        'mid' if trend_age <= 20 else
        'old' if trend_age <= 60 else
        'very_old'
    )

    # ---- Price Action Features ----
    open_p = float(bar['open'])
    high_p = float(bar['high'])
    low_p = float(bar['low'])
    body = abs(close - open_p)
    candle_range = high_p - low_p
    feats['candle_body_pct'] = round(body / candle_range * 100, 1) if candle_range > 0 else 0.0
    feats['is_bullish_candle'] = (close > open_p)

    # Volume compared to last 20-bar average
    vol = float(bar['volume'])
    vol_window = ctx['volume'].astype(float)
    avg_vol = vol_window.mean() if len(vol_window) > 0 else vol
    feats['volume_ratio'] = round(vol / avg_vol, 2) if avg_vol > 0 else 1.0
    feats['high_volume'] = (feats['volume_ratio'] > 1.5)

    # ---- SMC Features ----
    # FVG at signal bar
    fvg = bar['smc_fvg'] if pd.notna(bar['smc_fvg']) else 0
    feats['fvg_at_signal'] = (fvg != 0)
    feats['fvg_direction'] = (
        'bullish' if fvg > 0 else ('bearish' if fvg < 0 else 'none')
    )
    feats['fvg_aligned'] = (
        (direction == 'BUY' and fvg > 0) or (direction == 'SELL' and fvg < 0)
    )
    feats['fvg_counter'] = (
        (direction == 'BUY' and fvg < 0) or (direction == 'SELL' and fvg > 0)
    )

    # FVG within last CONTEXT window
    ctx_fvg = ctx['smc_fvg'].fillna(0)
    recent_bull_fvg = (ctx_fvg > 0).sum()
    recent_bear_fvg = (ctx_fvg < 0).sum()
    feats['recent_bullish_fvg_count'] = int(recent_bull_fvg)
    feats['recent_bearish_fvg_count'] = int(recent_bear_fvg)

    # FVG dominance in window
    if direction == 'BUY':
        feats['fvg_aligned_window'] = (recent_bull_fvg > recent_bear_fvg)
        feats['fvg_counter_window'] = (recent_bear_fvg > recent_bull_fvg)
    else:
        feats['fvg_aligned_window'] = (recent_bear_fvg > recent_bull_fvg)
        feats['fvg_counter_window'] = (recent_bull_fvg > recent_bear_fvg)

    # Order Block
    ob = bar['smc_ob'] if pd.notna(bar['smc_ob']) else 0
    ob_top = float(bar['smc_ob_top']) if pd.notna(bar['smc_ob_top']) else np.nan
    ob_bottom = float(bar['smc_ob_bottom']) if pd.notna(bar['smc_ob_bottom']) else np.nan
    feats['ob_at_signal'] = (ob != 0)
    feats['ob_bullish'] = (ob > 0)
    feats['ob_bearish'] = (ob < 0)
    feats['ob_aligned'] = (
        (direction == 'BUY' and ob > 0) or (direction == 'SELL' and ob < 0)
    )
    feats['ob_counter'] = (
        (direction == 'BUY' and ob < 0) or (direction == 'SELL' and ob > 0)
    )

    # Price inside OB zone
    if not np.isnan(ob_top) and not np.isnan(ob_bottom):
        feats['price_inside_ob'] = (ob_bottom <= close <= ob_top)
    else:
        feats['price_inside_ob'] = False

    # BOS/CHoCH in recent window
    ctx_bos = ctx['smc_bos'].fillna(0)
    ctx_choch = ctx['smc_choch'].fillna(0)
    feats['recent_bull_bos'] = int((ctx_bos > 0).sum())
    feats['recent_bear_bos'] = int((ctx_bos < 0).sum())
    feats['recent_bull_choch'] = int((ctx_choch > 0).sum())
    feats['recent_bear_choch'] = int((ctx_choch < 0).sum())

    feats['bos_confirmed_direction'] = (
        (direction == 'BUY' and feats['recent_bull_bos'] > 0) or
        (direction == 'SELL' and feats['recent_bear_bos'] > 0)
    )
    feats['choch_confirmed_direction'] = (
        (direction == 'BUY' and feats['recent_bull_choch'] > 0) or
        (direction == 'SELL' and feats['recent_bear_choch'] > 0)
    )
    feats['bos_choch_any'] = (
        feats['recent_bull_bos'] + feats['recent_bear_bos'] +
        feats['recent_bull_choch'] + feats['recent_bear_choch']
    ) > 0

    # Swing H/L
    ctx_swing = ctx['smc_swing_hl'].fillna(0)
    feats['recent_swing_high'] = int((ctx_swing > 0).sum())
    feats['recent_swing_low'] = int((ctx_swing < 0).sum())
    feats['swing_aligned'] = (
        (direction == 'BUY' and feats['recent_swing_high'] == 0 and feats['recent_swing_low'] > 0) or
        (direction == 'SELL' and feats['recent_swing_low'] == 0 and feats['recent_swing_high'] > 0)
    )

    # Liquidity
    liq = bar['smc_liquidity'] if pd.notna(bar['smc_liquidity']) else 0
    ctx_liq = ctx['smc_liquidity'].fillna(0)
    feats['liq_at_signal'] = (liq != 0)
    feats['recent_bsl'] = int((ctx_liq > 0).sum())
    feats['recent_ssl'] = int((ctx_liq < 0).sum())

    # Is there unswept liquidity above (BUY) or below (SELL) entry?
    if 'smc_liq_level' in ctx.columns and 'smc_liq_swept_index' in ctx.columns:
        liq_rows = ctx[(ctx['smc_liquidity'].fillna(0) != 0)]
        unswept_against = 0
        for _, lr in liq_rows.iterrows():
            liq_type = lr['smc_liquidity']
            liq_lvl = float(lr['smc_liq_level']) if pd.notna(lr['smc_liq_level']) else np.nan
            swept = lr['smc_liq_swept_index']
            if pd.isna(swept) or swept == 0:  # unswept
                if direction == 'BUY' and liq_type > 0 and not np.isnan(liq_lvl) and liq_lvl > close:
                    unswept_against += 1
                elif direction == 'SELL' and liq_type < 0 and not np.isnan(liq_lvl) and liq_lvl < close:
                    unswept_against += 1
        feats['unswept_liq_against_trade'] = unswept_against
        feats['has_liq_trap'] = (unswept_against > 0)
    else:
        feats['unswept_liq_against_trade'] = 0
        feats['has_liq_trap'] = False

    # ---- VSR Features ----
    vsr_spike = bool(bar['vsr_spike']) if pd.notna(bar['vsr_spike']) else False
    vsr_signal_val = float(bar['vsr_signal']) if pd.notna(bar['vsr_signal']) else 0.0
    feats['vsr_spike_at_signal'] = vsr_spike
    feats['vsr_signal_strength'] = round(vsr_signal_val, 2)

    ctx_vsr = ctx['vsr_spike'].fillna(False).astype(bool)
    feats['recent_vsr_spikes'] = int(ctx_vsr.sum())
    feats['vsr_active_zone'] = (
        pd.notna(bar['vsr_upper']) and pd.notna(bar['vsr_lower'])
    )

    # Price inside current VSR zone
    if feats['vsr_active_zone']:
        vsr_upper = float(bar['vsr_upper'])
        vsr_lower = float(bar['vsr_lower'])
        feats['price_inside_vsr'] = (vsr_lower <= close <= vsr_upper)
        feats['vsr_zone_width_pct'] = round((vsr_upper - vsr_lower) / close * 100, 3)
    else:
        feats['price_inside_vsr'] = False
        feats['vsr_zone_width_pct'] = 0.0

    # ---- ATRBot Danger Conditions ----
    feats['atr_expansion'] = (feats['atr_pct_of_price'] > 0.5 if not np.isnan(feats['atr_pct_of_price']) else False)
    feats['tight_trail_gap'] = (feats['trail_gap_pct'] < 0.3 if not np.isnan(feats['trail_gap_pct']) else False)
    feats['wide_trail_gap'] = (feats['trail_gap_pct'] > 1.5 if not np.isnan(feats['trail_gap_pct']) else False)

    return feats


def build_feature_matrix(all_entries):
    """Build the full feature matrix for all trades across all symbols"""
    all_feats = []
    total_trades = 0

    for sym, edf, adf in all_entries:
        print(f"  Building features for {sym} ({len(edf)} trades)...")
        for _, row in edf.iterrows():
            f = extract_features_for_trade(row.to_dict(), adf)
            if f:
                all_feats.append(f)
                total_trades += 1

    print(f"\n  Total feature rows: {total_trades}")
    return pd.DataFrame(all_feats)


def analyze_patterns(df: pd.DataFrame) -> str:
    """
    Statistical analysis to find patterns in LOSE trades vs WIN trades
    """
    wins = df[df['label'] == 'win']
    loses = df[df['label'] == 'lose']

    report_lines = []
    sep = "=" * 80

    report_lines.append(sep)
    report_lines.append("  ATRBot LOSING TRADE PATTERN ANALYSIS — SMC + VSR + ATR Features")
    report_lines.append(sep)
    report_lines.append(f"  Total Trades : {len(df)}")
    report_lines.append(f"  Wins         : {len(wins)} ({len(wins)/len(df)*100:.1f}%)")
    report_lines.append(f"  Loses        : {len(loses)} ({len(loses)/len(df)*100:.1f}%)")
    report_lines.append("")

    # ------------------------------------------------------------------
    # A. Continuous feature comparison (mean win vs mean lose)
    # ------------------------------------------------------------------
    continuous_feats = [
        'atr_pct_of_price', 'trail_gap_pct', 'price_vs_trail2_pct',
        'trend_age_bars', 'candle_body_pct', 'volume_ratio',
        'vsr_signal_strength', 'vsr_zone_width_pct',
        'recent_bull_bos', 'recent_bear_bos',
        'recent_bull_choch', 'recent_bear_choch',
        'recent_bullish_fvg_count', 'recent_bearish_fvg_count',
        'recent_swing_high', 'recent_swing_low',
        'recent_vsr_spikes', 'unswept_liq_against_trade',
        'duration_bars', 'max_stoploss_pct'
    ]

    report_lines.append(sep)
    report_lines.append("  A. CONTINUOUS INDICATOR VALUES — Win vs Lose Averages")
    report_lines.append(sep)
    report_lines.append(f"  {'Feature':<35} | {'WIN avg':>10} | {'LOSE avg':>10} | {'LOSE > WIN':>12} | {'Impact Score':>12}")
    report_lines.append("  " + "-" * 78)

    ranked = []
    for feat in continuous_feats:
        if feat not in df.columns:
            continue
        w_mean = wins[feat].dropna().mean()
        l_mean = loses[feat].dropna().mean()
        w_std = wins[feat].dropna().std()
        # Impact score: normalized difference
        if w_std > 0:
            impact = abs(l_mean - w_mean) / w_std
        else:
            impact = 0.0
        direction_mark = "HIGHER" if l_mean > w_mean else "LOWER"
        ranked.append((feat, w_mean, l_mean, direction_mark, impact))

    ranked.sort(key=lambda x: x[4], reverse=True)
    for feat, w_mean, l_mean, d_mark, imp in ranked:
        report_lines.append(
            f"  {feat:<35} | {w_mean:>10.3f} | {l_mean:>10.3f} | {d_mark:>12} | {imp:>12.3f}"
        )

    # ------------------------------------------------------------------
    # B. Boolean feature prevalence comparison
    # ------------------------------------------------------------------
    bool_feats = [
        'fvg_at_signal', 'fvg_aligned', 'fvg_counter', 'fvg_counter_window',
        'ob_at_signal', 'ob_aligned', 'ob_counter', 'price_inside_ob',
        'bos_confirmed_direction', 'choch_confirmed_direction', 'bos_choch_any',
        'swing_aligned',
        'liq_at_signal', 'has_liq_trap',
        'vsr_spike_at_signal', 'vsr_active_zone', 'price_inside_vsr',
        'atr_expansion', 'tight_trail_gap', 'wide_trail_gap',
        'high_volume', 'is_bullish_candle',
    ]

    report_lines.append("")
    report_lines.append(sep)
    report_lines.append("  B. BOOLEAN INDICATOR PATTERNS — Prevalence in Loses vs Wins")
    report_lines.append(sep)
    report_lines.append(
        f"  {'Feature':<35} | {'WIN %':>8} | {'LOSE %':>8} | {'Delta':>8} | {'Significance':>14}"
    )
    report_lines.append("  " + "-" * 78)

    bool_ranked = []
    for feat in bool_feats:
        if feat not in df.columns:
            continue
        w_pct = wins[feat].astype(bool).mean() * 100
        l_pct = loses[feat].astype(bool).mean() * 100
        delta = l_pct - w_pct
        sig = "MUCH MORE in LOSE" if delta > 15 else ("MORE in LOSE" if delta > 5 else ("LESS in LOSE" if delta < -5 else "similar"))
        bool_ranked.append((feat, w_pct, l_pct, delta, sig))

    bool_ranked.sort(key=lambda x: abs(x[3]), reverse=True)
    for feat, w_pct, l_pct, delta, sig in bool_ranked:
        report_lines.append(
            f"  {feat:<35} | {w_pct:>7.1f}% | {l_pct:>7.1f}% | {delta:>+7.1f}% | {sig:>14}"
        )

    # ------------------------------------------------------------------
    # C. Trend Age Bucket breakdown
    # ------------------------------------------------------------------
    report_lines.append("")
    report_lines.append(sep)
    report_lines.append("  C. TREND AGE AT SIGNAL — Win/Lose Rate by Trend Duration")
    report_lines.append(sep)
    report_lines.append(f"  {'Trend Age Bucket':<20} | {'Total':>6} | {'Wins':>6} | {'Loses':>6} | {'Winrate':>8}")
    report_lines.append("  " + "-" * 58)
    for bucket in ['fresh', 'mid', 'old', 'very_old']:
        sub = df[df['trend_age_bucket'] == bucket]
        if len(sub) == 0:
            continue
        wr = (sub['label'] == 'win').sum()
        lr = (sub['label'] == 'lose').sum()
        wrate = wr / len(sub) * 100
        report_lines.append(
            f"  {bucket:<20} | {len(sub):>6} | {wr:>6} | {lr:>6} | {wrate:>7.1f}%"
        )

    # ------------------------------------------------------------------
    # D. Direction breakdown
    # ------------------------------------------------------------------
    report_lines.append("")
    report_lines.append(sep)
    report_lines.append("  D. DIRECTION BREAKDOWN — BUY vs SELL Win/Lose Rates")
    report_lines.append(sep)
    report_lines.append(f"  {'Direction':<12} | {'Total':>6} | {'Wins':>6} | {'Loses':>6} | {'Winrate':>8}")
    report_lines.append("  " + "-" * 50)
    for d in ['BUY', 'SELL']:
        sub = df[df['direction'] == d]
        wr = (sub['label'] == 'win').sum()
        lr = (sub['label'] == 'lose').sum()
        wrate = wr / len(sub) * 100 if len(sub) > 0 else 0.0
        report_lines.append(f"  {d:<12} | {len(sub):>6} | {wr:>6} | {lr:>6} | {wrate:>7.1f}%")

    # ------------------------------------------------------------------
    # E. Combination pattern analysis (top lose combos)
    # ------------------------------------------------------------------
    report_lines.append("")
    report_lines.append(sep)
    report_lines.append("  E. TOP COMBINATION PATTERNS — Conditions Strongly Associated With LOSES")
    report_lines.append(sep)

    # Booleanize key features
    df2 = df.copy()
    df2['trend_old'] = df2['trend_age_bars'] > 20
    df2['high_atr'] = df2['atr_pct_of_price'] > 0.4
    df2['very_high_atr'] = df2['atr_pct_of_price'] > 0.8
    df2['no_bos_choch'] = ~df2['bos_choch_any']
    df2['counter_fvg_present'] = df2['fvg_counter_window']

    key_flags = [
        'fvg_counter', 'fvg_counter_window', 'ob_counter',
        'price_inside_ob', 'bos_choch_any', 'no_bos_choch',
        'has_liq_trap', 'vsr_active_zone', 'price_inside_vsr',
        'vsr_spike_at_signal', 'atr_expansion', 'trend_old',
        'high_atr', 'wide_trail_gap', 'tight_trail_gap',
        'high_volume'
    ]
    key_flags = [f for f in key_flags if f in df2.columns]

    combo_results = []
    # Single conditions
    for flag in key_flags:
        subset = df2[df2[flag] == True]
        if len(subset) < 20:
            continue
        lr = (subset['label'] == 'lose').mean() * 100
        base_lr = (df2['label'] == 'lose').mean() * 100
        lift = lr - base_lr
        combo_results.append((flag, len(subset), lr, lift))

    # Two-condition combos
    for f1, f2 in combinations(key_flags, 2):
        subset = df2[(df2[f1] == True) & (df2[f2] == True)]
        if len(subset) < 10:
            continue
        lr = (subset['label'] == 'lose').mean() * 100
        base_lr = (df2['label'] == 'lose').mean() * 100
        lift = lr - base_lr
        combo_results.append((f"{f1} + {f2}", len(subset), lr, lift))

    combo_results.sort(key=lambda x: x[3], reverse=True)
    report_lines.append(f"  {'Pattern / Condition':<48} | {'Count':>6} | {'Lose%':>7} | {'Lift vs Baseline':>16}")
    report_lines.append("  " + "-" * 82)
    base_lose_rate = (df['label'] == 'lose').mean() * 100
    report_lines.append(f"  BASELINE (all trades): {base_lose_rate:.1f}% lose rate")
    report_lines.append("")

    for pattern, count, lr, lift in combo_results[:30]:
        report_lines.append(
            f"  {pattern:<48} | {count:>6} | {lr:>6.1f}% | {lift:>+15.1f}%"
        )

    # ------------------------------------------------------------------
    # F. Per-symbol lose pattern
    # ------------------------------------------------------------------
    report_lines.append("")
    report_lines.append(sep)
    report_lines.append("  F. PER-SYMBOL LOSE RATE BREAKDOWN")
    report_lines.append(sep)
    report_lines.append(f"  {'Symbol':<12} | {'Total':>6} | {'Loses':>6} | {'Lose%':>7} | {'Avg Max SL%':>12} | {'Most Common Lose Pattern':<30}")
    report_lines.append("  " + "-" * 80)
    for sym in df['symbol'].unique():
        sub = df[df['symbol'] == sym]
        n_lose = (sub['label'] == 'lose').sum()
        lose_pct = n_lose / len(sub) * 100
        lose_sub = sub[sub['label'] == 'lose']
        avg_sl = lose_sub['max_stoploss_pct'].mean() if len(lose_sub) > 0 else 0.0

        # Most common flag in lose trades
        top_flag = "n/a"
        top_flag_rate = 0.0
        for flag in key_flags:
            if flag in lose_sub.columns:
                rate = lose_sub[flag].astype(bool).mean() * 100
                if rate > top_flag_rate:
                    top_flag_rate = rate
                    top_flag = f"{flag} ({rate:.0f}%)"

        report_lines.append(
            f"  {sym:<12} | {len(sub):>6} | {n_lose:>6} | {lose_pct:>6.1f}% | {avg_sl:>11.2f}% | {top_flag:<30}"
        )

    # ------------------------------------------------------------------
    # G. Key findings summary
    # ------------------------------------------------------------------
    report_lines.append("")
    report_lines.append(sep)
    report_lines.append("  G. KEY FINDINGS — Top Risk Factors for LOSING Trades (Ranked by Impact)")
    report_lines.append(sep)

    findings = []

    # Top 5 bool patterns
    for feat, w_pct, l_pct, delta, sig in bool_ranked[:10]:
        if delta > 5:
            findings.append((abs(delta), f"[SMC/ATR/VSR] '{feat}': loses have {l_pct:.0f}% vs wins {w_pct:.0f}% (DELTA +{delta:.1f}%)"))

    # Top continuous
    for feat, w_mean, l_mean, d_mark, imp in ranked[:10]:
        if imp > 0.2:
            findings.append((imp * 10, f"[Numeric] '{feat}': lose avg={l_mean:.3f} vs win avg={w_mean:.3f} ({d_mark} in loses)"))

    findings.sort(key=lambda x: x[0], reverse=True)
    for i, (score, msg) in enumerate(findings[:15], 1):
        report_lines.append(f"  {i:>2}. {msg}")

    report_lines.append("")
    report_lines.append(sep)
    report_lines.append("  RECOMMENDED FILTER CONDITIONS (to avoid likely losers):")
    report_lines.append(sep)

    # Auto-generate filter recommendations from top losing combos
    top_combos = [c for c in combo_results if c[3] > 5.0][:10]
    for pattern, count, lr, lift in top_combos:
        report_lines.append(f"  -> AVOID when: [{pattern}]  (Lose rate: {lr:.1f}%, +{lift:.1f}% above baseline)")

    report_lines.append("")
    report_lines.append(sep)

    return "\n".join(report_lines)


def main():
    os.makedirs(ANALYSIS_DIR, exist_ok=True)

    print("=" * 70)
    print("  LOSE PATTERN DISCOVERY — ATRBot + SMC + VSR Feature Analysis")
    print("=" * 70)

    print("\n[1/3] Loading entry and analyzed data...")
    all_entries, sym_data = load_all_data()

    print("\n[2/3] Building feature matrix for all trades...")
    feature_df = build_feature_matrix(all_entries)

    feat_csv = os.path.join(ANALYSIS_DIR, "feature_matrix.csv")
    feature_df.to_csv(feat_csv, index=False)
    print(f"  Feature matrix saved: {feat_csv} ({len(feature_df)} rows, {len(feature_df.columns)} features)")

    print("\n[3/3] Running pattern analysis...")
    report = analyze_patterns(feature_df)

    # Save report
    report_txt = os.path.join(ANALYSIS_DIR, "lose_pattern_report.txt")
    with open(report_txt, 'w', encoding='utf-8') as f:
        f.write(report)
    print(f"  Report saved: {report_txt}")

    # Save lose-only feature CSV
    lose_df = feature_df[feature_df['label'] == 'lose'].copy()
    lose_csv = os.path.join(ANALYSIS_DIR, "lose_features.csv")
    lose_df.to_csv(lose_csv, index=False)
    print(f"  Lose features saved: {lose_csv} ({len(lose_df)} rows)")

    # Print the full report to console
    print("\n" + report)


if __name__ == "__main__":
    main()
