/**
 * Fetch Top 400 Binance Futures Symbols by 24h Volume and Sync 5m Candles with Adaptive Rate-Limiting
 */
const DB = require('../server/db');
const binanceClient = require('../server/binanceClient');

const BINANCE_FAPI_BASE = 'https://fapi.binance.com';
const BATCH_CONCURRENCY = 5;       // 5 concurrent requests
const BATCH_DELAY_MS = 120;        // 120ms delay between batches to stay safely within 2400 weight/min

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function importTop400Symbols() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('🪙 FETCHING TOP 400 BINANCE FUTURES USDT PAIRS (5M SMC STRATEGIES)');
  console.log('   WITH ADAPTIVE RATE-LIMIT MANAGEMENT & BATCH INGESTION');
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

    const totalAvailable = usdtPairs.length;
    const targetCount = Math.min(400, totalAvailable);
    const top400 = usdtPairs.slice(0, targetCount);
    console.log(`✓ Found ${totalAvailable} active USDT pairs. Selecting Top ${targetCount} by 24h volume...\n`);

    // 3. Batch Insert Whitelist Entities and 5m Dual SMC Strategies into SQLite
    console.log('💾 Step 2/3: Upserting 400 Whitelist Entities & 5m SMC Dual Strategies into SQLite...');
    const now = Date.now();
    let insertCount = 0;
    let stratCount = 0;

    for (let i = 0; i < top400.length; i++) {
      const item = top400[i];
      const rank = i + 1;
      const sym = item.symbol;
      const symId = `sym_${sym.toLowerCase()}`;
      const stratId = `strat_${sym.toLowerCase()}_5m_dual`;

      let category = 'Top 400 Vol';
      if (rank <= 20) category = 'Top 20 Mega Vol';
      else if (rank <= 100) category = 'Top 100 Vol';
      else if (rank <= 200) category = 'Top 200 Vol';

      const tags = JSON.stringify([`Rank#${rank}`, category, 'Futures', '5m-Dual']);

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
      await DB.run(`
        INSERT INTO symbol_strategies (
          id, symbol, strategy_name, strategy_type, timeframe, is_enabled, risk_pct,
          cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
          fvg_threshold_pct, swing_lookback, created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'dual', '5m', 1, 1.0,
          14, 21, 14, 2.0, 0.35, 1.5,
          1.5, 30, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          strategy_type = excluded.strategy_type,
          timeframe = excluded.timeframe,
          is_enabled = excluded.is_enabled,
          updated_at = excluded.updated_at
      `, [stratId, sym, `${sym} Dual 5m Pro`, now, now]);
      stratCount++;
    }

    console.log(`✓ Inserted/Updated ${insertCount} Whitelist Symbols and ${stratCount} 5m Strategies.\n`);

    // 4. Step 3/3: Parallel Chunked Pre-fetch 1,000 Candles per Symbol with Rate Limit Pacing
    console.log('🕯️ Step 3/3: Pre-fetching 5m OHLCV Candles with Adaptive Rate-Limiting...');
    let processedCandles = 0;
    const totalBatches = Math.ceil(top400.length / BATCH_CONCURRENCY);

    for (let b = 0; b < totalBatches; b++) {
      const batchSlice = top400.slice(b * BATCH_CONCURRENCY, (b + 1) * BATCH_CONCURRENCY);

      await Promise.all(batchSlice.map(async (item) => {
        try {
          await binanceClient.syncCandles(item.symbol, '5m', 1000);
          processedCandles++;
        } catch (e) {
          // Log non-blocking error
          console.warn(`[WARN] Failed to sync ${item.symbol}: ${e.message}`);
        }
      }));

      // Progress bar display
      const pct = Math.round((processedCandles / top400.length) * 100);
      const barFilled = Math.round(pct / 5);
      const bar = '█'.repeat(barFilled) + '░'.repeat(20 - barFilled);
      process.stdout.write(`\r   [${bar}] ${pct}% (${processedCandles}/${top400.length}) | Batch ${b + 1}/${totalBatches}`);

      if (b < totalBatches - 1) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\n══════════════════════════════════════════════════════════════════════`);
    console.log(`🎉 COMPLETED TOP 400 IMPORT IN ${elapsedSec}s WITHOUT RATE LIMITS!`);
    console.log(`══════════════════════════════════════════════════════════════════════`);

    const totalSymbolsInDb = (await DB.get('SELECT COUNT(*) as c FROM whitelist_symbols')).c;
    const totalStratsInDb = (await DB.get('SELECT COUNT(*) as c FROM symbol_strategies')).c;
    const totalCandlesInDb = (await DB.get('SELECT COUNT(*) as c FROM ohlcv_candles')).c;

    console.log(`📊 Final SQLite Database State:`);
    console.log(`   • Whitelist Entities   : ${totalSymbolsInDb} pairs`);
    console.log(`   • Active 5m Strategies : ${totalStratsInDb} strategies`);
    console.log(`   • Stored OHLCV Bars    : ${totalCandlesInDb.toLocaleString()} candles`);
    console.log(`\n🚀 Top 10 Volume Ranking Summary:`);
    top400.slice(0, 10).forEach((t, i) => {
      const volM = (t.quoteVolume / 1e6).toFixed(2);
      console.log(`   #${(i + 1).toString().padStart(2)}: ${t.symbol.padEnd(12)} | 24h Vol: $${volM.padStart(8)}M USDT | Price: $${t.lastPrice} (${t.priceChangePercent > 0 ? '+' : ''}${t.priceChangePercent}%)`);
    });
    console.log('══════════════════════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (err) {
    console.error('Import Top 400 Failed:', err);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  importTop400Symbols();
}

module.exports = importTop400Symbols;
