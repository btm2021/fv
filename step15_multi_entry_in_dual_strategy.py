"""
Step 15: Multi-Level Entry & Tiered TP/SL Applied to the Winning Enhanced Dual Strategy
========================================================================================
Testing across 20 Symbols x 50,000 candles 5m = 1,000,000 bars.

We compare 4 Architectural Setups inside the Enhanced Dual Strategy:

Setup A (Current Champion):
  - Trend: 100% Market Entry next open + Fixed 2.0% TP + Swing SL
  - Fade : 100% Limit Entry at Liq Level + Fixed 2.0% TP + Hard SL 2.5%

Setup B (Multi-Entry FVG Limit Grid):
  - Trend: 50% Market Entry + 50% Limit at Pullback FVG (50% CE) + Fixed 2.0% TP
  - Fade : 50% Limit at Liq Level + 50% Limit at Over-sweep (+0.5% deeper) + Fixed 2.0% TP

Setup C (Tiered SMC TP & Breakeven):
  - Trend: 100% Market Entry + TP1 (50%) at Opposing FVG + TP2 (50%) at Opposing Liq + SL to Breakeven
  - Fade : 100% Limit at Liq Level + TP1 (50%) at Retest FVG + TP2 (50%) at Swing Origin + SL to Breakeven

Setup D (Full SMC Master: Multi-Entry Grid + Tiered SMC TP + Dynamic Breakeven):
  - Trend: Multi-Limit FVG + Tiered SMC TP + Breakeven SL
  - Fade : Multi-Limit Liq Grid + Tiered SMC TP + Breakeven SL
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
FADE_HARD_SL_PCT = 2.5
MAX_WAIT_BARS    = 24


def build_liq_zones(df):
    zones = []
    for i in range(len(df)):
        liq = df['smc_liquidity'][i]
        if pd.isna(liq) or liq == 0: continue
        end_idx = int(df['smc_liq_end_index'][i]) if pd.notna(df['smc_liq_end_index'][i]) else 999999
        swept = int(df['smc_liq_swept_index'][i]) if (pd.notna(df['smc_liq_swept_index'][i]) and df['smc_liq_swept_index'][i] > 0) else None
        lev = float(df['smc_liq_level'][i]) if pd.notna(df['smc_liq_level'][i]) else None
        if lev:
            zones.append({'start': i, 'end': end_idx, 'swept': swept, 'type': 'BSL' if liq > 0 else 'SSL', 'level': lev})
    return zones


def check_danger_liq(bar_idx, direction, entry_price, zones):
    nearest_dist = float('inf')
    danger_level = None
    for z in zones:
        if z['start'] <= bar_idx <= z['end']:
            if z['swept'] is not None and z['swept'] <= bar_idx: continue
            if direction == 'BUY' and z['type'] == 'BSL' and z['level'] > entry_price:
                dist = (z['level'] - entry_price) / entry_price * 100.0
                if dist < nearest_dist:
                    nearest_dist = dist
                    danger_level = z['level']
            elif direction == 'SELL' and z['type'] == 'SSL' and z['level'] < entry_price:
                dist = (entry_price - z['level']) / entry_price * 100.0
                if dist < nearest_dist:
                    nearest_dist = dist
                    danger_level = z['level']
    is_danger = nearest_dist < LIQ_FILTER_PCT
    return is_danger, (nearest_dist if nearest_dist != float('inf') else None), danger_level


def check_counter_fvg(bar_idx, direction, entry_price, sdata):
    start_look = max(0, bar_idx - 15)
    for i in range(bar_idx, start_look - 1, -1):
        fvg = sdata['smc_fvg'][i]
        if np.isnan(fvg) or fvg == 0: continue
        mit = sdata['smc_fvg_mitigated_index'][i]
        if not np.isnan(mit) and 0 < mit <= bar_idx: continue
        top = sdata['smc_fvg_top'][i]
        bot = sdata['smc_fvg_bottom'][i]
        if direction == 'BUY' and fvg < 0 and not np.isnan(bot) and bot > entry_price:
            dist = (bot - entry_price) / entry_price * 100.0
            if dist < FVG_FILTER_PCT: return True, dist
        elif direction == 'SELL' and fvg > 0 and not np.isnan(top) and top < entry_price:
            dist = (entry_price - top) / entry_price * 100.0
            if dist < FVG_FILTER_PCT: return True, dist
    return False, None


def get_unmitigated_pullback_fvg(bar_idx, direction, current_price, sdata, lookback=30):
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
            return {'top': top, 'mid': mid, 'bottom': bot}
        elif direction == 'SELL' and f < 0 and bot >= current_price:
            return {'top': top, 'mid': mid, 'bottom': bot}
    return None


def get_opposing_targets(bar_idx, direction, current_price, sdata, liq_zones, lookback=40):
    opp_fvg = None
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
                opp_fvg = bot
        elif direction == 'SELL' and f > 0 and top < current_price:
            dist = (current_price - top) / current_price * 100.0
            if 0.5 <= dist < min_fvg_dist:
                min_fvg_dist = dist
                opp_fvg = top

    opp_liq = None
    min_liq_dist = float('inf')
    for z in liq_zones:
        if z['start'] <= bar_idx <= z['end']:
            if z['swept'] is not None and z['swept'] <= bar_idx: continue
            if direction == 'BUY' and z['type'] == 'BSL' and z['level'] > current_price:
                dist = (z['level'] - current_price) / current_price * 100.0
                if 1.0 <= dist < min_liq_dist:
                    min_liq_dist = dist
                    opp_liq = z['level']
            elif direction == 'SELL' and z['type'] == 'SSL' and z['level'] < current_price:
                dist = (current_price - z['level']) / current_price * 100.0
                if 1.0 <= dist < min_liq_dist:
                    min_liq_dist = dist
                    opp_liq = z['level']

    return opp_fvg, opp_liq


def simulate_setup_execution(setup_name, trade_type, direction, sig_bar, entry_bar, exit_bar, sdata, liq_zones, danger_level):
    n = len(sdata['close'])
    market_open = float(sdata['open'][entry_bar])
    highs = sdata['high']
    lows  = sdata['low']
    opens = sdata['open']

    # 1. SETUP TIERS
    if trade_type == 'TREND':
        # Swing SL
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

        initial_sl = swing_sl
        pb_fvg = get_unmitigated_pullback_fvg(sig_bar, direction, market_open, sdata)

        if setup_name in ['A', 'C']:
            # Single Market Entry
            tiers = [{'weight': 1.0, 'price': market_open, 'is_limit': False, 'filled': True, 'fill_bar': entry_bar}]
        elif setup_name in ['B', 'D']:
            # Multi-Limit Grid: 50% Market + 50% Limit at FVG Mid (or 0.5% pullback)
            limit_p = pb_fvg['mid'] if pb_fvg else (market_open * 0.995 if direction == 'BUY' else market_open * 1.005)
            tiers = [
                {'weight': 0.50, 'price': market_open, 'is_limit': False, 'filled': True, 'fill_bar': entry_bar},
                {'weight': 0.50, 'price': limit_p, 'is_limit': True, 'filled': False, 'fill_bar': None},
            ]

    else:
        # FADE TRAP
        fade_target = danger_level if danger_level else market_open
        initial_sl = fade_target * (1 - FADE_HARD_SL_PCT/100.0) if direction == 'BUY' else fade_target * (1 + FADE_HARD_SL_PCT/100.0)

        if setup_name in ['A', 'C']:
            # Single Limit at Liq
            tiers = [{'weight': 1.0, 'price': fade_target, 'is_limit': True, 'filled': False, 'fill_bar': None}]
        elif setup_name in ['B', 'D']:
            # Multi-Limit Grid: 50% at Liq + 50% at Over-sweep (+0.5% deeper)
            p1 = fade_target
            p2 = fade_target * (0.995 if direction == 'BUY' else 1.005)
            tiers = [
                {'weight': 0.50, 'price': p1, 'is_limit': True, 'filled': False, 'fill_bar': None},
                {'weight': 0.50, 'price': p2, 'is_limit': True, 'filled': False, 'fill_bar': None},
            ]

    # Targets for Tiered TP
    opp_fvg, opp_liq = get_opposing_targets(sig_bar, direction, market_open, sdata, liq_zones)

    # 2. BAR BY BAR SIMULATION
    sim_end = min(exit_bar, n - 1)
    is_active = any(t['filled'] for t in tiers)
    tp1_hit = False
    cur_sl = initial_sl
    realized_pnl_pct = 0.0
    closed_weight = 0.0

    for bar_i in range(entry_bar, sim_end + 1):
        h = highs[bar_i]
        l = lows[bar_i]

        # Check pending limit fills
        for t in tiers:
            if not t['filled']:
                if bar_i <= entry_bar + MAX_WAIT_BARS:
                    if direction == 'BUY' and l <= t['price']:
                        t['filled'] = True
                        t['fill_bar'] = bar_i
                        is_active = True
                    elif direction == 'SELL' and h >= t['price']:
                        t['filled'] = True
                        t['fill_bar'] = bar_i
                        is_active = True

        if not is_active: continue

        filled_tiers = [t for t in tiers if t['filled']]
        active_weight = sum(t['weight'] for t in filled_tiers) - closed_weight
        if active_weight <= 0: break

        avg_entry = sum(t['weight'] * t['price'] for t in filled_tiers) / sum(t['weight'] for t in filled_tiers)

        # Check SL
        hit_sl = (direction == 'BUY' and l <= cur_sl) or (direction == 'SELL' and h >= cur_sl)
        if hit_sl:
            pnl = (cur_sl - avg_entry) / avg_entry * 100.0 if direction == 'BUY' else (avg_entry - cur_sl) / avg_entry * 100.0
            fee = (COMMISSION_TAKER * 2) * 100.0
            realized_pnl_pct += (pnl - fee) * active_weight
            closed_weight = sum(t['weight'] for t in filled_tiers)
            break

        # Check TP
        if setup_name in ['A', 'B']:
            # Fixed 2.0% TP
            target_tp = avg_entry * 1.02 if direction == 'BUY' else avg_entry * 0.98
            hit_tp = (direction == 'BUY' and h >= target_tp) or (direction == 'SELL' and l <= target_tp)
            if hit_tp:
                pnl = 2.0
                fee = (COMMISSION_TAKER + (COMMISSION_MAKER if any(t['is_limit'] for t in filled_tiers) else COMMISSION_TAKER)) * 100.0
                realized_pnl_pct += (pnl - fee) * active_weight
                closed_weight = sum(t['weight'] for t in filled_tiers)
                break

        elif setup_name in ['C', 'D']:
            # SMC Tiered TP: TP1 Opposing FVG, TP2 Opposing Liq + Breakeven
            target_tp1 = opp_fvg if opp_fvg else (avg_entry * 1.015 if direction == 'BUY' else avg_entry * 0.985)
            target_tp2 = opp_liq if opp_liq else (avg_entry * 1.030 if direction == 'BUY' else avg_entry * 0.970)

            if not tp1_hit:
                hit_tp1 = (direction == 'BUY' and h >= target_tp1) or (direction == 'SELL' and l <= target_tp1)
                if hit_tp1:
                    tp1_hit = True
                    pnl_tp1 = (target_tp1 - avg_entry) / avg_entry * 100.0 if direction == 'BUY' else (avg_entry - target_tp1) / avg_entry * 100.0
                    fee = (COMMISSION_TAKER * 2) * 100.0
                    part_w = active_weight * 0.50
                    realized_pnl_pct += (pnl_tp1 - fee) * part_w
                    closed_weight += part_w
                    # Move SL to Breakeven
                    cur_sl = avg_entry * (1.0005 if direction == 'BUY' else 0.9995)

            if tp1_hit:
                hit_tp2 = (direction == 'BUY' and h >= target_tp2) or (direction == 'SELL' and l <= target_tp2)
                if hit_tp2:
                    pnl_tp2 = (target_tp2 - avg_entry) / avg_entry * 100.0 if direction == 'BUY' else (avg_entry - target_tp2) / avg_entry * 100.0
                    fee = (COMMISSION_TAKER * 2) * 100.0
                    rem_w = sum(t['weight'] for t in filled_tiers) - closed_weight
                    realized_pnl_pct += (pnl_tp2 - fee) * rem_w
                    closed_weight = sum(t['weight'] for t in filled_tiers)
                    break

    # Close remaining at market if not closed
    filled_tiers = [t for t in tiers if t['filled']]
    if is_active and closed_weight < sum(t['weight'] for t in filled_tiers):
        rem_w = sum(t['weight'] for t in filled_tiers) - closed_weight
        avg_entry = sum(t['weight'] * t['price'] for t in filled_tiers) / sum(t['weight'] for t in filled_tiers)
        exit_p = opens[min(sim_end + 1, n - 1)]
        pnl = (exit_p - avg_entry) / avg_entry * 100.0 if direction == 'BUY' else (avg_entry - exit_p) / avg_entry * 100.0
        fee = (COMMISSION_TAKER * 2) * 100.0
        realized_pnl_pct += (pnl - fee) * rem_w

    if not is_active:
        return {'has_executed': False}

    return {
        'has_executed': True,
        'setup_name': setup_name,
        'trade_type': trade_type,
        'direction': direction,
        'filled_tiers': len(filled_tiers),
        'total_tiers': len(tiers),
        'realized_pnl_pct': round(realized_pnl_pct, 3),
        'is_win': realized_pnl_pct > 0
    }


def main():
    print("=" * 96)
    print("  MULTI-ENTRY & TIERED TP/SL INSIDE ENHANCED DUAL STRATEGY (1,000,000 BARS 5m)")
    print("=" * 96)

    analyzed_files = sorted(glob.glob(os.path.join(DATA_ANALISIC_5M, "*_analyzed_5m.csv")))
    setup_results = {'A': [], 'B': [], 'C': [], 'D': []}

    for f_idx, f in enumerate(analyzed_files, 1):
        sym = os.path.basename(f).replace("_analyzed_5m.csv", "")
        print(f"[{f_idx}/{len(analyzed_files)}] Backtesting {sym}...", end='\r')
        df = pd.read_csv(f)
        n = len(df)

        sdata = {
            'open': df['open'].values, 'high': df['high'].values, 'low': df['low'].values, 'close': df['close'].values,
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

        liq_zones = build_liq_zones(df)

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

            is_liq_danger, danger_dist, danger_level = check_danger_liq(sig_bar, direction, market_open, liq_zones)

            if not is_liq_danger:
                # TREND BRANCH
                if atr_pct < MIN_ATR_PCT: continue
                has_c_fvg, _ = check_counter_fvg(sig_bar, direction, market_open, sdata)
                if has_c_fvg: continue

                for s_key in ['A', 'B', 'C', 'D']:
                    res = simulate_setup_execution(s_key, 'TREND', direction, sig_bar, entry_bar, exit_bar, sdata, liq_zones, None)
                    if res['has_executed']:
                        res['symbol'] = sym
                        setup_results[s_key].append(res)
            else:
                # FADE TRAP BRANCH
                fade_dir = 'SELL' if direction == 'BUY' else 'BUY'
                for s_key in ['A', 'B', 'C', 'D']:
                    res = simulate_setup_execution(s_key, 'FADE', fade_dir, sig_bar, entry_bar, exit_bar, sdata, liq_zones, danger_level)
                    if res['has_executed']:
                        res['symbol'] = sym
                        setup_results[s_key].append(res)

    print(f"\nBacktest completed for all 4 Setups across 20 symbols.")

    # Summarize
    names = {
        'A': 'Setup A (Baseline: Single Market Trend + Single Limit Fade + Fixed 2% TP)',
        'B': 'Setup B (Multi-Entry Grid: 50% Market + 50% FVG Limit + Fixed 2% TP)',
        'C': 'Setup C (SMC Tiered TP: Single Entry + TP1 Opposing FVG + TP2 Opposing Liq + Breakeven)',
        'D': 'Setup D (Full SMC Master: Multi-Entry FVG/Liq Grid + Tiered TP1/TP2 + Breakeven)'
    }

    summary_rows = []
    for s_key in ['A', 'B', 'C', 'D']:
        trades = setup_results[s_key]
        df_s = pd.DataFrame(trades)
        tot_t = len(df_s)
        win_t = len(df_s[df_s['is_win']])
        wr = (win_t / tot_t * 100.0) if tot_t > 0 else 0.0
        tot_pnl = df_s['realized_pnl_pct'].sum()
        avg_pnl = df_s['realized_pnl_pct'].mean()
        
        gross_w = df_s[df_s['realized_pnl_pct'] > 0]['realized_pnl_pct'].sum()
        gross_l = abs(df_s[df_s['realized_pnl_pct'] <= 0]['realized_pnl_pct'].sum())
        pf = (gross_w / gross_l) if gross_l > 0 else 0.0

        summary_rows.append({
            'Setup': s_key,
            'Setup Description': names[s_key],
            'Total Trades': tot_t,
            'Win Rate %': round(wr, 2),
            'Profit Factor': round(pf, 2),
            'Total Net PnL %': round(tot_pnl, 1),
            'Avg PnL / Trade %': round(avg_pnl, 3),
        })

    sum_df = pd.DataFrame(summary_rows)
    sum_df.to_csv(os.path.join(ANALYSIS_DIR, "multi_entry_dual_strategy_comparison.csv"), index=False)

    print("\n" + "=" * 96)
    print("  FINAL MATRIX: MULTI-ENTRY & TIERED TP/SL IN ENHANCED DUAL STRATEGY")
    print("=" * 96)
    for r in summary_rows:
        print(f"\n  ► {r['Setup Description']}")
        print(f"    • Total Trades     : {r['Total Trades']:,} lệnh")
        print(f"    • Win Rate         : {r['Win Rate %']}%")
        print(f"    • Profit Factor    : {r['Profit Factor']}x")
        print(f"    • Tổng Lợi Nhuận   : {r['Total Net PnL %']:+,.1f}% (Kỳ vọng: {r['Avg PnL / Trade %']:+.3f}% / lệnh)")
    print("\n" + "=" * 96 + "\n")


if __name__ == "__main__":
    main()
