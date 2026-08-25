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

async function runComprehensiveBacktest() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('📊 ACCURATE SMC EXECUTION BACKTEST WITH STRICT FRESHNESS & LIMIT RULES');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  let totalTrades = 0;
  let totalWins = 0;
  let totalBes = 0;
  let totalLosses = 0;
  let totalNetPnlUsd = 0;

  for (const sym of testSymbols) {
    const candles = await binanceClient.syncCandles(sym, '5m', 1500);
    if (!candles || candles.length < 50) continue;

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
    console.log(`\n▶ [ ${sym} ] Candles: ${candles.length} | Generated Signals: ${cards.length}`);

    let symWins = 0, symBes = 0, symLosses = 0, symNetPnl = 0;

    for (const card of cards) {
      // Simulate $1000 starting account, 1% fixed risk ($10 risk per trade)
      const riskUsd = 10.0; // 1% of $1000
      const slDistPct = Math.max(card.slPct / 100.0, 0.015);
      const posSize = Math.min(riskUsd / slDistPct, 10000); // 10x max cap

      let pnlUsd = 0;
      if (card.status === 'TP2_HIT') {
        const gross = posSize * (card.tp2Pct / 100.0);
        const fee = posSize * 0.0007;
        pnlUsd = gross - fee;
        symWins++;
        totalWins++;
      } else if (card.status === 'TP1_HIT') {
        const gross = posSize * (card.tp1Pct / 100.0);
        const fee = posSize * 0.0007;
        pnlUsd = gross - fee;
        symWins++;
        totalWins++;
      } else if (card.status === 'BE_HIT') {
        pnlUsd = -posSize * 0.0007; // Small fee loss
        symBes++;
        totalBes++;
      } else if (card.status === 'SL_HIT') {
        const gross = -posSize * (card.slPct / 100.0);
        const fee = posSize * 0.001;
        pnlUsd = gross - fee;
        symLosses++;
        totalLosses++;
      } else {
        continue; // Active
      }

      symNetPnl += pnlUsd;
      totalNetPnlUsd += pnlUsd;
      totalTrades++;
    }

    const symTotal = symWins + symBes + symLosses;
    const symWinRate = symTotal > 0 ? ((symWins / symTotal) * 100).toFixed(1) : 0;
    console.log(`   Results: ${symTotal} closed trades | WinRate: ${symWinRate}% (Wins: ${symWins}, BE: ${symBes}, Losses: ${symLosses}) | Net PnL: ${symNetPnl >= 0 ? '+' : ''}$${symNetPnl.toFixed(2)} USD`);
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('🏆 TOTAL COMBINED 7-SYMBOL TEST SUMMARY');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`Total Trades Executed : ${totalTrades}`);
  console.log(`Win Trades (TP1/TP2)  : ${totalWins} (${((totalWins / totalTrades) * 100).toFixed(1)}%)`);
  console.log(`Breakeven Trades (BE) : ${totalBes} (${((totalBes / totalTrades) * 100).toFixed(1)}%)`);
  console.log(`Loss Trades (SL Hit)  : ${totalLosses} (${((totalLosses / totalTrades) * 100).toFixed(1)}%)`);
  console.log(`Total Net Profit/Loss : ${totalNetPnlUsd >= 0 ? '+' : ''}$${totalNetPnlUsd.toFixed(2)} USD`);
  console.log('══════════════════════════════════════════════════════════════════════');

  process.exit(0);
}

runComprehensiveBacktest().catch(e => {
  console.error(e);
  process.exit(1);
});
