"""
Step 14: Deep Investigation of Multi-Level Entry & Tiered TP/SL using SMC FVGs & Liquidity
==========================================================================================
Hypothesis:
1. Multi-level Entry (DCA / Grid Limit orders at Unmitigated FVGs):
   - When BUY signal appears, look back for unmitigated Bullish FVGs (support zones below market price).
   - Place Tier 1 Limit at FVG Top (shallow retest), Tier 2 Limit at FVG Midpoint (50% Consequent Encroachment), Tier 3 at FVG Bottom.
   - For SELL signal, look back for unmitigated Bearish FVGs above market price (Bottom, Midpoint, Top).
2. Multi-tier TP (Chốt lời từng phần):
   - TP1 (50% position): At nearest opposing unmitigated FVG (first resistance/support zone).
   - TP2 (50% position): At opposing Liquidity Pool (BSL for Long, SSL for Short).
3. Dynamic SL & Breakeven:
   - Initial SL placed below the deepest entry FVG bottom / Swing Low.
   - When TP1 is hit, move SL to Breakeven (+0.05% to cover fees).

We will backtest 4 Models across all 20 symbols (50,000 candles 5m = 1,000,000 bars):
  Model 0: Single Market Entry + Fixed 2% TP + Swing SL (Baseline)
  Model 1: Single Limit Entry at FVG Midpoint (50% CE) + Fixed 2% TP + Swing SL
  Model 2: Multi-Level Entry (3 Tiers: Market 40%, FVG Mid 30%, FVG Extreme 30%) + Fixed 2% TP + Swing SL
  Model 3: Multi-Level Entry + SMC Multi-Tier TP (TP1 at Opposing FVG, TP2 at Opposing Liq) + Breakeven Move
"""

import os, sys, glob, math
import numpy as np
import pandas as pd

if sys.stdout.encoding != 'utf-8':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

BASE_DIR         = os.path.dirname(os.path.abspath(__file__))
DATA_ANALISIC_5M = os.path.join(BASE_DIR, "data_analisic_5m")
ANALYSIS_DIR     = os.path.join(BASE_DIR, "analysis")
os.makedirs(ANALYSIS_DIR, exist_ok=True)

COMMISSION_TAKER = 0.0005  # 0.05%
COMMISSION_MAKER = 0.0002  # 0.02%
MIN_ATR_PCT      = 0.35
LIQ_FILTER_PCT   = 1.5
FVG_FILTER_PCT   = 1.5
MAX_WAIT_BARS    = 24      # Wait up to 24 bars (2 hours) for limit order fill


def get_unmitigated_fvgs(bar_idx, direction, current_price, sdata, lookback=50):
    """
    Find unmitigated FVGs in the supporting direction:
    - For BUY: Bullish FVGs (fvg > 0) with top <= current_price
    - For SELL: Bearish FVGs (fvg < 0) with bottom >= current_price
    """
    fvgs = []
    start_i = max(0, bar_idx - lookback)
    for i in range(bar_idx, start_i - 1, -1):
        f = sdata['smc_fvg'][i]
        if np.isnan(f) or f == 0: continue
        mit = sdata['smc_fvg_mitigated_index'][i]
        if not np.isnan(mit) and 0 < mit <= bar_idx: continue
        top = float(sdata['smc_fvg_top'][i])
        bot = float(sdata['smc_fvg_bottom'][i])
        if np.isnan(top) or np.isnan(bot): continue
        mid = (top + bot) / 2.0

        if direction == 'BUY' and f > 0 and top <= current_price:
            fvgs.append({'idx': i, 'top': top, 'mid': mid, 'bottom': bot, 'type': 'BULLISH'})
        elif direction == 'SELL' and f < 0 and bot >= current_price:
            fvgs.append({'idx': i, 'top': top, 'mid': mid, 'bottom': bot, 'type': 'BEARISH'})
    return fvgs


def get_opposing_targets(bar_idx, direction, current_price, sdata, liq_zones, lookback=50):
    """
    Find target 1 (nearest opposing unmitigated FVG) and target 2 (nearest opposing Liquidity Pool)
    """
    # 1. Opposing FVG Target
    fvg_target = None
    min_fvg_dist = float('inf')
    start_i = max(0, bar_idx - lookback)
    for i in range(bar_idx, start_i - 1, -1):
        f = sdata['smc_fvg'][i]
        if np.isnan(f) or f == 0: continue
        mit = sdata['smc_fvg_mitigated_index'][i]
        if not np.isnan(mit) and 0 < mit <= bar_idx: continue
        top = float(sdata['smc_fvg_top'][i])
        bot = float(sdata['smc_fvg_bottom'][i])
        if np.isnan(top) or np.isnan(bot): continue

        if direction == 'BUY' and f < 0 and bot > current_price:
            dist = (bot - current_price) / current_price * 100.0
            if 0.5 <= dist < min_fvg_dist:
                min_fvg_dist = dist
                fvg_target = bot
        elif direction == 'SELL' and f > 0 and top < current_price:
            dist = (current_price - top) / current_price * 100.0
            if 0.5 <= dist < min_fvg_dist:
                min_fvg_dist = dist
                fvg_target = top

    # 2. Opposing Liq Target
    liq_target = None
    min_liq_dist = float('inf')
    for z in liq_zones:
        if z['start'] <= bar_idx <= z['end']:
            if z['swept'] is not None and z['swept'] <= bar_idx: continue
            if direction == 'BUY' and z['type'] == 'BSL' and z['level'] > current_price:
                dist = (z['level'] - current_price) / current_price * 100.0
                if 1.0 <= dist < min_liq_dist:
                    min_liq_dist = dist
                    liq_target = z['level']
            elif direction == 'SELL' and z['type'] == 'SSL' and z['level'] < current_price:
                dist = (current_price - z['level']) / current_price * 100.0
                if 1.0 <= dist < min_liq_dist:
                    min_liq_dist = dist
                    liq_target = z['level']

    return fvg_target, liq_target


def simulate_model_execution(model_type, direction, sig_bar, entry_bar, exit_bar, sdata, liq_zones):
    """
    Simulate trade execution based on model_type:
    model_type 0: Single Market Entry, Fixed 2% TP, Swing SL
    model_type 1: Single Limit Entry at FVG Midpoint, Fixed 2% TP, Swing SL
    model_type 2: Multi-Tier Entry (3 Tiers: Market 40%, FVG Mid 30%, FVG Bot 30%), Fixed 2% TP, Swing SL
    model_type 3: Multi-Tier Entry + Multi-Tier TP (TP1 at FVG, TP2 at Liq) + Breakeven
    """
    n = len(sdata['close'])
    market_open = float(sdata['open'][entry_bar])
    highs = sdata['high']
    lows  = sdata['low']
    opens = sdata['open']

    # Find supporting FVGs for limit entry
    supp_fvgs = get_unmitigated_fvgs(sig_bar, direction, market_open, sdata)
    best_fvg = supp_fvgs[0] if supp_fvgs else None

    # Get Swing SL
    start_look = max(0, sig_bar - 30)
    swing_sl = None
    for i in range(sig_bar, start_look - 1, -1):
        shl = sdata['smc_swing_hl'][i]
        slev = sdata['smc_swing_level'][i]
        if np.isnan(shl) or np.isnan(slev): continue
        if direction == 'BUY' and shl < 0 and slev < market_open:
            swing_sl = slev * (1 - 0.0015); break
        elif direction == 'SELL' and shl > 0 and slev > market_open:
            swing_sl = slev * (1 + 0.0015); break
    if swing_sl is None:
        swing_sl = market_open * 0.965 if direction == 'BUY' else market_open * 1.035

    # Target calculation
    opp_fvg, opp_liq = get_opposing_targets(sig_bar, direction, market_open, sdata, liq_zones)

    # ── DEFINE ENTRY TIERS PER MODEL ──
    if model_type == 0:
        # 100% Market
        tiers = [{'weight': 1.0, 'price': market_open, 'is_limit': False, 'filled': True, 'fill_bar': entry_bar}]
    elif model_type == 1:
        # 100% Limit at FVG Mid
        if not best_fvg:
            # Fallback to market if no FVG
            tiers = [{'weight': 1.0, 'price': market_open, 'is_limit': False, 'filled': True, 'fill_bar': entry_bar}]
        else:
            limit_p = best_fvg['mid']
            tiers = [{'weight': 1.0, 'price': limit_p, 'is_limit': True, 'filled': False, 'fill_bar': None}]
    elif model_type in [2, 3]:
        # Multi-Tier DCA Grid: Tier 1 Market 40%, Tier 2 FVG Mid 30%, Tier 3 FVG Bot 30%
        if not best_fvg:
            tiers = [
                {'weight': 0.40, 'price': market_open, 'is_limit': False, 'filled': True, 'fill_bar': entry_bar},
                {'weight': 0.30, 'price': market_open * (0.995 if direction == 'BUY' else 1.005), 'is_limit': True, 'filled': False, 'fill_bar': None},
                {'weight': 0.30, 'price': market_open * (0.990 if direction == 'BUY' else 1.010), 'is_limit': True, 'filled': False, 'fill_bar': None},
            ]
        else:
            p1 = market_open
            p2 = best_fvg['mid']
            p3 = best_fvg['bottom'] if direction == 'BUY' else best_fvg['top']
            tiers = [
                {'weight': 0.40, 'price': p1, 'is_limit': False, 'filled': True, 'fill_bar': entry_bar},
                {'weight': 0.30, 'price': p2, 'is_limit': True, 'filled': False, 'fill_bar': None},
                {'weight': 0.30, 'price': p3, 'is_limit': True, 'filled': False, 'fill_bar': None},
            ]

    # ── SIMULATE BAR BY BAR ──
    sim_end = min(exit_bar, n - 1)
    first_fill_bar = None
    tp1_hit = False
    cur_sl = swing_sl
    realized_pnl_pct = 0.0
    closed_weight = 0.0
    is_active = False

    # Check immediate fills at entry_bar
    for t in tiers:
        if not t['is_limit']:
            t['filled'] = True
            t['fill_bar'] = entry_bar
            first_fill_bar = entry_bar
            is_active = True

    for bar_i in range(entry_bar, sim_end + 1):
        h = highs[bar_i]
        l = lows[bar_i]

        # 1. Check pending limit fills
        for t in tiers:
            if not t['filled']:
                # Check within wait window
                if bar_i <= entry_bar + MAX_WAIT_BARS:
                    if direction == 'BUY' and l <= t['price']:
                        t['filled'] = True
                        t['fill_bar'] = bar_i
                        is_active = True
                        if first_fill_bar is None: first_fill_bar = bar_i
                    elif direction == 'SELL' and h >= t['price']:
                        t['filled'] = True
                        t['fill_bar'] = bar_i
                        is_active = True
                        if first_fill_bar is None: first_fill_bar = bar_i

        if not is_active:
            # No fills yet
            continue

        # Active filled position stats
        filled_tiers = [t for t in tiers if t['filled']]
        filled_weight = sum(t['weight'] for t in filled_tiers) - closed_weight
        if filled_weight <= 0:
            break

        avg_entry = sum(t['weight'] * t['price'] for t in filled_tiers) / sum(t['weight'] for t in filled_tiers)

        # 2. Check Stop Loss
        hit_sl = False
        if direction == 'BUY' and l <= cur_sl:
            hit_sl = True
        elif direction == 'SELL' and h >= cur_sl:
            hit_sl = True

        if hit_sl:
            # Close all remaining position at SL
            pnl = (cur_sl - avg_entry) / avg_entry * 100.0 if direction == 'BUY' else (avg_entry - cur_sl) / avg_entry * 100.0
            fee = (COMMISSION_TAKER * 2) * 100.0
            realized_pnl_pct += (pnl - fee) * filled_weight
            closed_weight = sum(t['weight'] for t in filled_tiers)
            break

        # 3. Check Take Profit
        if model_type in [0, 1, 2]:
            # Fixed 2.0% TP
            target_tp = avg_entry * 1.02 if direction == 'BUY' else avg_entry * 0.98
            hit_tp = (direction == 'BUY' and h >= target_tp) or (direction == 'SELL' and l <= target_tp)
            if hit_tp:
                pnl = 2.0
                fee = (COMMISSION_TAKER + (COMMISSION_MAKER if any(t['is_limit'] for t in filled_tiers) else COMMISSION_TAKER)) * 100.0
                realized_pnl_pct += (pnl - fee) * filled_weight
                closed_weight = sum(t['weight'] for t in filled_tiers)
                break

        elif model_type == 3:
            # Multi-Tier TP:
            # TP1: Opposing FVG (or 1.5% default) -> Close 50% & Move SL to Breakeven
            target_tp1 = opp_fvg if opp_fvg else (avg_entry * 1.015 if direction == 'BUY' else avg_entry * 0.985)
            # TP2: Opposing Liq (or 3.0% default) -> Close remaining 50%
            target_tp2 = opp_liq if opp_liq else (avg_entry * 1.030 if direction == 'BUY' else avg_entry * 0.970)

            # Check TP1
            if not tp1_hit:
                hit_tp1 = (direction == 'BUY' and h >= target_tp1) or (direction == 'SELL' and l <= target_tp1)
                if hit_tp1:
                    tp1_hit = True
                    pnl_tp1 = (target_tp1 - avg_entry) / avg_entry * 100.0 if direction == 'BUY' else (avg_entry - target_tp1) / avg_entry * 100.0
                    fee = (COMMISSION_TAKER * 2) * 100.0
                    realized_pnl_pct += (pnl_tp1 - fee) * 0.50
                    closed_weight += 0.50
                    # Move SL to Breakeven
                    cur_sl = avg_entry * (1.0005 if direction == 'BUY' else 0.9995)

            # Check TP2
            if tp1_hit:
                hit_tp2 = (direction == 'BUY' and h >= target_tp2) or (direction == 'SELL' and l <= target_tp2)
                if hit_tp2:
                    pnl_tp2 = (target_tp2 - avg_entry) / avg_entry * 100.0 if direction == 'BUY' else (avg_entry - target_tp2) / avg_entry * 100.0
                    fee = (COMMISSION_TAKER * 2) * 100.0
                    realized_pnl_pct += (pnl_tp2 - fee) * (filled_weight - 0.50)
                    closed_weight = sum(t['weight'] for t in filled_tiers)
                    break

    # If position still partially open at end of cycle -> close at market open of reverse candle
    filled_tiers = [t for t in tiers if t['filled']]
    if closed_weight < sum(t['weight'] for t in filled_tiers):
        rem_weight = sum(t['weight'] for t in filled_tiers) - closed_weight
        avg_entry = sum(t['weight'] * t['price'] for t in filled_tiers) / sum(t['weight'] for t in filled_tiers)
        exit_p = opens[min(sim_end + 1, n - 1)]
        pnl = (exit_p - avg_entry) / avg_entry * 100.0 if direction == 'BUY' else (avg_entry - exit_p) / avg_entry * 100.0
        fee = (COMMISSION_TAKER * 2) * 100.0
        realized_pnl_pct += (pnl - fee) * rem_weight

    filled_count = sum(1 for t in tiers if t['filled'])
    total_tiers = len(tiers)
    fill_rate_pct = (filled_count / total_tiers) * 100.0

    return {
        'model_type': model_type,
        'has_executed': is_active,
        'filled_tiers': filled_count,
        'total_tiers': total_tiers,
        'fill_rate_pct': fill_rate_pct,
        'realized_pnl_pct': round(realized_pnl_pct, 3),
        'is_win': realized_pnl_pct > 0
    }


def run_experiment():
    print("=" * 96)
    print("  HYPOTHESIS TESTING: MULTI-ENTRY (FVG LIMITS) & TIERED TP/SL (SMC ZONES)")
    print("=" * 96)

    analyzed_files = sorted(glob.glob(os.path.join(DATA_ANALISIC_5M, "*_analyzed_5m.csv")))
    print(f"  Testing on {len(analyzed_files)} symbols x 50,000 candles 5m = 1,000,000 bars...\n")

    model_results = {0: [], 1: [], 2: [], 3: []}

    for f_idx, f in enumerate(analyzed_files, 1):
        sym = os.path.basename(f).replace("_analyzed_5m.csv", "")
        print(f"[{f_idx}/{len(analyzed_files)}] Processing {sym}...", end='\r')
        df = pd.read_csv(f)
        n = len(df)

        sdata = {
            'open': df['open'].values,
            'high': df['high'].values,
            'low': df['low'].values,
            'close': df['close'].values,
            'atrbot_buy': df['atrbot_buy'].fillna(False).astype(bool).values,
            'atrbot_sell': df['atrbot_sell'].fillna(False).astype(bool).values,
            'atrbot_atr': df['atrbot_atr'].fillna(0).values,
            'smc_fvg': df['smc_fvg'].values if 'smc_fvg' in df.columns else np.full(n, np.nan),
            'smc_fvg_top': df['smc_fvg_top'].values if 'smc_fvg_top' in df.columns else np.full(n, np.nan),
            'smc_fvg_bottom': df['smc_fvg_bottom'].values if 'smc_fvg_bottom' in df.columns else np.full(n, np.nan),
            'smc_fvg_mitigated_index': df['smc_fvg_mitigated_index'].values if 'smc_fvg_mitigated_index' in df.columns else np.full(n, np.nan),
            'smc_swing_hl': df['smc_swing_hl'].values if 'smc_swing_hl' in df.columns else np.full(n, np.nan),
            'smc_swing_level': df['smc_swing_level'].values if 'smc_swing_level' in df.columns else np.full(n, np.nan),
        }

        # Build liq zones
        zones = []
        for i in range(n):
            liq = df['smc_liquidity'][i]
            if pd.isna(liq) or liq == 0: continue
            end_idx = int(df['smc_liq_end_index'][i]) if pd.notna(df['smc_liq_end_index'][i]) else 999999
            swept = int(df['smc_liq_swept_index'][i]) if (pd.notna(df['smc_liq_swept_index'][i]) and df['smc_liq_swept_index'][i] > 0) else None
            lev = float(df['smc_liq_level'][i]) if pd.notna(df['smc_liq_level'][i]) else None
            if lev:
                zones.append({'start': i, 'end': end_idx, 'swept': swept, 'type': 'BSL' if liq > 0 else 'SSL', 'level': lev})

        # Find signals
        signals = []
        for i in range(n):
            if sdata['atrbot_buy'][i]: signals.append((i, 'BUY'))
            elif sdata['atrbot_sell'][i]: signals.append((i, 'SELL'))

        for s_idx, (sig_bar, direction) in enumerate(signals):
            entry_bar = sig_bar + 1
            if entry_bar >= n: break
            exit_bar = signals[s_idx + 1][0] if s_idx < len(signals) - 1 else n - 1

            market_open = float(sdata['open'][entry_bar])
            close_p = float(sdata['close'][sig_bar])
            atr_pct = (float(sdata['atrbot_atr'][sig_bar]) / close_p * 100.0) if close_p > 0 else 0.0

            # Filter ATR & FVG
            if atr_pct < MIN_ATR_PCT: continue

            for m in [0, 1, 2, 3]:
                res = simulate_model_execution(m, direction, sig_bar, entry_bar, exit_bar, sdata, zones)
                if res['has_executed']:
                    res['symbol'] = sym
                    model_results[m].append(res)

    print(f"\nSimulation finished across all 20 symbols.")

    # ── COMPILE COMPARATIVE METRICS ──
    summary_rows = []
    names = {
        0: "Model 0: Baseline (Single Market Entry + Fixed 2% TP)",
        1: "Model 1: FVG Limit Only (100% Limit at 50% FVG Midpoint)",
        2: "Model 2: Multi-Tier DCA (40% Market + 30% FVG Mid + 30% FVG Bot)",
        3: "Model 3: Full SMC (Multi-Entry + TP1 FVG / TP2 Liq + Breakeven)"
    }

    for m in [0, 1, 2, 3]:
        trades = model_results[m]
        df_m = pd.DataFrame(trades)
        total_t = len(df_m)
        win_t = len(df_m[df_m['is_win']])
        wr = (win_t / total_t * 100.0) if total_t > 0 else 0.0
        tot_pnl = df_m['realized_pnl_pct'].sum()
        avg_pnl = df_m['realized_pnl_pct'].mean()
        avg_fill = df_m['fill_rate_pct'].mean()
        
        # Profit factor
        gross_w = df_m[df_m['realized_pnl_pct'] > 0]['realized_pnl_pct'].sum()
        gross_l = abs(df_m[df_m['realized_pnl_pct'] <= 0]['realized_pnl_pct'].sum())
        pf = (gross_w / gross_l) if gross_l > 0 else 0.0

        summary_rows.append({
            'Model ID': m,
            'Model Architecture': names[m],
            'Total Trades': total_t,
            'Fill Rate %': round(avg_fill, 1),
            'Win Rate %': round(wr, 2),
            'Profit Factor': round(pf, 2),
            'Net PnL %': round(tot_pnl, 1),
            'Avg PnL / Trade %': round(avg_pnl, 3),
        })

    summary_df = pd.DataFrame(summary_rows)
    summary_df.to_csv(os.path.join(ANALYSIS_DIR, "multi_entry_fvg_liq_comparison.csv"), index=False)

    print("\n" + "=" * 96)
    print("  RESULTS MATRIX: MULTI-ENTRY & TIERED SMC TP/SL HYPOTHESIS")
    print("=" * 96)
    for r in summary_rows:
        print(f"\n  ► {r['Model Architecture']}")
        print(f"    • Total Trades     : {r['Total Trades']:,} lệnh (Tỷ lệ khớp lệnh trung bình: {r['Fill Rate %']}%)")
        print(f"    • Win Rate         : {r['Win Rate %']}%")
        print(f"    • Profit Factor    : {r['Profit Factor']}x")
        print(f"    • Tổng Lợi Nhuận   : {r['Net PnL %']:+,.1f}% (Kỳ vọng: {r['Avg PnL / Trade %']:+.3f}% / lệnh)")

    print("\n" + "=" * 96 + "\n")


if __name__ == "__main__":
    run_experiment()
