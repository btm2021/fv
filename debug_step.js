const fs = require('fs');
const SMC = require('./smc.js');

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

function debugBar(candles, label) {
  const swings = SMC.swingHighsLows(candles, 20);
  const liqList = SMC.liquidity(candles, swings, 0.01) || [];
  const fvgList = SMC.fvg(candles, false) || [];
  const rawAtrData = SMC.atrBot(candles, { cmoLength: 14, maLength: 21, atrLength: 14, atrMult: 2.0 }) || [];

  const i = 443;
  const item = rawAtrData[i];
  const c = candles[i];
  const atrVal = item.atr || 0;
  const atrPct = c.close > 0 ? (atrVal / c.close * 100) : 0;
  const isLowVol = atrPct < 0.35;

  console.log(`[${label}] Bar 443: isBuy=${item.isBuy}, isSell=${item.isSell}, atrVal=${atrVal}, atrPct=${atrPct}, isLowVol=${isLowVol}`);
}

debugBar(fullCandles, 'FULL');
debugBar(fullCandles.slice(0, 444), 'TRUNC');
