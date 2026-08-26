/**
 * Gate.io USDT Perpetual Standardized Exchange Adapter (CCXT Pro Supported)
 */
const BaseExchangeAdapter = require('./baseExchange');
const ccxt = require('ccxt');

const GATE_API_BASE = 'https://api.gateio.ws';

class GateExchangeAdapter extends BaseExchangeAdapter {
  constructor() {
    super({
      id: 'GATE',
      name: 'Gate.io Perpetual',
      icon: '🚪',
      defaultTargetSymbols: 840,
      takerFeeRate: 0.0005,  // 0.05% Gate Taker
      makerFeeRate: 0.00015, // 0.015% Gate Maker
      mmrRate: 0.005,        // 0.5% MMR
      minRequestIntervalMs: 120,
      pacingConfig: {
        tasksPerBucket: 100,
        microBatchSize: 6,
        tickIntervalMs: 3000,
        ratePerMin: 120,
        totalBuckets: 5
      }
    });

    this.livePriceMap = {};
    this.ccxtClient = new ccxt.gate({
      enableRateLimit: true,
      options: { defaultType: 'swap' }
    });
  }

  mapTimeframe(tf) {
    const map = {
      '1m': '1m',
      '3m': '3m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '2h': '2h',
      '4h': '4h',
      '1d': '1d'
    };
    return map[tf] || '5m';
  }

  async getExchangeInfo() {
    try {
      const url = `${GATE_API_BASE}/api/v4/futures/usdt/contracts`;
      const res = await this.fetchWithRateLimit(url);
      if (Array.isArray(res)) {
        return res
          .filter(s => !s.in_delisting && s.name.endsWith('_USDT'))
          .map(s => {
            const sym = s.name.replace('_', '');
            return {
              symbol: sym,
              contractName: s.name,
              baseAsset: s.name.split('_')[0],
              quoteAsset: 'USDT',
              pricePrecision: s.order_price_round ? String(s.order_price_round).split('.')[1]?.length || 2 : 2,
              quantityPrecision: parseFloat(s.quanto_multiplier || 1),
              raw: s
            };
          });
      }
    } catch (e) {
      // CCXT Fallback
      const markets = await this.ccxtClient.loadMarkets();
      return Object.values(markets)
        .filter(m => m.swap && m.quote === 'USDT' && m.active !== false)
        .map(m => ({
          symbol: m.id ? m.id.replace('_', '') : m.symbol.replace(/[/:]/g, ''),
          contractName: m.id || m.symbol,
          baseAsset: m.base,
          quoteAsset: m.quote,
          pricePrecision: m.precision ? m.precision.price : 2,
          quantityPrecision: m.precision ? m.precision.amount : 1,
          raw: m
        }));
    }
    return [];
  }

  async getTickerPrice(symbol = null) {
    try {
      let url = `${GATE_API_BASE}/api/v4/futures/usdt/tickers`;
      if (symbol) {
        const contract = symbol.includes('_') ? symbol : (symbol.endsWith('USDT') ? `${symbol.substring(0, symbol.length - 4)}_USDT` : symbol);
        url += `?contract=${contract}`;
      }
      const res = await this.fetchWithRateLimit(url);
      const list = Array.isArray(res) ? res : [res];
      return list.filter(t => t && t.contract).map(t => {
        const sym = t.contract.replace('_', '');
        return {
          symbol: sym,
          contractName: t.contract,
          lastPrice: parseFloat(t.last || 0),
          high24h: parseFloat(t.high_24h || 0),
          low24h: parseFloat(t.low_24h || 0),
          volume24h: parseFloat(t.volume_24h_base || t.volume_24h || 0),
          turnover24h: parseFloat(t.volume_24h_quote || t.volume_24h_settle || 0),
          priceChangePct: parseFloat(t.change_percentage || 0)
        };
      });
    } catch (e) {
      const tickers = await this.ccxtClient.fetchTickers();
      return Object.values(tickers).map(t => ({
        symbol: (t.symbol || '').replace(/[/:]/g, ''),
        lastPrice: parseFloat(t.last || 0),
        high24h: parseFloat(t.high || 0),
        low24h: parseFloat(t.low || 0),
        volume24h: parseFloat(t.baseVolume || 0),
        turnover24h: parseFloat(t.quoteVolume || 0),
        priceChangePct: parseFloat(t.percentage || 0)
      }));
    }
  }

  async syncCandles(symbol, timeframe = '5m', targetBuffer = 1000) {
    const sym = symbol.toUpperCase();
    const contract = sym.includes('_') ? sym : (sym.endsWith('USDT') ? `${sym.substring(0, sym.length - 4)}_USDT` : sym);
    const interval = this.mapTimeframe(timeframe);
    const limit = Math.min(targetBuffer, 1000);
    const url = `${GATE_API_BASE}/api/v4/futures/usdt/candlesticks?contract=${contract}&interval=${interval}&limit=${limit}`;

    try {
      const res = await this.fetchWithRateLimit(url);
      if (Array.isArray(res) && res.length > 0) {
        return res.map(k => ({
          time: parseInt(k.t, 10),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v)
        })).sort((a, b) => a.time - b.time);
      }
    } catch (e) {
      // CCXT Fallback
      const ohlcv = await this.ccxtClient.fetchOHLCV(`${sym.replace('USDT', '')}/USDT:USDT`, timeframe, undefined, limit);
      return ohlcv.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      })).sort((a, b) => a.time - b.time);
    }
    return [];
  }

  getLivePrice(symbol) {
    return this.livePriceMap[symbol.toUpperCase()] || null;
  }
}

module.exports = new GateExchangeAdapter();
