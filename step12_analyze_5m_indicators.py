"""
Step 12: Analyze SMC, ATRBot, and VSR Indicators for 5m 50k Datasets (20 Symbols)
==================================================================================
Reads 50,000 5m candles from data_raw_5m/<symbol>_5m.csv and computes:
- SMC: FVG, Swing Highs/Lows (20), BOS/CHoCH, Order Blocks, Liquidity
- ATRBot: VIDYA (CMO 14, MA 21, ATR 14, Mult 2.0)
- VSR: Volume Spike Reversal (10, 10.0)

Saves results to: data_analisic_5m/<symbol>_analyzed_5m.csv
"""

import os, sys, time, glob
import pandas as pd

if sys.stdout.encoding != 'utf-8':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

from smartmoneyconcepts import smc
from atrbot import calculate_atr_bot_df
from vsr import calculate_vsr_df

BASE_DIR          = os.path.dirname(os.path.abspath(__file__))
DATA_RAW_5M_DIR   = os.path.join(BASE_DIR, "data_raw_5m")
DATA_ANALISIC_5M  = os.path.join(BASE_DIR, "data_analisic_5m")
os.makedirs(DATA_ANALISIC_5M, exist_ok=True)


def analyze_symbol_5m(file_path):
    sym = os.path.basename(file_path).replace("_5m.csv", "")
    out_path = os.path.join(DATA_ANALISIC_5M, f"{sym}_analyzed_5m.csv")
    if os.path.exists(out_path):
        existing_df = pd.read_csv(out_path)
        if len(existing_df) >= 49000:
            print(f"  [CACHE] {sym}: Already analyzed ({len(existing_df)} rows). Skipping.")
            return out_path

    print(f"\n[ANALYZE 5m] Processing {sym} ({file_path})...")
    t0 = time.time()
    df = pd.read_csv(file_path)
    n = len(df)
    print(f"  Loaded {n:,} bars of 5m data.")

    # 1. SMC Calculations
    t_smc = time.time()
    fvg_df = smc.fvg(df, join_consecutive=False).rename(columns={
        'FVG': 'smc_fvg', 'Top': 'smc_fvg_top', 'Bottom': 'smc_fvg_bottom', 'MitigatedIndex': 'smc_fvg_mitigated_index'
    })

    swings_df = smc.swing_highs_lows(df, swing_length=20).rename(columns={
        'HighLow': 'smc_swing_hl', 'Level': 'smc_swing_level'
    })

    base_swings = smc.swing_highs_lows(df, swing_length=20)
    bos_df = smc.bos_choch(df, base_swings).rename(columns={
        'BOS': 'smc_bos', 'CHOCH': 'smc_choch', 'Level': 'smc_bos_level', 'BrokenIndex': 'smc_bos_broken_index'
    })

    ob_df = smc.ob(df, base_swings).rename(columns={
        'OB': 'smc_ob', 'Top': 'smc_ob_top', 'Bottom': 'smc_ob_bottom',
        'OBVolume': 'smc_ob_volume', 'Percentage': 'smc_ob_pct', 'MitigatedIndex': 'smc_ob_mitigated_index'
    })

    liq_df = smc.liquidity(df, base_swings).rename(columns={
        'Liquidity': 'smc_liquidity', 'Level': 'smc_liq_level', 'End': 'smc_liq_end_index', 'Swept': 'smc_liq_swept_index'
    })
    print(f"  -> SMC completed in {time.time() - t_smc:.1f}s")

    # 2. ATRBot (VIDYA 14, MA 21, ATR 14, Mult 2.0)
    t_atr = time.time()
    atr_df = calculate_atr_bot_df(df, cmo_length=14, ma_length=21, atr_length=14, atr_mult=2.0, source='close').rename(columns={
        'trail1': 'atrbot_trail1', 'trail2': 'atrbot_trail2', 'trend': 'atrbot_trend',
        'buy': 'atrbot_buy', 'sell': 'atrbot_sell', 'atr': 'atrbot_atr'
    })
    print(f"  -> ATRBot completed in {time.time() - t_atr:.1f}s")

    # 3. VSR
    t_vsr = time.time()
    vsr_df = calculate_vsr_df(df, length=10, threshold=10.0).rename(columns={
        'upper': 'vsr_upper', 'lower': 'vsr_lower', 'signal': 'vsr_signal', 'spike': 'vsr_spike'
    })
    print(f"  -> VSR completed in {time.time() - t_vsr:.1f}s")

    # 4. Merge all into 1 unified DataFrame
    final_df = pd.concat([df, fvg_df, swings_df, bos_df, ob_df, liq_df, atr_df, vsr_df], axis=1)
    final_df.to_csv(out_path, index=False)
    print(f"  [SAVED] {sym}: {len(final_df):,} rows x {len(final_df.columns)} cols ({time.time() - t0:.1f}s total)")
    return out_path


def main():
    print("=" * 80)
    print("  COMPUTING 5m INDICATORS (SMC + ATRBot + VSR) FOR ALL 20 SYMBOLS")
    print("=" * 80)
    files = sorted(glob.glob(os.path.join(DATA_RAW_5M_DIR, "*_5m.csv")))
    if not files:
        print("  No 5m raw files found. Run step11_download_5m_data.py first!")
        return

    print(f"  Found {len(files)} symbol raw files.\n")
    for idx, f in enumerate(files, 1):
        print(f"[{idx}/{len(files)}]", end=' ')
        analyze_symbol_5m(f)

    print(f"\nAll 5m indicator datasets generated in {DATA_ANALISIC_5M}\n")


if __name__ == "__main__":
    main()
