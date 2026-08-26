/**
 * Binance Futures WebSocket Real-Time Price Stream Manager
 * Subscribes to live market prices for all USDT pairs via `!miniTicker@arr`
 * Updates Active Positions, Unrealized PnL, and Trailing Stop-Loss in sub-second real-time
 * Continuously streams real-time prices & position recalculations to the Web UI
 */
const { WebSocket } = require('ws');
const DB = require('./db');
const tradeExecutor = require('./tradeExecutor');
const notification = require('./notification');
const logger = require('./logger');

class BinanceWsManager {
  constructor() {
    this.ws = null;
    this.livePriceMap = {};
    this.reconnectTimer = null;
    this.isReconnecting = false;
    this.lastBroadcastTime = 0;
    this.broadcastThrottleMs = 300; // Broadcast live ticks to Web UI every 300ms for smooth real-time ticks
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const wsUrl = 'wss://fstream.binance.com/ws/!miniTicker@arr';
    logger.info('BINANCE_WS', `Connecting to Binance Futures Live Price Stream: ${wsUrl}...`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        logger.success('BINANCE_WS', '⚡ Connected to Binance Futures Live Ticker Stream (!miniTicker@arr). Real-time price feed ACTIVE.');
      });

      this.ws.on('message', async (data) => {
        try {
          const tickers = JSON.parse(data);
          if (!Array.isArray(tickers)) return;

          // Update in-memory price map
          for (let i = 0; i < tickers.length; i++) {
            const t = tickers[i];
            if (t.s && t.c) {
              this.livePriceMap[t.s] = parseFloat(t.c);
            }
          }

          // Process active positions & stream to Web UI
          await this.processLiveTicks();

        } catch (err) {
          // non-blocking
        }
      });

      this.ws.on('error', (err) => {
        logger.error('BINANCE_WS', `Binance WebSocket Error: ${err.message}`);
      });

      this.ws.on('close', (code, reason) => {
        logger.warn('BINANCE_WS', `Binance WebSocket closed (Code ${code}). Reconnecting in 3s...`);
        this.scheduleReconnect();
      });

      this.ws.on('ping', () => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.pong();
        }
      });

    } catch (e) {
      logger.error('BINANCE_WS', `Failed to initialize WebSocket: ${e.message}`);
      this.scheduleReconnect();
    }
  }

  async processLiveTicks() {
    const activePositions = await DB.getActivePositions();
    if (activePositions && activePositions.length > 0) {
      // Update active positions: checks TP1, TP2, SL, Breakeven Trailing, Liquidation Hits
      await tradeExecutor.updateActivePositions(this.livePriceMap);
    }

    // Throttle UI broadcast (every 300ms)
    const now = Date.now();
    if (now - this.lastBroadcastTime >= this.broadcastThrottleMs) {
      this.lastBroadcastTime = now;
      const updatedPositions = activePositions && activePositions.length > 0 ? await DB.getActivePositions() : [];
      const stats = await DB.getPerformanceStats();

      notification.broadcast('POSITIONS_UPDATE', {
        positions: updatedPositions,
        stats: stats,
        livePrices: this.livePriceMap
      });
    }
  }

  getLivePrice(symbol) {
    if (!symbol) return null;
    return this.livePriceMap[symbol.toUpperCase()] || null;
  }

  getActivePriceSubset(positions) {
    const subset = {};
    if (positions && Array.isArray(positions)) {
      for (const p of positions) {
        if (this.livePriceMap[p.symbol]) {
          subset[p.symbol] = this.livePriceMap[p.symbol];
        }
      }
    }
    return subset;
  }

  getPrice(symbol) {
    return this.livePriceMap[symbol] || null;
  }

  scheduleReconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.isReconnecting = false;
      this.connect();
    }, 3000);
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = new BinanceWsManager();
