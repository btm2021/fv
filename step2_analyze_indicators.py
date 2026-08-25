"""
Step 2: Calculate SMC, ATRBot, and VSR Indicators
Reads raw candles from data_raw/<symbol>.csv, computes:
1. Official smartmoneyconcepts (FVG, Swings, BOS/CHOCH, OB, Liquidity)
2. ATRBot (VIDYA 14, Period 21, Multiplier 2.0, ATR 14)
3. VSR (Volume Spike Reversal, Period 10, Threshold 10.0)
Saves results into data_analisic/<symbol>_analyzed.csv
"""

import os
import sys
import time
import glob
import pandas as pd

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from smartmoneyconcepts import smc
from atrbot import calculate_atr_bot_df
from vsr import calculate_vsr_df

DATA_RAW_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_raw")
DATA_ANALISIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_analisic")


def analyze_symbol(file_path: str) -> str:
    """
    Load raw CSV, calculate all indicators, save analyzed CSV
    """
    sym = os.path.splitext(os.path.basename(file_path))[0]
    print(f"\n[ANALYZE] Processing {sym} from {file_path}...")
    t0 = time.time()

    df = pd.read_csv(file_path)
    if 'timestamp' not in df.columns or 'open' not in df.columns:
        raise ValueError(f"Invalid columns in {file_path}")

    n = len(df)
    print(f"  Loaded {n:,} candles.")

    # 1. SMC Calculations
    print("  -> Calculating Smart Money Concepts (FVG, Swings, BOS/CHOCH, OB, Liquidity)...")
    t_smc = time.time()
    
    fvg_df = smc.fvg(df, join_consecutive=False)
    # Rename columns to prevent collisions
    fvg_df = fvg_df.rename(columns={
        'FVG': 'smc_fvg',
        'Top': 'smc_fvg_top',
        'Bottom': 'smc_fvg_bottom',
        'MitigatedIndex': 'smc_fvg_mitigated_index'
    })

    swings_df = smc.swing_highs_lows(df, swing_length=20)
    swings_df = swings_df.rename(columns={
        'HighLow': 'smc_swing_hl',
        'Level': 'smc_swing_level'
    })

    # Prepare base swings for downstream BOS/OB/Liquidity
    base_swings = smc.swing_highs_lows(df, swing_length=20)

    bos_df = smc.bos_choch(df, base_swings)
    bos_df = bos_df.rename(columns={
        'BOS': 'smc_bos',
        'CHOCH': 'smc_choch',
        'Level': 'smc_bos_level',
        'BrokenIndex': 'smc_bos_broken_index'
    })

    ob_df = smc.ob(df, base_swings)
    ob_df = ob_df.rename(columns={
        'OB': 'smc_ob',
        'Top': 'smc_ob_top',
        'Bottom': 'smc_ob_bottom',
        'OBVolume': 'smc_ob_volume',
        'Percentage': 'smc_ob_pct',
        'MitigatedIndex': 'smc_ob_mitigated_index'
    })

    liq_df = smc.liquidity(df, base_swings)
    liq_df = liq_df.rename(columns={
        'Liquidity': 'smc_liquidity',
        'Level': 'smc_liq_level',
        'End': 'smc_liq_end_index',
        'Swept': 'smc_liq_swept_index'
    })
    print(f"     SMC completed in {time.time() - t_smc:.2f}s")

    # 2. ATRBot (VIDYA 14, Period 21, Multiplier 2.0)
    print("  -> Calculating ATRBot (VIDYA 14, Period 21, Multiplier 2.0)...")
    t_atr = time.time()
    atr_df = calculate_atr_bot_df(
        df,
        cmo_length=14,
        ma_length=21,
        atr_length=14,
        atr_mult=2.0,
        ma_type="VIDYA",
        source="close"
    )
    print(f"     ATRBot completed in {time.time() - t_atr:.2f}s")

    # 3. VSR (Volume Spike Reversal, Period 10, Threshold 10.0)
    print("  -> Calculating VSR (Volume Spike Reversal 10 / 10.0)...")
    t_vsr = time.time()
    vsr_df = calculate_vsr_df(
        df,
        length=10,
        threshold=10.0
    )
    print(f"     VSR completed in {time.time() - t_vsr:.2f}s")

    # Merge all into single DataFrame
    analyzed_df = pd.concat([
        df,
        fvg_df,
        swings_df,
        bos_df,
        ob_df,
        liq_df,
        atr_df,
        vsr_df
    ], axis=1)

    os.makedirs(DATA_ANALISIC_DIR, exist_ok=True)
    out_file = os.path.join(DATA_ANALISIC_DIR, f"{sym}_analyzed.csv")
    analyzed_df.to_csv(out_file, index=False)

    elapsed = time.time() - t0
    print(f"  -> Successfully saved {len(analyzed_df):,} rows with {len(analyzed_df.columns)} columns to {out_file} ({elapsed:.2f}s)")
    return out_file


def analyze_all():
    os.makedirs(DATA_ANALISIC_DIR, exist_ok=True)
    raw_files = sorted(glob.glob(os.path.join(DATA_RAW_DIR, "*.csv")))
    if not raw_files:
        print(f"No raw files found in {DATA_RAW_DIR}. Run step1_download_data.py first!")
        return []

    print(f"================================================================")
    print(f" Indicator Analysis Engine (SMC + ATRBot + VSR)")
    print(f" Input Directory : {DATA_RAW_DIR}")
    print(f" Output Directory: {DATA_ANALISIC_DIR}")
    print(f" Total Symbols   : {len(raw_files)}")
    print(f"================================================================")

    t_start = time.time()
    results = []
    for idx, f in enumerate(raw_files, 1):
        print(f"\n[{idx}/{len(raw_files)}]")
        out_f = analyze_symbol(f)
        results.append(out_f)

    print(f"\n================================================================")
    print(f" All {len(results)} symbols analyzed successfully in {time.time() - t_start:.2f}s!")
    print(f" Output files saved to: {DATA_ANALISIC_DIR}")
    print(f"================================================================")
    return results


if __name__ == "__main__":
    analyze_all()
