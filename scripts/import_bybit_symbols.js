/**
 * Bybit Linear Perpetual Top 300 Symbols Discovery & Seeder
 * Ingests Top 300 Bybit Linear USDT pairs and creates 600 Strategies across 5m & 15m
 */
const DB = require('../server/db');
const bybitClient = require('../server/bybitClient');

async function importBybitSymbols(preFetchCandles = false) {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('🚀 IMPORTING TOP 300 BYBIT LINEAR PERPETUAL SYMBOLS');
  console.log('══════════════════════════════════════════════════════════════\n');

  try {
    // 1. Fetch all Linear instruments
    console.log('📡 Step 1/3: Querying Bybit V5 Linear Instruments...');
    const instruments = await bybitClient.getExchangeInfo();
    console.log(`✓ Discovered ${instruments.length} active Bybit USDT linear perpetual contracts.\n`);

    if (instruments.length === 0) {
      console.warn('⚠️ No instruments returned from Bybit API.');
      return;
    }

    // 2. Fetch 24h market tickers to rank by turnover
    console.log('📊 Step 2/3: Fetching 24h market stats to rank top volume pairs...');
    const tickers = await bybitClient.getTickerPrice();
    const turnoverMap = {};
    if (Array.isArray(tickers)) {
      for (const t of tickers) {
        turnoverMap[t.symbol] = parseFloat(t.turnover24h || 0);
      }
    }

    // Rank symbols by 24h turnover
    const rankedSymbols = instruments
      .map(inst => ({
        symbol: inst.symbol,
        baseAsset: inst.baseAsset,
        turnover24h: turnoverMap[inst.symbol] || 0
      }))
      .sort((a, b) => b.turnover24h - a.turnover24h);

    const topSymbols = rankedSymbols.slice(0, 300);
    console.log(`✓ Selected top ${topSymbols.length} Bybit USDT perpetual pairs by 24h turnover.\n`);

    // Clean up any Bybit symbols outside top 300
    const topSymbolSet = new Set(topSymbols.map(s => s.symbol));
    const currentBybit = await DB.getWhitelistSymbols('BYBIT');
    for (const c of currentBybit) {
      if (!topSymbolSet.has(c.symbol)) {
        await DB.deleteWhitelistSymbol(c.id);
      }
    }

    const now = Date.now();
    let insertCount = 0;
    let stratCount = 0;

    for (let i = 0; i < topSymbols.length; i++) {
      const item = topSymbols[i];
      const sym = item.symbol;
      const rank = i + 1;
      const symId = `sym_bybit_${sym.toLowerCase()}`;

      let category = 'Bybit Futures';
      if (rank <= 50) category = 'Top 50 Bybit Ultra';
      else if (rank <= 150) category = 'Top 150 High Vol';
      else if (rank <= 300) category = 'Top 300 Mid Vol';

      const tags = JSON.stringify([`Rank#${rank}`, category, 'Bybit', '5m-15m']);

      // Upsert Whitelist Symbol
      await DB.run(`
        INSERT INTO whitelist_symbols (id, symbol, exchange, is_enabled, category, tags, created_at, updated_at)
        VALUES (?, ?, 'BYBIT', 1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          tags = excluded.tags,
          updated_at = excluded.updated_at
      `, [symId, sym, category, tags, now, now]);
      insertCount++;

      // Upsert 5m Strategy
      const stratId5m = `strat_bybit_${sym.toLowerCase()}_5m_dual`;
      await DB.run(`
        INSERT INTO symbol_strategies (
          id, symbol, exchange, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
          cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
          fvg_threshold_pct, swing_lookback, created_at, updated_at
        ) VALUES (
          ?, ?, 'BYBIT', ?, 'dual', '5m', 1, 1.0, 20, 'ISOLATED', 'MARKET',
          14, 21, 14, 2.0, 0.35, 1.5,
          1.5, 30, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          strategy_type = excluded.strategy_type,
          timeframe = excluded.timeframe,
          is_enabled = excluded.is_enabled,
          updated_at = excluded.updated_at
      `, [stratId5m, sym, `${sym} Bybit Dual 5m Pro`, now, now]);
      stratCount++;

      // Upsert 15m Strategy
      const stratId15m = `strat_bybit_${sym.toLowerCase()}_15m_dual`;
      await DB.run(`
        INSERT INTO symbol_strategies (
          id, symbol, exchange, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
          cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
          fvg_threshold_pct, swing_lookback, created_at, updated_at
        ) VALUES (
          ?, ?, 'BYBIT', ?, 'dual', '15m', 1, 1.0, 20, 'ISOLATED', 'MARKET',
          14, 21, 14, 2.0, 0.35, 1.5,
          1.5, 30, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          strategy_type = excluded.strategy_type,
          timeframe = excluded.timeframe,
          is_enabled = excluded.is_enabled,
          updated_at = excluded.updated_at
      `, [stratId15m, sym, `${sym} Bybit Dual 15m Pro`, now, now]);
      stratCount++;
    }

    console.log(`✓ Inserted/Updated ${insertCount} Bybit Whitelist Symbols and ${stratCount} Strategies (5m + 15m).\n`);

    if (preFetchCandles) {
      console.log('🕯️ Pre-fetching Bybit candles in background...');
    }

    console.log('🎉 BYBIT 300 SYMBOLS IMPORT COMPLETED SUCCESSFULLY!\n');
    return { symbols: insertCount, strategies: stratCount };
  } catch (err) {
    console.error('❌ Error during Bybit symbol import:', err.message);
    throw err;
  }
}

if (require.main === module) {
  const preFetch = process.argv.includes('--fetch-candles');
  importBybitSymbols(preFetch).then(() => {
    console.log('Done.');
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

module.exports = importBybitSymbols;
