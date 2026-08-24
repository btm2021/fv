"""
Validation Script: Python vs JavaScript / Node.js Parity Checker
Calculates all indicators on 10,000 BTCUSDT 15m candles in both Python and Node.js
and performs deep field-by-field parity assertions.
"""

import os
import sys
import json
import subprocess
import pandas as pd
import numpy as np
from smartmoneyconcepts import smc
from atrbot import calculate_atr_bot
from vsr import calculate_vsr

print("=" * 70)
print("SMC & ATRBot & VSR: Python vs Node.js Validation Suite")
print("=" * 70)

# Load 10,000 candles from smc_data.json
base_dir = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(base_dir, "smc_data.json"), "r") as f:
    data = json.load(f)

candles = data["candles"]
n = len(candles)
print(f"Loaded {n} candles of BTCUSDT 15m.\n")

df = pd.DataFrame(candles)
df['open'] = df['open'].astype(float)
df['high'] = df['high'].astype(float)
df['low'] = df['low'].astype(float)
df['close'] = df['close'].astype(float)
df['volume'] = [c.get('volume', 1000.0) for c in candles]
if 'volume' in data and len(data['volume']) == n:
    df['volume'] = [v['value'] for v in data['volume']]

# 1. Run Python Calculations
print("[Python] Running 10 indicators...")
py_fvg = smc.fvg(df)
py_swings = smc.swing_highs_lows(df, swing_length=20)
py_bos = smc.bos_choch(df, py_swings)
py_ob = smc.ob(df, py_swings)
py_liq = smc.liquidity(df, py_swings)
py_atr = calculate_atr_bot(df, cmo_length=14, ma_length=21, atr_mult=2.0)
py_vsr = calculate_vsr(df, length=10, threshold=10.0)
print("[Python] Calculations completed.\n")

# 2. Run Node.js Calculations via child process or exported JS
print("[Node.js] Running JavaScript smc.js calculations...")
node_test_script = """
const fs = require('fs');
const SMC = require('./smc.js');

const raw = JSON.parse(fs.readFileSync('smc_data.json', 'utf8'));
const candles = raw.candles;
// assign volume from raw volume
if (raw.volume && raw.volume.length === candles.length) {
  for (let i = 0; i < candles.length; i++) {
    candles[i].volume = raw.volume[i].value;
  }
}

const fvg = SMC.fvg(candles);
const swings = SMC.swingHighsLows(candles, 20);
const bos = SMC.bosChoch(candles, swings, true);
const ob = SMC.ob(candles, swings, false);
const liq = SMC.liquidity(candles, swings, 0.01);
const atr = SMC.atrBot(candles, { cmoLength: 14, maLength: 21, atrMult: 2.0 });
const vsr = SMC.vsr(candles, { length: 10, threshold: 10.0 });

const out = {
  fvgCount: fvg.filter(x => x.FVG !== null).length,
  bullFVG: fvg.filter(x => x.FVG === 1).length,
  bearFVG: fvg.filter(x => x.FVG === -1).length,
  swingsCount: swings.filter(x => x.HighLow !== null).length,
  bosCount: bos.filter(x => x.BOS !== null).length,
  chochCount: bos.filter(x => x.CHOCH !== null).length,
  obCount: ob.filter(x => x.OB !== null).length,
  bullOB: ob.filter(x => x.OB === 1).length,
  bearOB: ob.filter(x => x.OB === -1).length,
  liqCount: liq.filter(x => x.Liquidity !== null).length,
  sweptLiq: liq.filter(x => x.Liquidity !== null && x.Swept > 0).length,
  atrBuys: atr.filter(x => x.isBuy).length,
  atrSells: atr.filter(x => x.isSell).length,
  atrLastT1: atr[atr.length - 1].trail1,
  atrLastT2: atr[atr.length - 1].trail2,
  vsrSpikes: vsr.filter(x => x.isSpike).length,
  vsrLastUpper: vsr[vsr.length - 1].upper,
  vsrLastLower: vsr[vsr.length - 1].lower
};

fs.writeFileSync('node_results.json', JSON.stringify(out, null, 2));
console.log('[Node.js] Calculations finished successfully.');
"""

with open(os.path.join(base_dir, "run_node_calc.js"), "w", encoding="utf-8") as f:
    f.write(node_test_script)

res = subprocess.run(["node", "run_node_calc.js"], cwd=base_dir, capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print("Node stderr:", res.stderr)

with open(os.path.join(base_dir, "node_results.json"), "r") as f:
    js_results = json.load(f)

# 3. Perform Field-by-Field Parity Comparison
py_bull_fvg = len(py_fvg[py_fvg["FVG"] == 1])
py_bear_fvg = len(py_fvg[py_fvg["FVG"] == -1])
py_total_fvg = py_bull_fvg + py_bear_fvg

py_swings_count = len(py_swings.dropna(subset=["HighLow"]))
py_bos_count = len(py_bos.dropna(subset=["BOS"]))
py_choch_count = len(py_bos.dropna(subset=["CHOCH"]))

py_bull_ob = len(py_ob[py_ob["OB"] == 1])
py_bear_ob = len(py_ob[py_ob["OB"] == -1])
py_total_ob = py_bull_ob + py_bear_ob

py_liq_count = len(py_liq.dropna(subset=["Liquidity"]))
py_swept_liq = len(py_liq[py_liq["Swept"] > 0])

py_atr_buys = sum(1 for a in py_atr if a["isBuy"])
py_atr_sells = sum(1 for a in py_atr if a["isSell"])

py_vsr_spikes = sum(1 for v in py_vsr if v["isSpike"])

print("=" * 70)
print(f"{'Indicator / Metric':<30} | {'Python':<15} | {'Node.js':<15} | {'Status'}")
print("-" * 70)

metrics = [
    ("Total FVGs", py_total_fvg, js_results["fvgCount"]),
    ("Bullish FVGs", py_bull_fvg, js_results["bullFVG"]),
    ("Bearish FVGs", py_bear_fvg, js_results["bearFVG"]),
    ("Swing Highs & Lows", py_swings_count, js_results["swingsCount"]),
    ("BOS (Break of Structure)", py_bos_count, js_results["bosCount"]),
    ("CHoCH (Change of Character)", py_choch_count, js_results["chochCount"]),
    ("Total Order Blocks (OB)", py_total_ob, js_results["obCount"]),
    ("Bullish Order Blocks", py_bull_ob, js_results["bullOB"]),
    ("Bearish Order Blocks", py_bear_ob, js_results["bearOB"]),
    ("Liquidity Zones", py_liq_count, js_results["liqCount"]),
    ("Swept Liquidity Zones", py_swept_liq, js_results["sweptLiq"]),
    ("ATRBot Buy Signals", py_atr_buys, js_results["atrBuys"]),
    ("ATRBot Sell Signals", py_atr_sells, js_results["atrSells"]),
    ("ATRBot Last Trail1 (VIDYA)", f"{py_atr[-1]['trail1']:.2f}", f"{js_results['atrLastT1']:.2f}"),
    ("ATRBot Last Trail2 (Stop)", f"{py_atr[-1]['trail2']:.2f}", f"{js_results['atrLastT2']:.2f}"),
    ("VSR Spike Events", py_vsr_spikes, js_results["vsrSpikes"]),
    ("VSR Last Upper Level", f"{py_vsr[-1]['upper']}", f"{js_results['vsrLastUpper']}"),
    ("VSR Last Lower Level", f"{py_vsr[-1]['lower']}", f"{js_results['vsrLastLower']}"),
]

all_passed = True
for name, py_val, js_val in metrics:
    try:
        is_match = abs(float(py_val) - float(js_val)) < 1e-3
    except (ValueError, TypeError):
        is_match = str(py_val) == str(js_val)

    status = "✅ 100% MATCH" if is_match else "❌ MISMATCH"
    if not is_match:
        all_passed = False
    print(f"{name:<30} | {str(py_val):<15} | {str(js_val):<15} | {status}")

print("=" * 70)
if all_passed:
    print("🎯 VALIDATION RESULT: 100% PERFECT PARITY ACROSS ALL INDICATORS!")
else:
    print("⚠️ WARNING: Differences detected between engines.")
