const fs = require('fs');
const SMC = require('./smc.js');
const Stat2Box = require('./indicators/indicator_stat2_box_strategy.js');

const raw = fs.readFileSync('data_raw/BTCUSDT.csv', 'utf8').trim().split('\n');
const fullCandles = [];
for (let i = 1; i < Math.min(raw.length, 1500); i++) {
  const p = raw[i].split(',');
  fullCandles.push({
    time: Math.floor(parseInt(p[0]) / 1000),
    open: parseFloat(p[1]),
    high: parseFloat(p[2]),
    low: parseFloat(p[3]),
    close: parseFloat(p[4]),
    volume: parseFloat(p[5])
  });
}

const fullRes = Stat2Box.calculate(fullCandles, Stat2Box.defaultInputs);
const truncCandles = fullCandles.slice(0, 443 + 1);
const truncRes = Stat2Box.calculate(truncCandles, Stat2Box.defaultInputs);

console.log('--- BAR 443 COMPARISON ---');
console.log('Full raw ATR:', fullRes.atrData[443]);
console.log('Trunc raw ATR:', truncRes.atrData[443]);

const c = fullCandles[443];
console.log('Candle 443:', c);

const rawAtrFull = SMC.atrBot(fullCandles, { cmoLength: 14, maLength: 21, atrLength: 14, atrMult: 2.0 });
const rawAtrTrunc = SMC.atrBot(truncCandles, { cmoLength: 14, maLength: 21, atrLength: 14, atrMult: 2.0 });

console.log('rawAtrFull[443].atr:', rawAtrFull[443].atr, 'atrPct:', rawAtrFull[443].atr / c.close * 100);
console.log('rawAtrTrunc[443].atr:', rawAtrTrunc[443].atr, 'atrPct:', rawAtrTrunc[443].atr / c.close * 100);

const swingsFull = SMC.swingHighsLows(fullCandles, 20);
const swingsTrunc = SMC.swingHighsLows(truncCandles, 20);

console.log('swingsFull count:', swingsFull.filter(s => s.HighLow !== null).length);
console.log('swingsTrunc count:', swingsTrunc.filter(s => s.HighLow !== null).length);
