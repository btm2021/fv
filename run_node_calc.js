
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
