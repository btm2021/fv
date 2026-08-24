import requests
import time
import pandas as pd
from smartmoneyconcepts import smc

symbol = 'BTCUSDT'
interval = '15m'
total_needed = 10000
limit = 1500
end_time = None
all_klines = []

print('Fetching 10,000 candles from Binance Futures...')
while len(all_klines) < total_needed:
    fetch_count = min(limit, total_needed - len(all_klines))
    params = {'symbol': symbol, 'interval': interval, 'limit': fetch_count}
    if end_time:
        params['endTime'] = end_time
    r = requests.get('https://fapi.binance.com/fapi/v1/klines', params=params, timeout=10)
    data = r.json()
    if not data or not isinstance(data, list):
        break
    all_klines = data + all_klines
    end_time = data[0][0] - 1
    print(f'Fetched {len(all_klines)} candles...')
    if len(data) < fetch_count:
        break
    time.sleep(0.1)

klines_dict = {k[0]: k for k in all_klines}
sorted_klines = [klines_dict[k] for k in sorted(klines_dict.keys())][-10000:]
print(f'Total final candles: {len(sorted_klines)}')

df = pd.DataFrame(sorted_klines, columns=[
    'time', 'open', 'high', 'low', 'close', 'volume',
    'close_time', 'quote_vol', 'trades', 'tb_base_vol', 'tb_quote_vol', 'ignore'
])

df['open'] = df['open'].astype(float)
df['high'] = df['high'].astype(float)
df['low'] = df['low'].astype(float)
df['close'] = df['close'].astype(float)
df['volume'] = df['volume'].astype(float)
df['datetime'] = pd.to_datetime(df['time'], unit='ms')

print('Calculating SMC indicators using joshyattridge/smart-money-concepts...')
t0 = time.time()

# 1. FVG
fvg_df = smc.fvg(df)
print(f"FVG done ({len(fvg_df.dropna(subset=['FVG']))} FVGs) in {time.time()-t0:.3f}s")
print("FVG sample:\n", fvg_df.dropna(subset=['FVG']).head(3))

# 2. Swing Highs/Lows
t1 = time.time()
swing_df = smc.swing_highs_lows(df, swing_length=20)
print(f"Swings done ({len(swing_df.dropna(subset=['HighLow']))} swings) in {time.time()-t1:.3f}s")
print("Swing sample:\n", swing_df.dropna(subset=['HighLow']).head(3))

# 3. BOS & CHoCH
t2 = time.time()
bos_df = smc.bos_choch(df, swing_df)
print(f"BOS/CHOCH done: BOS={len(bos_df.dropna(subset=['BOS']))}, CHOCH={len(bos_df.dropna(subset=['CHOCH']))} in {time.time()-t2:.3f}s")
print("BOS/CHOCH sample:\n", bos_df.dropna(subset=['BOS', 'CHOCH'], how='all').head(3))

# 4. Order Blocks (OB)
t3 = time.time()
ob_df = smc.ob(df, swing_df)
print(f"OB done ({len(ob_df.dropna(subset=['OB']))} OBs) in {time.time()-t3:.3f}s")
print("OB sample:\n", ob_df.dropna(subset=['OB']).head(3))

# 5. Liquidity
t4 = time.time()
liq_df = smc.liquidity(df, swing_df)
print(f"Liquidity done ({len(liq_df.dropna(subset=['Liquidity']))} levels) in {time.time()-t4:.3f}s")
print("Liquidity sample:\n", liq_df.dropna(subset=['Liquidity']).head(3))
