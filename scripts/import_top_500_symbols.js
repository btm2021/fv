/**
 * Fetch Top 500 Binance Futures Symbols by 24h Volume
 * Inserts 500 Whitelist Entities and 1,000 Strategies (5m + 15m Dual SMC) into SQLite
 * Pre-fetches 1,500 OHLCV candles with adaptive rate-limiting
 */
const DB = require('../server/db');
const binanceClient = require('../server/binanceClient');

const BINANCE_FAPI_BASE = 'https://fapi.binance.com';
const BATCH_CONCURRENCY = 5;       // 5 concurrent requests
const BATCH_DELAY_MS = 100;        // 100ms delay between batches

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function importTop500Symbols(preFetchCandles = true) {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('🪙 SEEDING TOP 500 BINANCE FUTURES PAIRS (5M & 15M DUAL SMC STRATEGIES)');
  console.log('   TOTAL 1,000 STRATEGY ENTITIES WITH RATE-LIMITED INGESTION');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  const startTime = Date.now();

  try {
    // 1. Fetch 24h Ticker statistics from Binance Futures (1 request = 40 weight)
    console.log('📡 Step 1/3: Fetching 24h market ticker statistics from Binance Futures...');
    const res = await fetch(`${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`);
    if (!res.ok) {
      throw new Error(`Binance API Error HTTP ${res.status}`);
    }
    const tickers = await res.json();
    console.log(`✓ Fetched ${tickers.length} market records from Binance Futures.`);

    // 2. Filter USDT Perpetual pairs and sort by 24h quoteVolume descending
    const usdtPairs = tickers
      .filter(t => t.symbol && t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 0)
      .map(t => ({
        symbol: t.symbol,
        quoteVolume: parseFloat(t.quoteVolume),
        lastPrice: parseFloat(t.lastPrice),
        priceChangePercent: parseFloat(t.priceChangePercent)
      }))
      .sort((a, b) => b.quoteVolume - a.quoteVolume);

    const targetCount = Math.min(500, usdtPairs.length);
    const top500 = usdtPairs.slice(0, targetCount);
    console.log(`✓ Found ${usdtPairs.length} active USDT pairs. Selecting Top ${targetCount} by 24h volume...\n`);

    // 3. Batch Insert Whitelist Entities and Dual SMC Strategies (5m + 15m) into SQLite
    console.log(`💾 Step 2/3: Upserting ${targetCount} Whitelist Entities & ${targetCount * 2} Strategies (5m & 15m) into SQLite...`);
    const now = Date.now();
    let insertCount = 0;
    let stratCount = 0;

    for (let i = 0; i < top500.length; i++) {
      const item = top500[i];
      const rank = i + 1;
      const sym = item.symbol;
      const symId = `sym_${sym.toLowerCase()}`;
      
      let category = 'Top 500 Vol';
      if (rank <= 50) category = 'Top 50 Mega Vol';
      else if (rank <= 150) category = 'Top 150 High Vol';
      else if (rank <= 300) category = 'Top 300 Mid Vol';

      const tags = JSON.stringify([`Rank#${rank}`, category, 'Futures', '5m-15m']);

      // Upsert Whitelist Symbol Entity
      await DB.run(`
        INSERT INTO whitelist_symbols (id, symbol, is_enabled, category, tags, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
          category = excluded.category,
          tags = excluded.tags,
          updated_at = excluded.updated_at
      `, [symId, sym, category, tags, now, now]);
      insertCount++;

      // Upsert 5m Dual SMC Strategy
      const stratId5m = `strat_${sym.toLowerCase()}_5m_dual`;
      await DB.run(`
        INSERT INTO symbol_strategies (
          id, symbol, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
          cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
          fvg_threshold_pct, swing_lookback, created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'dual', '5m', 1, 1.0, 20, 'ISOLATED', 'MARKET',
          14, 21, 14, 2.0, 0.35, 1.5,
          1.5, 30, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          strategy_type = excluded.strategy_type,
          timeframe = excluded.timeframe,
          is_enabled = excluded.is_enabled,
          updated_at = excluded.updated_at
      `, [stratId5m, sym, `${sym} Dual 5m Pro`, now, now]);
      stratCount++;

      // Upsert 15m Dual SMC Strategy
      const stratId15m = `strat_${sym.toLowerCase()}_15m_dual`;
      await DB.run(`
        INSERT INTO symbol_strategies (
          id, symbol, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
          cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
          fvg_threshold_pct, swing_lookback, created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'dual', '15m', 1, 1.0, 20, 'ISOLATED', 'MARKET',
          14, 21, 14, 2.0, 0.35, 1.5,
          1.5, 30, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          strategy_type = excluded.strategy_type,
          timeframe = excluded.timeframe,
          is_enabled = excluded.is_enabled,
          updated_at = excluded.updated_at
      `, [stratId15m, sym, `${sym} Dual 15m Pro`, now, now]);
      stratCount++;
    }

    console.log(`✓ Inserted/Updated ${insertCount} Whitelist Symbols and ${stratCount} Strategies (5m + 15m).\n`);

    // 4. Pre-fetch 1,500 candles per symbol if requested
    if (preFetchCandles) {
      console.log('🕯️ Step 3/3: Pre-fetching 1,500 OHLCV Candles (5m & 15m) with Rate-Limiting...');
      let processed = 0;
      const tasks = [];
      for (const item of top500) {
        tasks.push({ symbol: item.symbol, tf: '5m' });
        tasks.push({ symbol: item.symbol, tf: '15m' });
      }

      const totalTasks = tasks.length;
      const totalBatches = Math.ceil(totalTasks / BATCH_CONCURRENCY);

      for (let b = 0; b < totalBatches; b++) {
        const batchSlice = tasks.slice(b * BATCH_CONCURRENCY, (b + 1) * BATCH_CONCURRENCY);

        await Promise.all(batchSlice.map(async (task) => {
          try {
            await binanceClient.syncCandles(task.symbol, task.tf, 1500);
            processed++;
          } catch (e) {
            // Non-blocking warning
          }
        }));

        const pct = Math.round((processed / totalTasks) * 100);
        const barFilled = Math.round(pct / 5);
        const bar = '█'.repeat(barFilled) + '░'.repeat(20 - barFilled);
        process.stdout.write(`\r   [${bar}] ${pct}% (${processed}/${totalTasks}) | Batch ${b + 1}/${totalBatches}`);

        if (b < totalBatches - 1) {
          await sleep(BATCH_DELAY_MS);
        }
      }
      console.log('\n');
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`══════════════════════════════════════════════════════════════════════`);
    console.log(`🎉 TOP 500 (1,000 STRATEGIES 5M/15M) INGESTION COMPLETED IN ${elapsedSec}s!`);
    console.log(`══════════════════════════════════════════════════════════════════════`);

    const totalSymbolsInDb = (await DB.get('SELECT COUNT(*) as c FROM whitelist_symbols')).c;
    const totalStratsInDb = (await DB.get('SELECT COUNT(*) as c FROM symbol_strategies')).c;
    const totalCandlesInDb = (await DB.get('SELECT COUNT(*) as c FROM ohlcv_candles')).c;

    console.log(`📊 Current Database State:`);
    console.log(`   • Whitelist Symbols    : ${totalSymbolsInDb} pairs`);
    console.log(`   • Active 5m/15m Strats : ${totalStratsInDb} strategies`);
    console.log(`   • Stored 1500-Bar OHLCV: ${totalCandlesInDb.toLocaleString()} candles\n`);

    return { success: true, count: targetCount, strategies: stratCount };
  } catch (err) {
    console.error('Import Top 500 Failed:', err);
    throw err;
  }
}

// CLI Execution
if (require.main === module) {
  importTop500Symbols(true)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = importTop500Symbols;
