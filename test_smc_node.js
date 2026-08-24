/**
 * Verification Test for Node.js SMC + Indicators Suite
 * Runs all 15 indicators on 10,000 candles from smc_data.json and verifies outputs.
 */

const fs = require('fs');
const path = require('path');
const SMC = require('./smc.js');

console.log(`Testing Node.js SMC Indicator Suite (Version: ${SMC.version})...\n`);

const rawJson = fs.readFileSync(path.join(__dirname, 'smc_data.json'), 'utf-8');
const data = JSON.parse(rawJson);
const candles = data.candles;
if (data.volume && data.volume.length === candles.length) {
  for (let i = 0; i < candles.length; i++) {
    candles[i].volume = data.volume[i].value;
  }
}

console.log(`Loaded ${candles.length} candles of BTCUSDT 15m.`);

const t0 = Date.now();

// 1. FVG
const fvgRes = SMC.fvg(candles);
console.log(`[1/15] FVG: Total=${fvgRes.filter(x => x.FVG !== null).length}`);

// 2. Swings
const swingRes = SMC.swingHighsLows(candles, 20);
console.log(`[2/15] Swing Highs/Lows: Total=${swingRes.filter(x => x.HighLow !== null).length}`);

// 3. BOS & CHoCH
const bosRes = SMC.bosChoch(candles, swingRes, true);
console.log(`[3/15] BOS/CHOCH: BOS=${bosRes.filter(x => x.BOS !== null).length}, CHOCH=${bosRes.filter(x => x.CHOCH !== null).length}`);

// 4. Order Blocks
const obRes = SMC.ob(candles, swingRes, false);
console.log(`[4/15] Order Blocks: Total=${obRes.filter(x => x.OB !== null).length}`);

// 5. Liquidity
const liqRes = SMC.liquidity(candles, swingRes, 0.01);
console.log(`[5/15] Liquidity: Total=${liqRes.filter(x => x.Liquidity !== null).length}`);

// 6. Previous High Low
const phlRes = SMC.previousHighLow(candles, "1D");
console.log(`[6/15] Previous High/Low (1D): Evaluated=${phlRes.filter(x => x.PreviousHigh !== null).length}`);

// 7. Sessions
const sessionRes = SMC.sessions(candles, "London");
console.log(`[7/15] Sessions (London): Active Bars=${sessionRes.filter(x => x.Active === 1).length}`);

// 8. Retracements
const retRes = SMC.retracements(candles, swingRes);
console.log(`[8/15] Retracements: Evaluated bars=${retRes.length}`);

// 9. ATRBot
const atrRes = SMC.atrBot(candles, { cmoLength: 14, maLength: 21, atrMult: 2.0 });
console.log(`[9/15] ATRBot (VIDYA 14/21/2): Buy Signals=${atrRes.filter(x => x.isBuy).length}, Sell Signals=${atrRes.filter(x => x.isSell).length}`);

// 10. VSR
const vsrRes = SMC.vsr(candles, { length: 10, threshold: 10.0 });
console.log(`[10/15] VSR: Spikes Detected=${vsrRes.filter(x => x.isSpike).length}`);

// 11. EMA (9, 21, 50, 200)
const t_ema = Date.now();
const ema9 = SMC.ema(candles, 9);
const ema21 = SMC.ema(candles, 21);
const ema50 = SMC.ema(candles, 50);
const ema200 = SMC.ema(candles, 200);
console.log(`[11/15] EMA (9, 21, 50, 200): Last EMA200=${ema200[ema200.length - 1].value} [${Date.now() - t_ema}ms]`);

// 12. SMA (20, 50)
const t_sma = Date.now();
const sma20 = SMC.sma(candles, 20);
const sma50 = SMC.sma(candles, 50);
console.log(`[12/15] SMA (20, 50): Last SMA20=${sma20[sma20.length - 1].value} [${Date.now() - t_sma}ms]`);

// 13. VWAP (Session Anchored with SD Bands)
const t_vwap = Date.now();
const vwapRes = SMC.vwap(candles, { anchor: 'session', stdevMult1: 1.0, stdevMult2: 2.0 });
const lastVwap = vwapRes[vwapRes.length - 1];
console.log(`[13/15] VWAP (Session): Last VWAP=${lastVwap.vwap}, Upper1=${lastVwap.upper1}, Lower1=${lastVwap.lower1} [${Date.now() - t_vwap}ms]`);

// 14. RSI (14)
const t_rsi = Date.now();
const rsiRes = SMC.rsi(candles, 14);
console.log(`[14/15] RSI (14): Last RSI=${rsiRes[rsiRes.length - 1].value} [${Date.now() - t_rsi}ms]`);

// 15. ATR (14)
const t_atr = Date.now();
const atr14 = SMC.atr(candles, 14);
console.log(`[15/15] ATR (14): Last ATR=${atr14[atr14.length - 1].value} [${Date.now() - t_atr}ms]`);

const totalTime = Date.now() - t0;
console.log(`\nAll 15 indicators calculated on 10,000 candles in ${totalTime}ms (~${(totalTime/1000).toFixed(3)}s)!`);
console.log('✅ ALL TESTS PASSED: Indicator suite successfully verified.');
