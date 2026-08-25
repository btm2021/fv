"""
Step 1: Download 30,000 Candles from Binance Futures
Downloads historical kline data for 10 major symbols and saves to data_raw/<symbol>.csv
"""

import os
import sys
import time
import requests
import pandas as pd
from datetime import datetime, timezone

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# 10 Major Binance Futures Symbols
DEFAULT_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "BNBUSDT",
    "DOGEUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "NEARUSDT"
]

TIMEFRAME = "15m"
TOTAL_CANDLES = 30000
DATA_RAW_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_raw")


def fetch_binance_klines(symbol: str, interval: str = "15m", total_candles: int = 30000) -> pd.DataFrame:
    """
    Fetch historical candles from Binance Futures API chunked by 1500 bars
    """
    print(f"\n[DOWNLOAD] Fetching {total_candles:,} candles for {symbol} ({interval})...")
    url = "https://fapi.binance.com/fapi/v1/klines"
    limit = 1500
    all_klines = []
    end_time = None
    retries = 0

    while len(all_klines) < total_candles:
        fetch_count = min(limit, total_candles - len(all_klines))
        params = {
            "symbol": symbol,
            "interval": interval,
            "limit": fetch_count
        }
        if end_time:
            params["endTime"] = end_time

        try:
            r = requests.get(url, params=params, timeout=20)
            if r.status_code == 200:
                data = r.json()
                if not data or not isinstance(data, list) or len(data) == 0:
                    print(f"  No more data returned for {symbol}. Total: {len(all_klines)}")
                    break

                all_klines = data + all_klines
                end_time = data[0][0] - 1
                retries = 0
                pct = (len(all_klines) / total_candles) * 100
                print(f"  [{symbol}] Retrieved {len(all_klines):,} / {total_candles:,} bars ({pct:.1f}%)...")

                if len(data) < fetch_count:
                    print(f"  Reached start of market history for {symbol}.")
                    break

                time.sleep(0.06)
            elif r.status_code == 429:
                print("  Rate limited (429)! Backing off for 2 seconds...")
                time.sleep(2.0)
            else:
                print(f"  HTTP error {r.status_code}: {r.text}")
                retries += 1
                if retries > 3:
                    break
                time.sleep(1.0)
        except Exception as e:
            print(f"  Connection error: {e}")
            retries += 1
            if retries > 3:
                break
            time.sleep(1.0)

    # Deduplicate by open timestamp and sort ascending
    klines_dict = {k[0]: k for k in all_klines}
    sorted_klines = [klines_dict[k] for k in sorted(klines_dict.keys())][-total_candles:]

    df = pd.DataFrame(sorted_klines, columns=[
        'timestamp', 'open', 'high', 'low', 'close', 'volume',
        'close_time', 'quote_vol', 'trades', 'tb_base_vol', 'tb_quote_vol', 'ignore'
    ])

    # Convert numeric fields
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = df[col].astype(float)

    df['timestamp'] = df['timestamp'].astype(int)
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True).dt.strftime('%Y-%m-%d %H:%M:%S')

    # Select standard clean columns
    clean_df = df[['timestamp', 'open', 'high', 'low', 'close', 'volume', 'datetime']].copy()
    return clean_df


def download_all_symbols(symbols=None, interval="15m", total_candles=30000):
    if symbols is None:
        symbols = DEFAULT_SYMBOLS

    os.makedirs(DATA_RAW_DIR, exist_ok=True)
    print(f"================================================================")
    print(f" Binance Futures Data Downloader - 30,000 Candles x 10 Symbols")
    print(f" Target Directory: {DATA_RAW_DIR}")
    print(f" Timeframe: {interval}")
    print(f"================================================================")

    start_total = time.time()
    downloaded_files = []

    for idx, sym in enumerate(symbols, 1):
        print(f"\n({idx}/{len(symbols)}) Processing {sym}...")
        df = fetch_binance_klines(sym, interval=interval, total_candles=total_candles)
        
        file_path = os.path.join(DATA_RAW_DIR, f"{sym}.csv")
        df.to_csv(file_path, index=False)
        downloaded_files.append((sym, len(df), file_path))
        print(f"  -> Saved {len(df):,} candles to {file_path}")

    elapsed = time.time() - start_total
    print(f"\n================================================================")
    print(f" Download Completed in {elapsed:.2f}s!")
    print(f" Summary of Downloaded Files:")
    for sym, count, path in downloaded_files:
        print(f"   - {sym:10s}: {count:6,} bars -> {path}")
    print(f"================================================================")
    return downloaded_files


if __name__ == "__main__":
    download_all_symbols()
