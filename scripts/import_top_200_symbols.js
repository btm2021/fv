/**
 * Fetch Top 200 Binance Futures Symbols by 24h Volume and Insert into SQLite Whitelist
 */
const DB = require('../server/db');

const BINANCE_FAPI_BASE = 'https://fapi.binance.com';

async function importTop200Symbols() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('🪙 FETCHING TOP 200 BINANCE FUTURES USDT PAIRS BY 24H VOLUME');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  try {
    // 1. Fetch 24h Ticker statistics from Binance Futures
    const res = await fetch(`${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`);
    if (!res.ok) {
      throw new Error(`Binance API Error HTTP ${res.status}`);
    }
    const tickers = await res.json();
    console.log(`Fetched ${tickers.length} ticker records from Binance Futures.`);

    // 2. Filter for USDT Perpetual contracts and sort by quoteVolume (24h USDT Volume) descending
    const usdtPairs = tickers
      .filter(t => t.symbol && t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 0)
      .map(t => ({
        symbol: t.symbol,
        quoteVolume: parseFloat(t.quoteVolume),
        lastPrice: parseFloat(t.lastPrice),
        priceChangePercent: parseFloat(t.priceChangePercent)
      }))
      .sort((a, b) => b.quoteVolume - a.quoteVolume);

    console.log(`Found ${usdtPairs.length} active USDT pairs. Selecting Top 200...`);
    const top200 = usdtPairs.slice(0, 200);

    // 3. Batch Insert into SQLite
    const now = Date.now();
    let insertCount = 0;
    let stratCount = 0;

    for (let i = 0; i < top200.length; i++) {
      const item = top200[i];
      const rank = i + 1;
      const sym = item.symbol;
      const symId = `sym_${sym.toLowerCase()}`;
      const stratId = `strat_${sym.toLowerCase()}_5m_dual`;
      const category = rank <= 20 ? 'Top 20 Mega Vol' : (rank <= 100 ? 'Top 100 Vol' : 'Top 200 Vol');
      const tags = JSON.stringify([`Rank#${rank}`, category, 'Futures']);

      // Insert or Update Whitelist Symbol Entity
      await DB.run(`
        INSERT INTO whitelist_symbols (id, symbol, is_enabled, category, tags, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
          category = excluded.category,
          tags = excluded.tags,
          updated_at = excluded.updated_at
      `, [symId, sym, category, tags, now, now]);
      insertCount++;

      // Insert or Update 5m Dual SMC Strategy
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

    console.log(`\n✅ SUCCESSFULLY INSERTED / UPDATED ${insertCount} SYMBOLS & ${stratCount} 5M STRATEGIES INTO SQLITE!`);
    console.log('\n--- SAMPLE TOP 15 BY 24H VOLUME ---');
    top200.slice(0, 15).forEach((t, i) => {
      const volMillion = (t.quoteVolume / 1e6).toFixed(2);
      console.log(`  #${(i + 1).toString().padStart(2)}: ${t.symbol.padEnd(12)} | 24h Vol: $${volMillion.padStart(9)}M USDT | Price: $${t.lastPrice} (${t.priceChangePercent > 0 ? '+' : ''}${t.priceChangePercent}%)`);
    });

    const totalSymbolsInDb = (await DB.get('SELECT COUNT(*) as c FROM whitelist_symbols')).c;
    const totalStratsInDb = (await DB.get('SELECT COUNT(*) as c FROM symbol_strategies')).c;
    console.log(`\n📊 Current DB State: ${totalSymbolsInDb} Whitelist Symbols | ${totalStratsInDb} Active Strategies in SQLite.`);

    process.exit(0);
  } catch (err) {
    console.error('Import Failed:', err);
    process.exit(1);
  }
}

importTop200Symbols();
