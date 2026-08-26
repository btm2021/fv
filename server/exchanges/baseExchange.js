/**
 * Base Exchange Adapter Interface
 * Provides standardized methods for REST data fetching, rate-limiting, and WebSocket streams
 */
class BaseExchangeAdapter {
  constructor(config = {}) {
    this.id = config.id || 'BASE';
    this.name = config.name || 'Base Exchange';
    this.icon = config.icon || '🌐';
    this.defaultTargetSymbols = config.defaultTargetSymbols || 100;
    this.pacingConfig = config.pacingConfig || {
      tasksPerBucket: 100,
      microBatchSize: 5,
      tickIntervalMs: 3000,
      ratePerMin: 100,
      totalBuckets: 5
    };

    // Fee & Margin Specs
    this.takerFeeRate = config.takerFeeRate || 0.0005; // 0.05%
    this.makerFeeRate = config.makerFeeRate || 0.0002; // 0.02%
    this.mmrRate = config.mmrRate || 0.005;           // 0.5% MMR

    // Internal rate pacing state
    this.lastRequestTime = 0;
    this.minRequestIntervalMs = config.minRequestIntervalMs || 100;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async fetchWithRateLimit(url, options = {}) {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestIntervalMs) {
      await this.sleep(this.minRequestIntervalMs - elapsed);
    }
    this.lastRequestTime = Date.now();

    try {
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `NodeMultiExchangeEngine/${this.id}`,
          ...(options.headers || {})
        },
        ...options
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`[${this.id}] HTTP ${res.status}: ${txt}`);
      }

      return await res.json();
    } catch (err) {
      console.error(`[${this.id} Client Error] ${url} ->`, err.message);
      throw err;
    }
  }

  /**
   * Abstract Methods to be implemented by child exchange adapters:
   */
  async getExchangeInfo() {
    throw new Error('getExchangeInfo() must be implemented');
  }

  async getTickerPrice(symbol = null) {
    throw new Error('getTickerPrice() must be implemented');
  }

  async syncCandles(symbol, timeframe = '5m', targetBuffer = 1000) {
    throw new Error('syncCandles() must be implemented');
  }

  mapTimeframe(tf) {
    return tf;
  }

  getLivePrice(symbol) {
    return null;
  }
}

module.exports = BaseExchangeAdapter;
