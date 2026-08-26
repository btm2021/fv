/**
 * Unified Multi-Exchange Registry & Factory
 * Manages standardized adapters for Binance, Bybit, OKX, and future exchanges
 */
const binanceExchange = require('./binanceExchange');
const bybitExchange = require('./bybitExchange');
const okxExchange = require('./okxExchange');
const bitgetExchange = require('./bitgetExchange');
const gateExchange = require('./gateExchange');
const bingxExchange = require('./bingxExchange');

const EXCHANGES = {
  BINANCE: binanceExchange,
  BYBIT: bybitExchange,
  OKX: okxExchange,
  BITGET: bitgetExchange,
  GATE: gateExchange,
  BINGX: bingxExchange
};

class ExchangeManager {
  getExchange(exchangeId) {
    if (!exchangeId) return EXCHANGES.BINANCE;
    const key = exchangeId.toUpperCase();
    return EXCHANGES[key] || EXCHANGES.BINANCE;
  }

  getAllExchanges() {
    return Object.values(EXCHANGES);
  }

  getExchangeMap() {
    return EXCHANGES;
  }

  hasExchange(exchangeId) {
    return !!EXCHANGES[exchangeId.toUpperCase()];
  }

  connectAllWebSockets() {
    for (const ex of Object.values(EXCHANGES)) {
      if (typeof ex.connectWs === 'function') {
        ex.connectWs();
      }
    }
  }

  getLivePrice(symbol, exchangeId = 'BINANCE') {
    const ex = this.getExchange(exchangeId);
    return ex ? ex.getLivePrice(symbol) : null;
  }

  /**
   * Native Source-Code Discovery & Ingestion of 90% Perpetual Symbols (CCXT Pro)
   * Supports Binance, Bybit, OKX, Bitget, Gate.io, BingX directly without auxiliary scripts
   */
  async discoverAndSeedPerpetuals(targetExchangeId = null) {
    const DB = require('../db');
    const ccxt = require('ccxt');

    const configs = [
      { id: 'BINANCE', name: 'Binance Futures (USDT-M)', exClass: 'binance', options: { defaultType: 'future' } },
      { id: 'BYBIT', name: 'Bybit Linear Perpetual', exClass: 'bybit', options: { defaultType: 'swap' } },
      { id: 'OKX', name: 'OKX Perpetual Swap', exClass: 'okx', options: { defaultType: 'swap' } },
      { id: 'BITGET', name: 'Bitget USDT-M Perpetual', exClass: 'bitget', options: { defaultType: 'swap' } },
      { id: 'GATE', name: 'Gate.io Perpetual', exClass: 'gate', options: { defaultType: 'swap' } },
      { id: 'BINGX', name: 'BingX Perpetual', exClass: 'bingx', options: { defaultType: 'swap' } }
    ];

    const targets = targetExchangeId
      ? configs.filter(c => c.id === targetExchangeId.toUpperCase())
      : configs;

    const summary = [];
    const now = Date.now();

    const riskPct = Number(await DB.getSetting('risk_pct_per_trade', '1.0'));
    const leverage = Number(await DB.getSetting('max_leverage', '20'));
    const marginMode = await DB.getSetting('margin_mode', 'ISOLATED');

    for (const cfg of targets) {
      try {
        const client = new ccxt[cfg.exClass]({
          enableRateLimit: true,
          timeout: 8000,
          options: cfg.options
        });

        const markets = await client.loadMarkets();
        const perpMarkets = Object.values(markets).filter(m => {
          const isSwap = m.swap || m.future || m.type === 'swap' || m.type === 'future';
          const isUsdt = m.quote === 'USDT' || m.settle === 'USDT';
          const isActive = m.active !== false;
          return isSwap && isUsdt && isActive;
        });

        if (perpMarkets.length === 0) continue;

        let turnoverMap = {};
        try {
          const tickers = await client.fetchTickers();
          for (const [sym, t] of Object.entries(tickers)) {
            const normSym = sym.replace(/[/:]/g, '');
            const quoteVol = parseFloat(t.quoteVolume || t.baseVolume || 0);
            turnoverMap[normSym] = quoteVol;
            turnoverMap[sym] = quoteVol;
            if (t.symbol) turnoverMap[t.symbol] = quoteVol;
          }
        } catch (e) {}

        const ranked = perpMarkets.map(m => {
          let cleanSymbol = m.id ? m.id.replace(/[-_:/]/g, '').toUpperCase() : m.symbol.replace(/[/:]/g, '').toUpperCase();
          if (cleanSymbol.includes('USDT') && !cleanSymbol.endsWith('USDT')) {
            cleanSymbol = cleanSymbol.split('USDT')[0] + 'USDT';
          }
          const turnover = turnoverMap[cleanSymbol] || turnoverMap[m.symbol] || turnoverMap[m.id] || 0;
          return { symbol: cleanSymbol, turnover };
        });

        const uniqueMap = new Map();
        for (const item of ranked) {
          if (!uniqueMap.has(item.symbol) || uniqueMap.get(item.symbol).turnover < item.turnover) {
            uniqueMap.set(item.symbol, item);
          }
        }

        const uniqueRanked = Array.from(uniqueMap.values()).sort((a, b) => b.turnover - a.turnover);
        const target90Count = Math.max(1, Math.floor(uniqueRanked.length * 0.9));
        const selectedSymbols = uniqueRanked.slice(0, target90Count);

        let insertCount = 0;
        try {
          await DB.run('BEGIN TRANSACTION');
          for (let i = 0; i < selectedSymbols.length; i++) {
            const sym = selectedSymbols[i].symbol;
            const rank = i + 1;
            const symId = `sym_${cfg.id.toLowerCase()}_${sym.toLowerCase()}`;
            let category = `${cfg.id} Top Liquidity`;
            if (rank <= 50) category = `Top 50 ${cfg.id} Ultra`;
            else if (rank <= 200) category = `Top 200 High Vol`;

            const tags = JSON.stringify([`Rank#${rank}`, category, cfg.id, 'Perpetual', '5m-15m']);

            await DB.run(`
              INSERT INTO whitelist_symbols (id, symbol, exchange, is_enabled, category, tags, created_at, updated_at)
              VALUES (?, ?, ?, 1, ?, ?, ?, ?)
              ON CONFLICT(symbol, exchange) DO UPDATE SET
                category = excluded.category,
                tags = excluded.tags,
                updated_at = excluded.updated_at
            `, [symId, sym, cfg.id, category, tags, now, now]);

            const stratId5m = `strat_${cfg.id.toLowerCase()}_${sym.toLowerCase()}_5m_dual`;
            await DB.run(`
              INSERT INTO symbol_strategies (
                id, symbol, exchange, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
                cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
                fvg_threshold_pct, swing_lookback, created_at, updated_at
              ) VALUES (
                ?, ?, ?, ?, 'dual', '5m', 1, ?, ?, ?, 'MARKET',
                14, 21, 14, 2.0, 0.35, 1.5,
                1.5, 30, ?, ?
              )
              ON CONFLICT(id) DO UPDATE SET
                exchange = excluded.exchange,
                strategy_name = excluded.strategy_name,
                is_enabled = excluded.is_enabled,
                risk_pct = excluded.risk_pct,
                leverage = excluded.leverage,
                margin_mode = excluded.margin_mode,
                updated_at = excluded.updated_at
            `, [stratId5m, sym, cfg.id, `${sym} ${cfg.id} Dual 5m Pro`, riskPct, leverage, marginMode, now, now]);

            const stratId15m = `strat_${cfg.id.toLowerCase()}_${sym.toLowerCase()}_15m_dual`;
            await DB.run(`
              INSERT INTO symbol_strategies (
                id, symbol, exchange, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
                cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
                fvg_threshold_pct, swing_lookback, created_at, updated_at
              ) VALUES (
                ?, ?, ?, ?, 'dual', '15m', 1, ?, ?, ?, 'MARKET',
                14, 21, 14, 2.0, 0.35, 1.5,
                1.5, 30, ?, ?
              )
              ON CONFLICT(id) DO UPDATE SET
                exchange = excluded.exchange,
                strategy_name = excluded.strategy_name,
                is_enabled = excluded.is_enabled,
                risk_pct = excluded.risk_pct,
                leverage = excluded.leverage,
                margin_mode = excluded.margin_mode,
                updated_at = excluded.updated_at
            `, [stratId15m, sym, cfg.id, `${sym} ${cfg.id} Dual 15m Pro`, riskPct, leverage, marginMode, now, now]);

            insertCount++;
          }
          await DB.run('COMMIT');
        } catch (dbErr) {
          try { await DB.run('ROLLBACK'); } catch(e) {}
        }

        summary.push({ exchange: cfg.id, total_discovered: perpMarkets.length, seeded_90_pct: insertCount });
      } catch (err) {
        summary.push({ exchange: cfg.id, error: err.message });
      }
    }
    return summary;
  }
}

module.exports = new ExchangeManager();
