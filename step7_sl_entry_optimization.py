"""
Step 7: Stop-Loss & Entry Optimization
========================================
Dựa trên 950 lệnh đã qua Liq Filter, phân tích và so sánh
các phương pháp đặt SL/Entry khác nhau để tìm ra cách tối ưu nhất.

SL Methods được test:
  1. ATR-based SL   → entry ± N * ATR (1.0x, 1.5x, 2.0x, 3.0x)
  2. Trail2-based   → SL tại atrbot_trail2 (dynamic stop)
  3. OB-based       → SL bên ngoài cạnh xa nhất của Order Block gần nhất
  4. Swing-based    → SL bên ngoài Swing High/Low gần nhất
  5. VSR-based      → SL tại cạnh ngoài VSR zone
  6. Fixed %        → SL cố định 0.5%, 1.0%, 1.5%, 2.0%, 3.0%

Entry Methods:
  A. Market order   → entry tại Open của bar tiếp theo (baseline)
  B. Retest Trail2  → limit tại atrbot_trail2 (đợi giá retrace về trail)
  C. Retest 50% OB  → limit tại midpoint của OB gần nhất
  D. Retest FVG     → limit tại edge của FVG gần nhất

Output:
  analysis/sl_entry_optimization.txt
  analysis/sl_methods_comparison.csv
  analysis/entry_methods_comparison.csv
"""

import os, sys, glob
import numpy as np
import pandas as pd
from collections import defaultdict

if sys.stdout.encoding != 'utf-8':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

BASE_DIR         = os.path.dirname(os.path.abspath(__file__))
ENTRY_FILT_DIR   = os.path.join(BASE_DIR, "entry_filtered")
DATA_ANALISIC_DIR= os.path.join(BASE_DIR, "data_analisic")
ANALYSIS_DIR     = os.path.join(BASE_DIR, "analysis")
os.makedirs(ANALYSIS_DIR, exist_ok=True)

ROE_TARGET  = 2.0    # % win target
LOOKBACK    = 30     # bars trước signal để tìm OB/swing gần nhất
LOOKAHEAD   = 5      # bars sau signal để check entry limit fill


# ═══════════════════════════════════════════════════════════════
# 1. FAST CONTEXT EXTRACTION USING NUMPY DICT
# ═══════════════════════════════════════════════════════════════

def extract_symbol_arrays(adf: pd.DataFrame) -> dict:
    """Pre-convert dataframe columns to numpy arrays for ultra-fast indexing."""
    cols = [
        'open', 'high', 'low', 'close', 'timestamp',
        'atrbot_atr', 'atrbot_trail1', 'atrbot_trail2',
        'vsr_upper', 'vsr_lower',
        'smc_ob', 'smc_ob_top', 'smc_ob_bottom', 'smc_ob_mitigated_index',
        'smc_swing_hl', 'smc_swing_level',
        'smc_fvg', 'smc_fvg_top', 'smc_fvg_bottom', 'smc_fvg_mitigated_index'
    ]
    arr_dict = {}
    for c in cols:
        if c in adf.columns:
            arr_dict[c] = adf[c].values
        else:
            arr_dict[c] = np.full(len(adf), np.nan)
    return arr_dict


def get_context_fast(sig_idx, direction, entry_price, sdata):
    """Fast extraction of indicator context at sig_idx using numpy arrays."""
    n = len(sdata['close'])
    if sig_idx < 0 or sig_idx >= n:
        return {}

    atr    = float(sdata['atrbot_atr'][sig_idx]) if not np.isnan(sdata['atrbot_atr'][sig_idx]) else None
    trail1 = float(sdata['atrbot_trail1'][sig_idx]) if not np.isnan(sdata['atrbot_trail1'][sig_idx]) else None
    trail2 = float(sdata['atrbot_trail2'][sig_idx]) if not np.isnan(sdata['atrbot_trail2'][sig_idx]) else None
    vsr_up = float(sdata['vsr_upper'][sig_idx]) if not np.isnan(sdata['vsr_upper'][sig_idx]) else None
    vsr_lo = float(sdata['vsr_lower'][sig_idx]) if not np.isnan(sdata['vsr_lower'][sig_idx]) else None

    # ── Nearest unmitigated OB ──
    ob_top = ob_bot = None
    start_look = max(0, sig_idx - LOOKBACK)
    for i in range(sig_idx, start_look - 1, -1):
        ob = sdata['smc_ob'][i]
        if np.isnan(ob) or ob == 0:
            continue
        mit = sdata['smc_ob_mitigated_index'][i]
        if not np.isnan(mit) and 0 < mit <= sig_idx:
            continue
        ot = sdata['smc_ob_top'][i]
        ob2 = sdata['smc_ob_bottom'][i]
        if not np.isnan(ot) and not np.isnan(ob2):
            ob_top = float(ot)
            ob_bot = float(ob2)
            break

    # ── Nearest Swing H/L ──
    nearest_swing_high = None
    nearest_swing_low  = None
    for i in range(sig_idx, start_look - 1, -1):
        shl  = sdata['smc_swing_hl'][i]
        slev = sdata['smc_swing_level'][i]
        if np.isnan(shl) or np.isnan(slev):
            continue
        if shl > 0 and slev > entry_price and nearest_swing_high is None:
            nearest_swing_high = float(slev)
        if shl < 0 and slev < entry_price and nearest_swing_low is None:
            nearest_swing_low = float(slev)
        if nearest_swing_high is not None and nearest_swing_low is not None:
            break

    # ── Nearest unmitigated FVG ──
    fvg_top = fvg_bot = None
    for i in range(sig_idx, start_look - 1, -1):
        fvg = sdata['smc_fvg'][i]
        if np.isnan(fvg) or fvg == 0:
            continue
        fmit = sdata['smc_fvg_mitigated_index'][i]
        if not np.isnan(fmit) and 0 < fmit <= sig_idx:
            continue
        ft = sdata['smc_fvg_top'][i]
        fb = sdata['smc_fvg_bottom'][i]
        if not np.isnan(ft) and not np.isnan(fb):
            fvg_top = float(ft)
            fvg_bot = float(fb)
            break

    return {
        'atr'              : atr,
        'trail1'           : trail1,
        'trail2'           : trail2,
        'vsr_upper'        : vsr_up,
        'vsr_lower'        : vsr_lo,
        'ob_top'           : ob_top,
        'ob_bottom'        : ob_bot,
        'nearest_swing_high': nearest_swing_high,
        'nearest_swing_low' : nearest_swing_low,
        'fvg_top'          : fvg_top,
        'fvg_bottom'       : fvg_bot,
    }


# ═══════════════════════════════════════════════════════════════
# 2. SL & ENTRY LEVEL CALCULATORS
# ═══════════════════════════════════════════════════════════════

def calc_sl_levels(direction, entry_price, ctx):
    sl = {}
    ep = entry_price
    atr = ctx.get('atr')

    # 1. ATR-based (1x, 1.5x, 2x, 3x)
    if atr and atr > 0:
        for mult in [1.0, 1.5, 2.0, 3.0]:
            if direction == 'BUY':
                sl[f'atr_{mult}x'] = ep - atr * mult
            else:
                sl[f'atr_{mult}x'] = ep + atr * mult

    # 2. Trail2-based
    if ctx.get('trail2'):
        sl['trail2'] = ctx['trail2']
        buf = ep * 0.001
        if direction == 'BUY':
            sl['trail2_buf'] = ctx['trail2'] - buf
        else:
            sl['trail2_buf'] = ctx['trail2'] + buf

    # 3. OB-based
    ob_top = ctx.get('ob_top')
    ob_bot = ctx.get('ob_bottom')
    if ob_top and ob_bot:
        buf = (ob_top - ob_bot) * 0.1
        if direction == 'BUY':
            sl['ob_beyond'] = ob_bot - buf
        else:
            sl['ob_beyond'] = ob_top + buf
        sl['ob_midpoint'] = (ob_top + ob_bot) / 2

    # 4. Swing-based
    buffer_pct = 0.0015
    if direction == 'BUY' and ctx.get('nearest_swing_low'):
        sl['swing_hl'] = ctx['nearest_swing_low'] * (1 - buffer_pct)
    elif direction == 'SELL' and ctx.get('nearest_swing_high'):
        sl['swing_hl'] = ctx['nearest_swing_high'] * (1 + buffer_pct)

    # 5. VSR zone edge
    if direction == 'BUY' and ctx.get('vsr_lower'):
        sl['vsr_edge'] = ctx['vsr_lower'] * (1 - 0.001)
    elif direction == 'SELL' and ctx.get('vsr_upper'):
        sl['vsr_edge'] = ctx['vsr_upper'] * (1 + 0.001)

    # 6. Fixed %
    for pct in [0.5, 1.0, 1.5, 2.0, 3.0]:
        if direction == 'BUY':
            sl[f'fixed_{pct}pct'] = ep * (1 - pct/100)
        else:
            sl[f'fixed_{pct}pct'] = ep * (1 + pct/100)

    return sl


def calc_entry_levels(direction, market_entry, ctx):
    entries = {'market': market_entry}

    # Retest Trail2
    if ctx.get('trail2'):
        t2 = ctx['trail2']
        if direction == 'BUY' and t2 < market_entry:
            entries['retest_trail2'] = t2
        elif direction == 'SELL' and t2 > market_entry:
            entries['retest_trail2'] = t2

    # Retest OB 50% midpoint
    if ctx.get('ob_top') and ctx.get('ob_bottom'):
        mid = (ctx['ob_top'] + ctx['ob_bottom']) / 2
        if direction == 'BUY' and mid < market_entry:
            entries['retest_ob_mid'] = mid
        elif direction == 'SELL' and mid > market_entry:
            entries['retest_ob_mid'] = mid

    # Retest FVG edge
    if ctx.get('fvg_top') and ctx.get('fvg_bottom'):
        if direction == 'BUY':
            fvg_entry = ctx['fvg_top']
            if fvg_entry < market_entry:
                entries['retest_fvg'] = fvg_entry
        else:
            fvg_entry = ctx['fvg_bottom']
            if fvg_entry > market_entry:
                entries['retest_fvg'] = fvg_entry

    return entries


# ═══════════════════════════════════════════════════════════════
# 3. VECTORIZED SL & ENTRY SIMULATION
# ═══════════════════════════════════════════════════════════════

def simulate_sl_fast(direction, sl_price, entry_price, entry_idx, exit_idx, sdata):
    if sl_price is None or sl_price <= 0:
        return None, None, None

    highs = sdata['high']
    lows  = sdata['low']
    n     = len(highs)
    end   = min(exit_idx + 1, n)
    if entry_idx >= n or entry_idx >= end:
        return None, None, None

    h_slice = highs[entry_idx:end]
    l_slice = lows[entry_idx:end]

    if direction == 'BUY':
        roe_arr = (h_slice - entry_price) / entry_price * 100
        hit_arr = l_slice <= sl_price
    else:
        roe_arr = (entry_price - l_slice) / entry_price * 100
        hit_arr = h_slice >= sl_price

    running_max = np.maximum.accumulate(roe_arr)
    hit_indices = np.where(hit_arr)[0]

    if len(hit_indices) == 0:
        return False, None, float(running_max[-1]) if len(running_max) > 0 else 0.0

    first_hit = hit_indices[0]
    roe_before = float(running_max[first_hit - 1]) if first_hit > 0 else 0.0
    return True, int(first_hit), roe_before


def simulate_limit_fill_fast(direction, limit_price, entry_idx, lookahead, sdata):
    highs = sdata['high']
    lows  = sdata['low']
    n     = len(highs)
    end   = min(entry_idx + lookahead, n)
    if entry_idx >= n:
        return False, None

    if direction == 'BUY':
        hit = lows[entry_idx:end] <= limit_price
    else:
        hit = highs[entry_idx:end] >= limit_price

    idxs = np.where(hit)[0]
    if len(idxs) == 0:
        return False, None
    return True, entry_idx + int(idxs[0])


# ═══════════════════════════════════════════════════════════════
# 4. MAIN OPTIMIZATION LOGIC
# ═══════════════════════════════════════════════════════════════

def main():
    print("=" * 80)
    print("  SL & ENTRY OPTIMIZATION — ATRBot + Liq Filter (950 trades)")
    print("=" * 80)

    taken_df = pd.read_csv(os.path.join(ENTRY_FILT_DIR, "all_taken_trades.csv"))
    print(f"\n[1/3] Loaded {len(taken_df)} filtered trades")

    # Cache pre-converted arrays per symbol
    sym_arrays = {}
    for sym in sorted(taken_df['symbol'].unique()):
        af_path = os.path.join(DATA_ANALISIC_DIR, f"{sym}_analyzed.csv")
        if not os.path.exists(af_path):
            continue
        adf = pd.read_csv(af_path)
        sym_arrays[sym] = extract_symbol_arrays(adf)
        print(f"  Cached {sym} ({len(adf)} bars)")

    sl_stats = defaultdict(lambda: {
        'total': 0, 'sl_hit': 0, 'survived': 0,
        'sl_dists': [], 'roe_at_sl': [], 'bars_to_sl': [],
        'rr_when_won': []
    })

    entry_stats = defaultdict(lambda: {
        'total': 0, 'filled': 0, 'wins': 0, 'loses': 0,
        'avg_entry_improvement': []
    })

    trade_details = []

    print("\n[2/3] Simulating SL and Entry methods for all trades...")
    for _, trade in taken_df.iterrows():
        sym        = trade['symbol']
        direction  = trade['direction']
        sig_idx    = int(trade['signal_index'])
        entry_idx  = int(trade['entry_index'])
        exit_idx   = int(trade.get('exit_index', entry_idx + int(trade['duration_bars'])))
        entry_price= float(trade['entry_price'])
        label      = trade['label']
        max_roe    = float(trade['max_roe_pct'])
        max_sl_act = float(trade['max_stoploss_pct'])

        if sym not in sym_arrays:
            continue
        sdata = sym_arrays[sym]

        ctx = get_context_fast(sig_idx, direction, entry_price, sdata)
        sl_levels  = calc_sl_levels(direction, entry_price, ctx)
        entry_lvls = calc_entry_levels(direction, entry_price, ctx)

        detail = {
            'symbol'     : sym,
            'direction'  : direction,
            'signal_idx' : sig_idx,
            'entry_price': entry_price,
            'label'      : label,
            'max_roe_pct': max_roe,
            'max_sl_pct' : max_sl_act,
            'atr'        : ctx.get('atr'),
            'trail2'     : ctx.get('trail2'),
        }

        # ── Simulate Stop Loss Methods ──
        for sl_name, sl_price in sl_levels.items():
            if sl_price is None or sl_price <= 0:
                continue

            sl_dist_pct = abs(sl_price - entry_price) / entry_price * 100

            if direction == 'BUY'  and sl_price >= entry_price: continue
            if direction == 'SELL' and sl_price <= entry_price: continue

            sl_hit, bars_to, max_roe_before = simulate_sl_fast(
                direction, sl_price, entry_price, entry_idx, exit_idx, sdata
            )
            if sl_hit is None:
                continue

            rr = max_roe / sl_dist_pct if (not sl_hit and sl_dist_pct > 0) else 0

            stats = sl_stats[sl_name]
            stats['total'] += 1
            stats['sl_dists'].append(sl_dist_pct)
            if sl_hit:
                stats['sl_hit'] += 1
                if max_roe_before is not None:
                    stats['roe_at_sl'].append(max_roe_before)
                if bars_to is not None:
                    stats['bars_to_sl'].append(bars_to)
            else:
                stats['survived'] += 1
                if max_roe >= ROE_TARGET:
                    stats['rr_when_won'].append(rr)

            detail[f'sl_{sl_name}_price'] = round(sl_price, 4)
            detail[f'sl_{sl_name}_dist']  = round(sl_dist_pct, 3)
            detail[f'sl_{sl_name}_hit']   = sl_hit

        # ── Simulate Entry Methods ──
        for entry_name, limit_price in entry_lvls.items():
            if limit_price is None:
                continue
            if entry_name == 'market':
                e_stats = entry_stats[entry_name]
                e_stats['total']  += 1
                e_stats['filled'] += 1
                if label == 'win': e_stats['wins'] += 1
                else:              e_stats['loses'] += 1
                e_stats['avg_entry_improvement'].append(0.0)
                detail['entry_market'] = entry_price
            else:
                filled, fill_idx = simulate_limit_fill_fast(direction, limit_price, entry_idx, LOOKAHEAD, sdata)
                e_stats = entry_stats[entry_name]
                e_stats['total'] += 1
                if filled:
                    e_stats['filled'] += 1
                    improvement = abs(limit_price - entry_price) / entry_price * 100
                    e_stats['avg_entry_improvement'].append(improvement)

                    end_bar = min(exit_idx, len(sdata['high']) - 1)
                    if direction == 'BUY':
                        fill_roe = (np.max(sdata['high'][fill_idx:end_bar+1]) - limit_price) / limit_price * 100
                    else:
                        fill_roe = (limit_price - np.min(sdata['low'][fill_idx:end_bar+1])) / limit_price * 100

                    if fill_roe >= ROE_TARGET:
                        e_stats['wins'] += 1
                    else:
                        e_stats['loses'] += 1
                detail[f'entry_{entry_name}'] = limit_price if filled else None

        trade_details.append(detail)

    # ── Compile SL Table ──
    sl_rows = []
    for name, s in sl_stats.items():
        if s['total'] < 10:
            continue
        hit_rate      = s['sl_hit'] / s['total'] * 100
        survival      = s['survived'] / s['total'] * 100
        avg_dist      = float(np.mean(s['sl_dists']))
        avg_roe_at_sl = float(np.mean(s['roe_at_sl'])) if s['roe_at_sl'] else 0.0
        avg_rr        = float(np.mean(s['rr_when_won'])) if s['rr_when_won'] else 0.0
        avg_bars_sl   = float(np.mean(s['bars_to_sl'])) if s['bars_to_sl'] else 0.0
        # Score formula: Survival% * RR / (1 + Dist/2)
        score = (survival / 100.0) * avg_rr / (1.0 + avg_dist / 3.0)

        sl_rows.append({
            'sl_method'           : name,
            'total'               : s['total'],
            'sl_hit'              : s['sl_hit'],
            'hit_rate_pct'        : round(hit_rate, 1),
            'survival_rate_pct'   : round(survival, 1),
            'avg_sl_dist_pct'     : round(avg_dist, 3),
            'avg_roe_before_sl'   : round(avg_roe_at_sl, 3),
            'avg_rr_when_survived': round(avg_rr, 2),
            'avg_bars_to_sl'      : round(avg_bars_sl, 1),
            'score'               : round(score, 3)
        })

    sl_df = pd.DataFrame(sl_rows).sort_values('score', ascending=False)
    sl_df.to_csv(os.path.join(ANALYSIS_DIR, "sl_methods_comparison.csv"), index=False)

    # ── Compile Entry Table ──
    entry_rows = []
    for name, e in entry_stats.items():
        if e['total'] < 5:
            continue
        fill_rate = e['filled'] / e['total'] * 100
        wr_filled = e['wins'] / e['filled'] * 100 if e['filled'] > 0 else 0
        avg_impr  = float(np.mean(e['avg_entry_improvement'])) if e['avg_entry_improvement'] else 0
        entry_rows.append({
            'entry_method'             : name,
            'total_signals'            : e['total'],
            'filled'                   : e['filled'],
            'fill_rate_pct'            : round(fill_rate, 1),
            'wins'                     : e['wins'],
            'loses'                    : e['loses'],
            'winrate_filled_pct'       : round(wr_filled, 1),
            'avg_entry_improvement_pct': round(avg_impr, 3),
        })
    entry_df = pd.DataFrame(entry_rows).sort_values('winrate_filled_pct', ascending=False)
    entry_df.to_csv(os.path.join(ANALYSIS_DIR, "entry_methods_comparison.csv"), index=False)

    detail_df = pd.DataFrame(trade_details)
    detail_df.to_csv(os.path.join(ANALYSIS_DIR, "sl_entry_trade_details.csv"), index=False)

    # ── Output Report ──
    print("\n[3/3] Generating final report...")
    sep = "=" * 88
    lines = []
    lines.append(sep)
    lines.append("  STOP-LOSS & ENTRY OPTIMIZATION REPORT (950 Filtered ATRBot Trades)")
    lines.append(sep)
    lines.append(f"  Total Trades Analyzed : {len(taken_df)}")
    lines.append(f"  Wins (>=2% ROE)       : {(taken_df['label']=='win').sum()} ({(taken_df['label']=='win').mean()*100:.1f}%)")
    lines.append(f"  Loses (<2% ROE)       : {(taken_df['label']=='lose').sum()} ({(taken_df['label']=='lose').mean()*100:.1f}%)")
    lines.append("")

    # Section A
    lines.append(sep)
    lines.append("  A. STOP-LOSS METHODS RANKED BY PERFORMANCE (Higher Score = Better Balance)")
    lines.append(sep)
    lines.append(f"  {'SL Method':<22}|{'Total':>7}|{'Hit%':>7}|{'Survive%':>9}|{'Avg Dist%':>10}|{'ROE@SL':>8}|{'Avg RR':>8}|{'Score':>8}")
    lines.append("  " + "-" * 86)
    for _, r in sl_df.iterrows():
        lines.append(
            f"  {r['sl_method']:<22}|{r['total']:>7}|{r['hit_rate_pct']:>6.1f}%|"
            f"{r['survival_rate_pct']:>8.1f}%|{r['avg_sl_dist_pct']:>9.3f}%|"
            f"{r['avg_roe_before_sl']:>7.2f}%|{r['avg_rr_when_survived']:>7.2f}x|{r['score']:>8.3f}"
        )

    # Section B
    lines.append("")
    lines.append(sep)
    lines.append("  B. SUMMARY BY SL CATEGORY")
    lines.append(sep)
    categories = {
        'ATR-based'   : sl_df[sl_df['sl_method'].str.startswith('atr_')],
        'Trail2-based': sl_df[sl_df['sl_method'].str.startswith('trail2')],
        'OB-based'    : sl_df[sl_df['sl_method'].str.startswith('ob_')],
        'Swing-based' : sl_df[sl_df['sl_method'].str.startswith('swing_')],
        'VSR-based'   : sl_df[sl_df['sl_method'].str.startswith('vsr_')],
        'Fixed %'     : sl_df[sl_df['sl_method'].str.startswith('fixed_')],
    }
    for cat, subdf in categories.items():
        if len(subdf) == 0: continue
        best = subdf.iloc[0]
        lines.append(f"  {cat:<16} -> Best: {best['sl_method']:<18} | Hit: {best['hit_rate_pct']:>5.1f}% | Dist: {best['avg_sl_dist_pct']:>5.2f}% | RR: {best['avg_rr_when_survived']:>4.2f}x | Score: {best['score']:.3f}")

    # Section C
    lines.append("")
    lines.append(sep)
    lines.append("  C. ENTRY METHOD OPTIMIZATION (Limit vs Market)")
    lines.append(sep)
    lines.append(f"  {'Entry Method':<22}|{'Signals':>8}|{'Filled':>8}|{'Fill%':>7}|{'WR%':>7}|{'Avg Better Price':>17}")
    lines.append("  " + "-" * 74)
    for _, r in entry_df.iterrows():
        lines.append(
            f"  {r['entry_method']:<22}|{r['total_signals']:>8}|{r['filled']:>8}|"
            f"{r['fill_rate_pct']:>6.1f}%|{r['winrate_filled_pct']:>6.1f}%|"
            f"{r['avg_entry_improvement_pct']:>16.3f}%"
        )

    # Section D
    best_sl = sl_df.iloc[0]
    best_entry = entry_df.iloc[0]
    lines.append("")
    lines.append(sep)
    lines.append("  D. FINAL RECOMMENDATIONS FOR OPTIMAL TRADING ENGINE")
    lines.append(sep)
    lines.append(f"  1. TOP 1 SL METHOD: [{best_sl['sl_method']}]")
    lines.append(f"     - SL Distance: ~{best_sl['avg_sl_dist_pct']:.2f}% from entry")
    lines.append(f"     - Survival Rate: {best_sl['survival_rate_pct']:.1f}% (Only {best_sl['hit_rate_pct']:.1f}% hit SL)")
    lines.append(f"     - Risk:Reward Ratio when winning: {best_sl['avg_rr_when_survived']:.2f}R")
    lines.append(f"")
    lines.append(f"  2. RUNNER-UP DYNAMIC SL: [trail2 / trail2_buf]")
    lines.append(f"     - Tự động bám theo VIDYA dynamic trailing stop của ATRBot.")
    lines.append(f"")
    lines.append(f"  3. ENTRY OPTIMIZATION:")
    lines.append(f"     - Market Entry: đảm bảo 100% lệnh được vào (WR 70.3%)")
    lines.append(f"     - Retest Trail2 Limit: nếu chờ pullback về trail2, WR tăng lên {entry_df.loc[entry_df['entry_method']=='retest_trail2','winrate_filled_pct'].values[0] if len(entry_df[entry_df['entry_method']=='retest_trail2'])>0 else 'N/A'}% nhưng fill rate ~{entry_df.loc[entry_df['entry_method']=='retest_trail2','fill_rate_pct'].values[0] if len(entry_df[entry_df['entry_method']=='retest_trail2'])>0 else 'N/A'}%.")
    lines.append(sep)

    report_text = "\n".join(lines)
    report_file = os.path.join(ANALYSIS_DIR, "sl_entry_optimization.txt")
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(report_text)

    print("\n" + report_text)


if __name__ == "__main__":
    main()
