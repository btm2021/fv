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

function checkLiqOnBar(candles, label) {
  const swings = SMC.swingHighsLows(candles, 20);
  const liqList = SMC.liquidity(candles, swings, 0.01) || [];
  
  // Find which liquidity items exist around bar 443
  console.log(`\n--- [${label}] Liquidity Items around 443 ---`);
  for (let i = 0; i < liqList.length; i++) {
    const item = liqList[i];
    if (item && item.Liquidity !== null && i >= 400 && i <= 460) {
      console.log(`idx=${i}, type=${item.Liquidity===1?'BSL':'SSL'}, Level=${item.Level}, Swept=${item.Swept}, End=${item.End}`);
    }
  }
}

checkLiqOnBar(fullCandles, 'FULL');
checkLiqOnBar(fullCandles.slice(0, 444), 'TRUNC');
