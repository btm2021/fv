"""
SMC & ATRBot Data Generator
Uses:
- Official Python library 'smartmoneyconcepts' (https://github.com/joshyattridge/smart-money-concepts)
- ATRBot Engine (VIDYA 14, Period 21, Multiplier 2.0)
Fetches 10,000 candles of BTCUSDT 15m from Binance Futures API and calculates:
- FVG (Fair Value Gaps)
- Swing Highs & Lows
- BOS & CHoCH (Break of Structure / Change of Character)
- Order Blocks (OB)
- Liquidity Levels
- ATRBot (Trail1, Trail2, Ribbon, Buy/Sell Signals)
Outputs smc_data.json and smc_data.js for standalone visualization in smctest.html
"""

import os
import sys
import json
import time
import requests
import pandas as pd
from smartmoneyconcepts import smc
from atrbot import calculate_atr_bot

def fetch_binance_futures_klines(symbol="BTCUSDT", interval="15m", total_candles=10000):
    print(f"Fetching {total_candles} candles for {symbol} ({interval}) from Binance Futures...")
    url = "https://fapi.binance.com/fapi/v1/klines"
    limit = 1500
    all_klines = []
    end_time = None
    
    while len(all_klines) < total_candles:
        fetch_count = min(limit, total_candles - len(all_klines))
        params = {"symbol": symbol, "interval": interval, "limit": fetch_count}
        if end_time:
            params["endTime"] = end_time
            
        r = requests.get(url, params=params, timeout=15)
        if r.status_code != 200:
            print(f"Error fetching klines: {r.status_code} {r.text}")
            break
            
        data = r.json()
        if not data or not isinstance(data, list) or len(data) == 0:
            break
            
        all_klines = data + all_klines
        end_time = data[0][0] - 1
        print(f"  Downloaded {len(all_klines)} / {total_candles} candles...")
        
        if len(data) < fetch_count:
            break
        time.sleep(0.08)
        
    klines_dict = {k[0]: k for k in all_klines}
    sorted_klines = [klines_dict[k] for k in sorted(klines_dict.keys())][-total_candles:]
    print(f"Successfully retrieved {len(sorted_klines)} candles.")
    return sorted_klines

def calculate_all(klines, swing_length=20, vidya_cmo=14, vidya_period=21, atr_multi=2.0):
    df = pd.DataFrame(klines, columns=[
        'time', 'open', 'high', 'low', 'close', 'volume',
        'close_time', 'quote_vol', 'trades', 'tb_base_vol', 'tb_quote_vol', 'ignore'
    ])
    
    df['open'] = df['open'].astype(float)
    df['high'] = df['high'].astype(float)
    df['low'] = df['low'].astype(float)
    df['close'] = df['close'].astype(float)
    df['volume'] = df['volume'].astype(float)
    
    # Lightweight Charts uses seconds for timestamp
    times_sec = (df['time'] // 1000).tolist()
    n = len(df)
    
    print("Calculating SMC indicators with 'smartmoneyconcepts' package...")
    t0 = time.time()
    
    # 1. FVG
    fvg_df = smc.fvg(df, join_consecutive=False)
    
    # 2. Swing Highs & Lows
    swing_df = smc.swing_highs_lows(df, swing_length=swing_length)
    
    # 3. BOS & CHoCH
    bos_df = smc.bos_choch(df, swing_df)
    
    # 4. Order Blocks (OB)
    ob_df = smc.ob(df, swing_df)
    
    # 5. Liquidity
    liq_df = smc.liquidity(df, swing_df)
    
    print(f"SMC calculation completed in {time.time() - t0:.3f}s")

    # 6. ATRBot (VIDYA 14, Period 21, Multiplier 2.0)
    print("Calculating ATRBot indicator (VIDYA 14, Period 21, Multiplier 2.0)...")
    t1 = time.time()
    atr_data = calculate_atr_bot(
        df,
        cmo_length=vidya_cmo,
        ma_length=vidya_period,
        atr_length=14,
        atr_mult=atr_multi,
        ma_type="VIDYA",
        source="close"
    )
    print(f"ATRBot calculation completed in {time.time() - t1:.3f}s")
    
    # Process Candles for Lightweight Charts
    candles = []
    volume_data = []
    for i in range(n):
        t = times_sec[i]
        o = float(df['open'].iloc[i])
        h = float(df['high'].iloc[i])
        l = float(df['low'].iloc[i])
        c = float(df['close'].iloc[i])
        v = float(df['volume'].iloc[i])
        candles.append({'time': t, 'open': o, 'high': h, 'low': l, 'close': c})
        volume_data.append({
            'time': t,
            'value': v,
            'color': 'rgba(34, 197, 94, 0.45)' if c >= o else 'rgba(239, 68, 68, 0.45)'
        })
        
    # Process FVG
    fvg_list = []
    for i in range(n):
        fvg_val = fvg_df['FVG'].iloc[i]
        if pd.notna(fvg_val) and fvg_val != 0:
            top = float(fvg_df['Top'].iloc[i])
            bottom = float(fvg_df['Bottom'].iloc[i])
            mit_idx = fvg_df['MitigatedIndex'].iloc[i]
            mitigated = False
            mit_time = None
            if pd.notna(mit_idx) and mit_idx > 0 and int(mit_idx) < n:
                mitigated = True
                mit_time = times_sec[int(mit_idx)]
                
            fvg_list.append({
                'index': i,
                'time': times_sec[i],
                'type': 1 if fvg_val > 0 else -1, # 1: Bullish, -1: Bearish
                'top': round(top, 2),
                'bottom': round(bottom, 2),
                'gapSize': round(abs(top - bottom), 2),
                'gapPct': round(abs(top - bottom) / bottom * 100, 3) if bottom > 0 else 0,
                'mitigated': mitigated,
                'mitigatedIndex': int(mit_idx) if pd.notna(mit_idx) and mit_idx > 0 else None,
                'mitigatedTime': mit_time
            })
            
    # Process Swing Highs & Lows (detect HH, HL, LH, LL)
    swings_list = []
    last_high = None
    last_low = None
    for i in range(n):
        hl = swing_df['HighLow'].iloc[i]
        if pd.notna(hl) and hl != 0:
            lvl = float(swing_df['Level'].iloc[i])
            tag = "H" if hl > 0 else "L"
            if hl > 0:
                if last_high is not None:
                    tag = "HH" if lvl > last_high else "LH"
                last_high = lvl
            else:
                if last_low is not None:
                    tag = "HL" if lvl > last_low else "LL"
                last_low = lvl
                
            swings_list.append({
                'index': i,
                'time': times_sec[i],
                'type': 1 if hl > 0 else -1, # 1: High, -1: Low
                'tag': tag,
                'level': round(lvl, 2)
            })
            
    # Process BOS & CHoCH
    bos_choch_list = []
    for i in range(n):
        bos_val = bos_df['BOS'].iloc[i] if 'BOS' in bos_df.columns else None
        choch_val = bos_df['CHOCH'].iloc[i] if 'CHOCH' in bos_df.columns else None
        level = bos_df['Level'].iloc[i]
        broken_idx = bos_df['BrokenIndex'].iloc[i]
        
        has_bos = pd.notna(bos_val) and bos_val != 0
        has_choch = pd.notna(choch_val) and choch_val != 0
        
        if (has_bos or has_choch) and pd.notna(level) and pd.notna(broken_idx):
            b_idx = int(broken_idx)
            bos_choch_list.append({
                'originIndex': i,
                'originTime': times_sec[i],
                'brokenIndex': b_idx,
                'brokenTime': times_sec[b_idx] if b_idx < n else times_sec[-1],
                'level': round(float(level), 2),
                'isBOS': bool(has_bos),
                'isCHOCH': bool(has_choch),
                'direction': int(bos_val if has_bos else choch_val) # 1: Bullish Break, -1: Bearish Break
            })
            
    # Process Order Blocks (OB)
    ob_list = []
    for i in range(n):
        ob_val = ob_df['OB'].iloc[i]
        if pd.notna(ob_val) and ob_val != 0:
            top = float(ob_df['Top'].iloc[i])
            bottom = float(ob_df['Bottom'].iloc[i])
            ob_vol = float(ob_df['OBVolume'].iloc[i]) if 'OBVolume' in ob_df.columns and pd.notna(ob_df['OBVolume'].iloc[i]) else 0
            pct = float(ob_df['Percentage'].iloc[i]) if 'Percentage' in ob_df.columns and pd.notna(ob_df['Percentage'].iloc[i]) else 0
            mit_idx = ob_df['MitigatedIndex'].iloc[i] if 'MitigatedIndex' in ob_df.columns else None
            
            mitigated = False
            mit_time = None
            if pd.notna(mit_idx) and mit_idx > 0 and int(mit_idx) < n:
                mitigated = True
                mit_time = times_sec[int(mit_idx)]
                
            ob_list.append({
                'index': i,
                'time': times_sec[i],
                'type': 1 if ob_val > 0 else -1, # 1: Bullish OB, -1: Bearish OB
                'top': round(top, 2),
                'bottom': round(bottom, 2),
                'volume': round(ob_vol, 2),
                'percentage': round(pct, 2),
                'mitigated': mitigated,
                'mitigatedIndex': int(mit_idx) if pd.notna(mit_idx) and mit_idx > 0 else None,
                'mitigatedTime': mit_time
            })
            
    # Process Liquidity
    liq_list = []
    for i in range(n):
        liq_val = liq_df['Liquidity'].iloc[i]
        if pd.notna(liq_val) and liq_val != 0:
            lvl = float(liq_df['Level'].iloc[i])
            end_idx = liq_df['End'].iloc[i] if 'End' in liq_df.columns else None
            swept_idx = liq_df['Swept'].iloc[i] if 'Swept' in liq_df.columns else None
            
            e_idx = int(end_idx) if pd.notna(end_idx) and end_idx > 0 else i
            s_idx = int(swept_idx) if pd.notna(swept_idx) and swept_idx > 0 else None
            
            liq_list.append({
                'index': i,
                'time': times_sec[i],
                'type': 1 if liq_val > 0 else -1, # 1: Buyside ($$$ High), -1: Sellside ($$$ Low)
                'level': round(lvl, 2),
                'endIndex': e_idx,
                'endTime': times_sec[e_idx] if e_idx < n else times_sec[-1],
                'swept': bool(s_idx is not None and s_idx > 0),
                'sweptIndex': s_idx,
                'sweptTime': times_sec[s_idx] if (s_idx is not None and s_idx < n) else None
            })

    # Summary of ATRBot signals
    total_buys = sum(1 for a in atr_data if a['isBuy'])
    total_sells = sum(1 for a in atr_data if a['isSell'])
            
    result = {
        'symbol': 'BTCUSDT',
        'market': 'Binance Futures (USDT-M)',
        'interval': '15m',
        'totalCandles': n,
        'firstCandleTime': times_sec[0],
        'lastCandleTime': times_sec[-1],
        'lastPrice': candles[-1]['close'],
        'generatedAt': time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        'library': 'joshyattridge/smart-money-concepts + atrbot (Python)',
        'parameters': {
            'swingLength': swing_length,
            'atrBot': {
                'vidyaCmo': vidya_cmo,
                'period': vidya_period,
                'multiplier': atr_multi,
                'atrLength': 14
            }
        },
        'summary': {
            'totalFVG': len(fvg_list),
            'bullishFVG': len([x for x in fvg_list if x['type'] == 1]),
            'bearishFVG': len([x for x in fvg_list if x['type'] == -1]),
            'unmitigatedFVG': len([x for x in fvg_list if not x['mitigated']]),
            'totalSwings': len(swings_list),
            'totalBOS': len([x for x in bos_choch_list if x['isBOS']]),
            'totalCHOCH': len([x for x in bos_choch_list if x['isCHOCH']]),
            'totalOB': len(ob_list),
            'bullishOB': len([x for x in ob_list if x['type'] == 1]),
            'bearishOB': len([x for x in ob_list if x['type'] == -1]),
            'unmitigatedOB': len([x for x in ob_list if not x['mitigated']]),
            'totalLiquidity': len(liq_list),
            'sweptLiquidity': len([x for x in liq_list if x['swept']]),
            'atrBotBuys': total_buys,
            'atrBotSells': total_sells
        },
        'candles': candles,
        'volume': volume_data,
        'fvg': fvg_list,
        'swings': swings_list,
        'bos_choch': bos_choch_list,
        'ob': ob_list,
        'liquidity': liq_list,
        'atrbot': atr_data
    }
    return result

def main():
    klines = fetch_binance_futures_klines("BTCUSDT", "15m", 10000)
    data = calculate_all(klines, swing_length=20, vidya_cmo=14, vidya_period=21, atr_multi=2.0)
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(base_dir, "smc_data.json")
    js_path = os.path.join(base_dir, "smc_data.js")
    
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"JSON saved to {json_path} ({os.path.getsize(json_path)/1024/1024:.2f} MB)")
    
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("window.SMC_PRELOADED_DATA = " + json.dumps(data) + ";\n")
    print(f"JS preloaded bundle saved to {js_path} ({os.path.getsize(js_path)/1024/1024:.2f} MB)")
    print("Ready to open smctest.html!")

if __name__ == "__main__":
    main()
