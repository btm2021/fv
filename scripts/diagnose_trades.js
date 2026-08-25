const DB = require('../server/db');
const binanceClient = require('../server/binanceClient');
const Stat2Box = require('../indicators/indicator_stat2_box_strategy');

const testSymbols = [
  'MELANIAUSDT',
  'SCRTUSDT',
  'SKHYNIXUSDT',
  'STORJUSDT',
  'CSOPSKHYNIX2LUSDT',
  'SUPERUSDT',
  'SNXXUSDT'
];

async function diagnose() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('🔍 FORENSIC ANALYSIS ON REPORTED SYMBOLS');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  for (const sym of testSymbols) {
    console.log(`\n================== [ ${sym} (5m) ] ==================`);
    const candles = await binanceClient.syncCandles(sym, '5m', 1500);
    console.log(`Candles count: ${candles.length}`);
    if (!candles || candles.length < 50) {
      console.log('Insufficient candles.');
      continue;
    }

    const calc = Stat2Box.calculate(candles, {
      strategyMode: 'dual',
      cmoLength: 14,
      maLength: 21,
      atrLength: 14,
      atrMult: 2.0,
      minAtrPct: 0.35,
      liqThresholdPct: 1.5,
      fvgThresholdPct: 1.5,
      swingLookback: 30
    });

    const cards = calc.cards || [];
    console.log(`Total historical signals generated in 1500 bars: ${cards.length}`);

    // Summary of historical performance on this symbol
    let wins = 0, losses = 0, bes = 0, active = 0;
    for (const c of cards) {
      if (c.status === 'TP2_HIT') wins++;
      else if (c.status === 'TP1_HIT') wins++;
      else if (c.status === 'BE_HIT') bes++;
      else if (c.status === 'SL_HIT') losses++;
      else active++;
    }

    const winRate = (wins + bes + losses) > 0 ? ((wins / (wins + losses + bes)) * 100).toFixed(1) : 0;
    console.log(`Symbol stats in 1500 bars: WinRate: ${winRate}% | TP Hits: ${wins} | BE Hits: ${bes} | SL Hits: ${losses} | Active: ${active}`);

    // Check last 5 cards in history
    console.log('Recent 3 cards:');
    cards.slice(-3).forEach((c, idx) => {
      const dt = new Date(c.time * 1000).toISOString().replace('T', ' ').slice(0, 19);
      console.log(`  Card #${idx + 1}: ${c.signalType} (${c.tradeDir}) at ${dt} | Entry: ${c.entryPrice}, TP1: ${c.tp1Price}, TP2: ${c.tp2Price}, SL: ${c.slPrice} | Status: ${c.status} (${c.pnlPct >= 0 ? '+' : ''}${c.pnlPct.toFixed(2)}%)`);
      console.log(`    ATR%: ${c.atrPct.toFixed(2)}% | R:R: 1:${c.rrRatio.toFixed(2)}`);
    });
  }

  process.exit(0);
}

diagnose().catch(err => {
  console.error('Diagnosis error:', err);
  process.exit(1);
});
