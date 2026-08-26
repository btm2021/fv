/**
 * Bitget USDT-M Perpetual Standardized Exchange Adapter (CCXT Pro Supported)
 */
const BaseExchangeAdapter = require('./baseExchange');
const ccxt = require('ccxt');

const BITGET_API_BASE = 'https://api.bitget.com';

class BitgetExchangeAdapter extends BaseExchangeAdapter {
  constructor() {
    super({
      id: 'BITGET',
      name: 'Bitget USDT-M Perpetual',
      icon: '🔵',
      defaultTargetSymbols: 680,
      takerFeeRate: 0.0006,  // 0.06% Bitget Taker VIP0
      makerFeeRate: 0.0002,  // 0.02% Bitget Maker VIP0
      mmrRate: 0.005,        // 0.5% MMR
      minRequestIntervalMs: 100,
      pacingConfig: {
        tasksPerBucket: 100,
        microBatchSize: 6,
        tickIntervalMs: 3000,
        ratePerMin: 120,
        totalBuckets: 5
      }
    });

    this.livePriceMap = {};
    this.ccxtClient = new ccxt.bitget({
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
      '1h': '1H',
      '2h': '2H',
      '4h': '4H',
      '1d': '1D'
    };
    return map[tf] || '5m';
  }

  async getExchangeInfo() {
    try {
      const url = `${BITGET_API_BASE}/api/v2/mix/market/contracts?productType=USDT-FUTURES`;
      const res = await this.fetchWithRateLimit(url);
      if (res && res.data && Array.isArray(res.data)) {
        return res.data
          .filter(s => s.symbolStatus === 'normal' && s.quoteCoin === 'USDT')
          .map(s => ({
            symbol: s.symbol,
            baseAsset: s.baseCoin,
            quoteAsset: s.quoteCoin,
            pricePrecision: parseInt(s.pricePlace || 2, 10),
            quantityPrecision: parseFloat(s.sizeMultiplier || 0.001),
            raw: s
          }));
      }
    } catch (e) {
      // CCXT Fallback
      const markets = await this.ccxtClient.loadMarkets();
      return Object.values(markets)
        .filter(m => m.swap && m.quote === 'USDT' && m.active !== false)
        .map(m => ({
          symbol: m.id || m.symbol.replace(/[/:]/g, ''),
          baseAsset: m.base,
          quoteAsset: m.quote,
          pricePrecision: m.precision ? m.precision.price : 2,
          quantityPrecision: m.precision ? m.precision.amount : 0.001,
          raw: m
        }));
    }
    return [];
  }

  async getTickerPrice(symbol = null) {
    try {
      let url = `${BITGET_API_BASE}/api/v2/mix/market/tickers?productType=USDT-FUTURES`;
      if (symbol) url += `&symbol=${symbol.toUpperCase()}`;
      const res = await this.fetchWithRateLimit(url);
      const list = res && res.data ? res.data : [];
      return list.map(t => {
        const last = parseFloat(t.lastPr || t.lastPrice || 0);
        const open = parseFloat(t.open24h || t.open || last);
        const changePct = open > 0 ? ((last - open) / open) * 100 : parseFloat(t.change24h || 0);
        return {
          symbol: t.symbol,
          lastPrice: last,
          high24h: parseFloat(t.high24h || 0),
          low24h: parseFloat(t.low24h || 0),
          volume24h: parseFloat(t.baseVolume || 0),
          turnover24h: parseFloat(t.usdtVolume || t.quoteVolume || 0),
          priceChangePct: changePct
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
    const interval = this.mapTimeframe(timeframe);
    const limit = Math.min(targetBuffer, 1000);
    const url = `${BITGET_API_BASE}/api/v2/mix/market/candles?symbol=${sym}&granularity=${interval}&productType=USDT-FUTURES&limit=${limit}`;

    try {
      const res = await this.fetchWithRateLimit(url);
      if (res && res.data && Array.isArray(res.data) && res.data.length > 0) {
        return res.data.map(k => ({
          time: Math.floor(parseInt(k[0], 10) / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5])
        })).sort((a, b) => a.time - b.time);
      }
    } catch (e) {
      // CCXT Fallback
      const ohlcv = await this.ccxtClient.fetchOHLCV(`${sym}/USDT:USDT`, timeframe, undefined, limit);
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

module.exports = new BitgetExchangeAdapter();
