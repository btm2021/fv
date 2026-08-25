"""
Full Pipeline Runner:
1. Download 30,000 bars for 10 Binance symbols -> data_raw/
2. Compute SMC + ATRBot + VSR indicators -> data_analisic/
3. Evaluate entries, calculate ROE, drawdown, and win/lose labels -> entry/
"""

import sys
import time

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from step1_download_data import download_all_symbols
from step2_analyze_indicators import analyze_all
from step3_evaluate_entries import evaluate_all


def main():
    t_start = time.time()
    print("=================================================================")
    print(" STARTING COMPLETE DATA, SMC/ATRBOT ANALYSIS & BACKTEST PIPELINE ")
    print("=================================================================")

    # Step 1: Download 30,000 candles for 10 symbols
    print("\n>>> STEP 1: DOWNLOADING DATA FROM BINANCE FUTURES (30,000 BARS x 10 SYMBOLS)...")
    download_all_symbols()

    # Step 2: Calculate SMC + ATRBot + VSR Indicators
    print("\n>>> STEP 2: CALCULATING SMC, ATRBOT & VSR INDICATORS...")
    analyze_all()

    # Step 3: Evaluate Entries & Calculate Win/Loss labels
    print("\n>>> STEP 3: EVALUATING ENTRIES, MAX ROE, MAX DRAWDOWN & WIN/LOSS...")
    evaluate_all()

    total_time = time.time() - t_start
    print(f"\n[DONE] Full pipeline finished successfully in {total_time:.2f}s!")


if __name__ == "__main__":
    main()
