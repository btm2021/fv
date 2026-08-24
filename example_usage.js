/**
 * Example usage of SmartMoneyConcepts (SMC) + Indicators in Node.js / JavaScript
 */

const SMC = require('./smc.js');

// Sample OHLCV Candles
const sampleCandles = [
  { open: 100, high: 103, low: 99, close: 102, volume: 1000, time: 1700000000 },
  { open: 102, high: 104, low: 100, close: 101, volume: 1200, time: 1700000900 },
  { open: 101, high: 103, low: 100, close: 102, volume: 800, time: 1700001800 },
  { open: 102, high: 108, low: 104, close: 107, volume: 2500, time: 1700002700 },
  { open: 107, high: 109, low: 105, close: 106, volume: 1500, time: 1700003600 },
  { open: 106, high: 108, low: 104, close: 107, volume: 1100, time: 1700004500 }
];

console.log('--- 1. EMA (Exponential Moving Average) ---');
const ema20 = SMC.ema(sampleCandles, 20);
console.log(ema20);

console.log('\n--- 2. VWAP (Volume Weighted Average Price with Bands) ---');
const vwap = SMC.vwap(sampleCandles, { anchor: 'session', stdevMult1: 1.0, stdevMult2: 2.0 });
console.log(vwap);

console.log('\n--- 3. SMA & RSI & ATR ---');
console.log('SMA(5):', SMC.sma(sampleCandles, 5));
console.log('RSI(14):', SMC.rsi(sampleCandles, 14));
console.log('ATR(14):', SMC.atr(sampleCandles, 14));

console.log('\n--- 4. ATRBot (VIDYA 14/21/2) ---');
console.log(SMC.atrBot(sampleCandles, { cmoLength: 14, maLength: 21, atrMult: 2.0 }));

console.log('\n--- 5. VSR (Volume Spike Reversal) ---');
console.log(SMC.vsr(sampleCandles, { length: 10, threshold: 10.0 }));
