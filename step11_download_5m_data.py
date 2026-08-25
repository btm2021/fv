"""
Step 11: Download 50,000 5m Candles for 20 Symbols (10 High Vol + 10 Mid Vol)
================================================================================
Fetches 50,000 5-minute candles per symbol directly from Binance Futures REST API.
50,000 bars on 5m = ~173 days of continuous price data.

Output:
  data_raw_5m/<SYMBOL>_5m.csv
"""

import os, sys, time, json, urllib.request
import pandas as pd
from datetime import datetime, timezone

if sys.stdout.encoding != 'utf-8':
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
DATA_RAW_5M_DIR = os.path.join(BASE_DIR, "data_raw_5m")
os.makedirs(DATA_RAW_5M_DIR, exist_ok=True)

TARGET_CANDLES = 50000
CHUNK_LIMIT    = 1500
TIMEFRAME      = "5m"

# 10 High Volume + 10 Mid Volume
HIGH_VOL_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT",
    "XRPUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "NEARUSDT"
]

MID_VOL_SYMBOLS = [
    "ARBUSDT", "OPUSDT", "APTUSDT", "TIAUSDT", "INJUSDT",
    "RENDERUSDT", "FETUSDT", "SEIUSDT", "FILUSDT", "ATOMUSDT"
]

ALL_20_SYMBOLS = HIGH_VOL_SYMBOLS + MID_VOL_SYMBOLS


def fetch_klines_chunk(symbol, interval="5m", limit=1500, end_time=None):
    url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval={interval}&limit={limit}"
    if end_time:
        url += f"&endTime={end_time}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))


def download_symbol_5m(symbol, target_count=50000):
    out_path = os.path.join(DATA_RAW_5M_DIR, f"{symbol}_5m.csv")
    if os.path.exists(out_path):
        existing_df = pd.read_csv(out_path)
        if len(existing_df) >= target_count - 100:
            print(f"  [CACHE] {symbol}: Already downloaded ({len(existing_df)} rows). Skipping.")
            return existing_df

    print(f"\n[DOWNLOAD] {symbol} (5m, Target: {target_count:,} candles)...")
    all_candles = []
    end_time = None
    fetched = 0

    while fetched < target_count:
        try:
            raw = fetch_klines_chunk(symbol, interval=TIMEFRAME, limit=CHUNK_LIMIT, end_time=end_time)
            if not raw or len(raw) == 0:
                break

            parsed = []
            for k in raw:
                parsed.append({
                    'timestamp': int(k[0]),
                    'open': float(k[1]),
                    'high': float(k[2]),
                    'low': float(k[3]),
                    'close': float(k[4]),
                    'volume': float(k[5]),
                    'datetime': datetime.fromtimestamp(int(k[0]) / 1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
                })

            parsed.sort(key=lambda x: x['timestamp'])
            all_candles = parsed + all_candles
            fetched = len(all_candles)
            earliest_ts = all_candles[0]['timestamp']
            end_time = earliest_ts - 1

            earliest_dt = all_candles[0]['datetime']
            print(f"  -> Fetched {fetched:,} / {target_count:,} | Earliest: {earliest_dt}", end='\r')

            if len(raw) < CHUNK_LIMIT:
                break

            time.sleep(0.08) # Rate limit safety
        except Exception as e:
            print(f"\n  [WARN] Error fetching {symbol}: {e}. Retrying in 1s...")
            time.sleep(1)

    # Deduplicate and sort
    df = pd.DataFrame(all_candles).drop_duplicates(subset=['timestamp']).sort_values('timestamp').reset_index(drop=True)
    if len(df) > target_count:
        df = df.iloc[-target_count:].reset_index(drop=True)

    df.to_csv(out_path, index=False)
    print(f"\n  [SAVED] {symbol}: {len(df):,} candles saved to {out_path}")
    return df


def main():
    print("=" * 80)
    print(f"  DOWNLOADING 5m CANDLES (Target: {TARGET_CANDLES:,} bars x 20 Symbols = 1,000,000 bars)")
    print("=" * 80)
    print(f"  10 High Volume: {', '.join(HIGH_VOL_SYMBOLS)}")
    print(f"  10 Mid Volume : {', '.join(MID_VOL_SYMBOLS)}\n")

    start_t = time.time()
    for idx, sym in enumerate(ALL_20_SYMBOLS, 1):
        print(f"[{idx}/{len(ALL_20_SYMBOLS)}]", end=' ')
        download_symbol_5m(sym, target_count=TARGET_CANDLES)

    total_t = time.time() - start_t
    print(f"\n================================================================================")
    print(f"  COMPLETED: 20 symbols downloaded in {total_t:.1f}s")
    print(f"  Data folder: {DATA_RAW_5M_DIR}")
    print(f"================================================================================\n")


if __name__ == "__main__":
    main()
