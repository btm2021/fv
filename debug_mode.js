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

// Let's test with mode='dual'
const resFull = Stat2Box.calculate(fullCandles, { strategyMode: 'dual', minAtrPct: 0.35 });
const resTrunc = Stat2Box.calculate(fullCandles.slice(0, 444), { strategyMode: 'dual', minAtrPct: 0.35 });

console.log('resFull.atrData[443]:', resFull.atrData[443]);
console.log('resTrunc.atrData[443]:', resTrunc.atrData[443]);
