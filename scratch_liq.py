import pandas as pd
import numpy as np

adf = pd.read_csv('data_analisic/BTCUSDT_analyzed.csv').reset_index(drop=True)
edf = pd.read_csv('entry/BTCUSDT_entry.csv')

print('=== Understanding Liq Zone Logic ===')
liq_rows = adf[adf['smc_liquidity'].notna() & (adf['smc_liquidity'] != 0)].copy()
liq_rows['swept'] = liq_rows['smc_liq_swept_index'] > 0
print(f"Total Liq zones BTCUSDT: {len(liq_rows)}")
print(f"Swept: {liq_rows['swept'].sum()} | Unswept: {(~liq_rows['swept']).sum()}")
print()

# Build liq zone list once for efficiency
def build_liq_zone_list(adf):
    zones = []
    for i, row in adf.iterrows():
        liq = row['smc_liquidity']
        if pd.isna(liq) or liq == 0:
            continue
        liq_end = int(row['smc_liq_end_index']) if pd.notna(row['smc_liq_end_index']) else 99999
        swept = int(row['smc_liq_swept_index']) if (pd.notna(row['smc_liq_swept_index']) and row['smc_liq_swept_index'] > 0) else None
        zones.append({
            'start': i,
            'end': liq_end,
            'swept': swept,
            'type': 'BSL' if liq > 0 else 'SSL',
            'level': float(row['smc_liq_level']) if pd.notna(row['smc_liq_level']) else None
        })
    return zones

all_zones = build_liq_zone_list(adf)

def get_active_liq_at_bar(bar_idx, all_zones):
    result = []
    for z in all_zones:
        if z['start'] <= bar_idx <= z['end']:
            if z['swept'] is None or z['swept'] > bar_idx:
                result.append(z)
    return result

for _, trade in edf.head(10).iterrows():
    sig = int(trade['signal_index'])
    close = float(adf.iloc[sig]['close'])
    zones = get_active_liq_at_bar(sig, all_zones)
    bsl = [z for z in zones if z['type'] == 'BSL']
    ssl = [z for z in zones if z['type'] == 'SSL']
    label = trade['label']
    direction = trade['direction']
    print(f"  [{label.upper():4}] {direction:4} @ idx={sig} close={close:.1f} | Active BSL={len(bsl)} SSL={len(ssl)} zones")
    for z in zones:
        dist = (z['level'] - close) / close * 100 if z['level'] else 0
        print(f"           {z['type']} level={z['level']:.1f} dist={dist:+.2f}%")
