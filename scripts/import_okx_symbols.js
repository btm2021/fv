/**
 * OKX USDT Swap / Perpetual Top 200 Symbols Discovery & Seeder
 * Ingests Top 200 OKX USDT pairs and creates 400 Strategies across 5m & 15m
 */
const DB = require('../server/db');
const okxExchange = require('../server/exchanges/okxExchange');

async function importOkxSymbols(preFetchCandles = false) {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('🚀 IMPORTING TOP 200 OKX USDT PERPETUAL SYMBOLS');
  console.log('══════════════════════════════════════════════════════════════\n');

  try {
    // 1. Fetch all Swap instruments
    console.log('📡 Step 1/3: Querying OKX V5 Swap Instruments...');
    const instruments = await okxExchange.getExchangeInfo();
    console.log(`✓ Discovered ${instruments.length} active OKX USDT Swap perpetual contracts.\n`);

    if (instruments.length === 0) {
      console.warn('⚠️ No instruments returned from OKX API.');
      return;
    }

    // 2. Fetch 24h market stats to rank top turnover pairs
    console.log('📊 Step 2/3: Fetching 24h market stats to rank top turnover pairs...');
    const tickers = await okxExchange.getTickerPrice();
    const turnoverMap = {};
    if (Array.isArray(tickers)) {
      for (const t of tickers) {
        turnoverMap[t.symbol] = parseFloat(t.turnover24h || 0);
      }
    }

    const rankedSymbols = instruments
      .map(inst => ({
        symbol: inst.symbol,
        instId: inst.instId,
        baseAsset: inst.baseAsset,
        turnover24h: turnoverMap[inst.symbol] || 0
      }))
      .sort((a, b) => b.turnover24h - a.turnover24h);

    const topSymbols = rankedSymbols.slice(0, 200);
    console.log(`✓ Selected top ${topSymbols.length} OKX USDT perpetual pairs by 24h turnover.\n`);

    // Clean up any OKX symbols outside top 200
    const topSymbolSet = new Set(topSymbols.map(s => s.symbol));
    const currentOkx = await DB.getWhitelistSymbols('OKX');
    for (const c of currentOkx) {
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
      const symId = `sym_okx_${sym.toLowerCase()}`;

      let category = 'OKX Futures';
      if (rank <= 50) category = 'Top 50 OKX Ultra';
      else if (rank <= 100) category = 'Top 100 High Vol';
      else if (rank <= 200) category = 'Top 200 Mid Vol';

      const tags = JSON.stringify([`Rank#${rank}`, category, 'OKX', '5m-15m']);

      // Upsert Whitelist Symbol
      await DB.run(`
        INSERT INTO whitelist_symbols (id, symbol, exchange, is_enabled, category, tags, created_at, updated_at)
        VALUES (?, ?, 'OKX', 1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category = excluded.category,
          tags = excluded.tags,
          updated_at = excluded.updated_at
      `, [symId, sym, category, tags, now, now]);
      insertCount++;

      // Upsert 5m Strategy
      const stratId5m = `strat_okx_${sym.toLowerCase()}_5m_dual`;
      await DB.run(`
        INSERT INTO symbol_strategies (
          id, symbol, exchange, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
          cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
          fvg_threshold_pct, swing_lookback, created_at, updated_at
        ) VALUES (
          ?, ?, 'OKX', ?, 'dual', '5m', 1, 1.0, 20, 'ISOLATED', 'MARKET',
          14, 21, 14, 2.0, 0.35, 1.5,
          1.5, 30, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          strategy_type = excluded.strategy_type,
          timeframe = excluded.timeframe,
          is_enabled = excluded.is_enabled,
          updated_at = excluded.updated_at
      `, [stratId5m, sym, `${sym} OKX Dual 5m Pro`, now, now]);
      stratCount++;

      // Upsert 15m Strategy
      const stratId15m = `strat_okx_${sym.toLowerCase()}_15m_dual`;
      await DB.run(`
        INSERT INTO symbol_strategies (
          id, symbol, exchange, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
          cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
          fvg_threshold_pct, swing_lookback, created_at, updated_at
        ) VALUES (
          ?, ?, 'OKX', ?, 'dual', '15m', 1, 1.0, 20, 'ISOLATED', 'MARKET',
          14, 21, 14, 2.0, 0.35, 1.5,
          1.5, 30, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          strategy_type = excluded.strategy_type,
          timeframe = excluded.timeframe,
          is_enabled = excluded.is_enabled,
          updated_at = excluded.updated_at
      `, [stratId15m, sym, `${sym} OKX Dual 15m Pro`, now, now]);
      stratCount++;
    }

    console.log(`✓ Inserted/Updated ${insertCount} OKX Whitelist Symbols and ${stratCount} Strategies (5m + 15m).\n`);

    if (preFetchCandles) {
      console.log('🕯️ Pre-fetching OKX candles in background...');
    }

    console.log('🎉 OKX 200 SYMBOLS IMPORT COMPLETED SUCCESSFULLY!\n');
    return { symbols: insertCount, strategies: stratCount };
  } catch (err) {
    console.error('❌ Error during OKX symbol import:', err.message);
    throw err;
  }
}

if (require.main === module) {
  const preFetch = process.argv.includes('--fetch-candles');
  importOkxSymbols(preFetch).then(() => {
    console.log('Done.');
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

module.exports = importOkxSymbols;
