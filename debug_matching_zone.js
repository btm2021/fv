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

const swings = SMC.swingHighsLows(fullCandles, 20);
const liqList = SMC.liquidity(fullCandles, swings, 0.01) || [];

for (let i = 0; i < liqList.length; i++) {
  const item = liqList[i];
  if (!item || item.Liquidity === null) continue;
  // Let's print any zone covering bar 443
  // startIdx = i + 20, endIdx = item.End, sweptAt = item.Swept
  const startIdx = i + 20;
  const endIdx = item.End || 999999;
  const sweptAt = item.Swept;
  if (startIdx <= 443 && 443 <= endIdx) {
    console.log(`Matching Zone from Swing at i=${i}: Type=${item.Liquidity===1?'BSL':'SSL'}, Level=${item.Level}, startIdx=${startIdx}, endIdx=${endIdx}, sweptAt=${sweptAt}`);
  }
}
