/**
 * Unified Multi-Exchange Registry & Factory
 * Manages standardized adapters for Binance, Bybit, OKX, and future exchanges
 */
const binanceExchange = require('./binanceExchange');
const bybitExchange = require('./bybitExchange');
const okxExchange = require('./okxExchange');

const EXCHANGES = {
  BINANCE: binanceExchange,
  BYBIT: bybitExchange,
  OKX: okxExchange
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
}

module.exports = new ExchangeManager();
