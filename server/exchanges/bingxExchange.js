/**
 * BingX Swap Perpetual Standardized Exchange Adapter (CCXT Pro Supported)
 */
const BaseExchangeAdapter = require('./baseExchange');
const ccxt = require('ccxt');

const BINGX_API_BASE = 'https://open-api.bingx.com';

class BingXExchangeAdapter extends BaseExchangeAdapter {
  constructor() {
    super({
      id: 'BINGX',
      name: 'BingX Perpetual',
      icon: '💠',
      defaultTargetSymbols: 740,
      takerFeeRate: 0.0005,  // 0.05% BingX Taker
      makerFeeRate: 0.0002,  // 0.02% BingX Maker
      mmrRate: 0.005,        // 0.5% MMR
      minRequestIntervalMs: 120,
      pacingConfig: {
        tasksPerBucket: 250,
        microBatchSize: 12,
        tickIntervalMs: 1500,
        ratePerMin: 480,
        totalBuckets: 5
      }
    });

    this.livePriceMap = {};
    this.ccxtClient = new ccxt.bingx({
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
      const url = `${BINGX_API_BASE}/openApi/swap/v2/quote/contracts`;
      const res = await this.fetchWithRateLimit(url);
      if (res && res.code === 0 && res.data && Array.isArray(res.data)) {
        return res.data
          .filter(s => s.status === 1 && (s.symbol || '').endsWith('-USDT'))
          .map(s => {
            const sym = s.symbol.replace('-', '');
            return {
              symbol: sym,
              contractName: s.symbol,
              baseAsset: s.asset || s.symbol.split('-')[0],
              quoteAsset: 'USDT',
              pricePrecision: parseInt(s.pricePrecision || 2, 10),
              quantityPrecision: parseFloat(s.stepSize || 0.001),
              raw: s
            };
          });
      }
    } catch (e) {
      // CCXT Fallback
      try {
        const markets = await this.ccxtClient.loadMarkets();
        return Object.values(markets)
          .filter(m => m.swap && m.quote === 'USDT' && m.active !== false)
          .map(m => ({
            symbol: m.id ? m.id.replace('-', '') : m.symbol.replace(/[/:]/g, ''),
            contractName: m.id || m.symbol,
            baseAsset: m.base,
            quoteAsset: m.quote,
            pricePrecision: m.precision ? m.precision.price : 2,
            quantityPrecision: m.precision ? m.precision.amount : 0.001,
            raw: m
          }));
      } catch (err) {}
    }
    return [];
  }

  async getTickerPrice(symbol = null) {
    try {
      let url = `${BINGX_API_BASE}/openApi/swap/v2/quote/ticker`;
      if (symbol) {
        const rawSym = symbol.includes('-') ? symbol : (symbol.endsWith('USDT') ? `${symbol.substring(0, symbol.length - 4)}-USDT` : symbol);
        url += `?symbol=${rawSym}`;
      }
      const res = await this.fetchWithRateLimit(url);
      const list = res && res.code === 0 && res.data ? (Array.isArray(res.data) ? res.data : [res.data]) : [];
      const result = list.filter(t => t && t.symbol).map(t => {
        const sym = t.symbol.replace('-', '');
        const last = parseFloat(t.lastPrice || 0);
        if (sym && !isNaN(last)) {
          this.livePriceMap[sym] = last;
        }
        return {
          symbol: sym,
          contractName: t.symbol,
          lastPrice: last,
          high24h: parseFloat(t.highPrice || 0),
          low24h: parseFloat(t.lowPrice || 0),
          volume24h: parseFloat(t.volume || 0),
          turnover24h: parseFloat(t.quoteVolume || 0),
          priceChangePct: parseFloat(t.priceChangePercent || 0)
        };
      });
      return result;
    } catch (e) {
      try {
        const tickers = await this.ccxtClient.fetchTickers();
        return Object.values(tickers).map(t => {
          const sym = (t.symbol || '').replace(/[/:]/g, '');
          const last = parseFloat(t.last || 0);
          if (sym && !isNaN(last)) {
            this.livePriceMap[sym] = last;
          }
          return {
            symbol: sym,
            lastPrice: last,
            high24h: parseFloat(t.high || 0),
            low24h: parseFloat(t.low || 0),
            volume24h: parseFloat(t.baseVolume || 0),
            turnover24h: parseFloat(t.quoteVolume || 0),
            priceChangePct: parseFloat(t.percentage || 0)
          };
        });
      } catch (err) {}
    }
    return [];
  }

  async syncCandles(symbol, timeframe = '5m', targetBuffer = 1000) {
    const sym = symbol.toUpperCase();
    const rawSym = sym.includes('-') ? sym : (sym.endsWith('USDT') ? `${sym.substring(0, sym.length - 4)}-USDT` : sym);
    const interval = this.mapTimeframe(timeframe);
    const limit = Math.min(targetBuffer, 1000);
    const url = `${BINGX_API_BASE}/openApi/swap/v3/quote/klines?symbol=${rawSym}&interval=${interval}&limit=${limit}`;

    try {
      const res = await this.fetchWithRateLimit(url);
      if (res && res.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
        return res.data.map(k => ({
          time: Math.floor(parseInt(k.time, 10) / 1000),
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
          volume: parseFloat(k.volume)
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

module.exports = new BingXExchangeAdapter();
