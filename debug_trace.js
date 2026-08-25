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

// Let's test calculate with verbose logs for bar 443
console.log('Calculating full...');
const fullRes = Stat2Box.calculate(fullCandles, Stat2Box.defaultInputs);
console.log('Calculating trunc up to 443...');
const truncRes = Stat2Box.calculate(fullCandles.slice(0, 444), Stat2Box.defaultInputs);

console.log('Full at 443:', fullRes.atrData[443]);
console.log('Trunc at 443:', truncRes.atrData[443]);
