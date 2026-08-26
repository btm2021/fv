/**
 * Bybit V5 Public Linear WebSocket Real-Time Price Stream Manager
 * Connects to wss://stream.bybit.com/v5/public/linear
 * Subscribes to live tickers and streams real-time prices for Bybit positions
 */
const { WebSocket } = require('ws');
const DB = require('./db');
const tradeExecutor = require('./tradeExecutor');
const notification = require('./notification');
const logger = require('./logger');

class BybitWsManager {
  constructor() {
    this.ws = null;
    this.livePriceMap = {};
    this.subscribedSymbols = new Set();
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.isReconnecting = false;
    this.lastBroadcastTime = 0;
    this.broadcastThrottleMs = 300;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const wsUrl = 'wss://stream.bybit.com/v5/public/linear';
    logger.info('BYBIT_WS', `Connecting to Bybit V5 Live WebSocket: ${wsUrl}...`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        logger.success('BYBIT_WS', '⚡ Connected to Bybit V5 Linear Ticker Stream. Real-time feed ACTIVE.');
        this.startPing();
        this.subscribeActiveSymbols();
      });

      this.ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.topic && msg.topic.startsWith('tickers.') && msg.data) {
            const sym = msg.data.symbol;
            const price = parseFloat(msg.data.lastPrice);
            if (sym && !isNaN(price)) {
              this.livePriceMap[sym] = price;
            }
          }
        } catch (err) {
          // non-blocking
        }
      });

      this.ws.on('error', (err) => {
        logger.error('BYBIT_WS', `Bybit WebSocket Error: ${err.message}`);
      });

      this.ws.on('close', (code) => {
        logger.warn('BYBIT_WS', `Bybit WebSocket closed (Code ${code}). Reconnecting in 3s...`);
        this.stopPing();
        this.scheduleReconnect();
      });

    } catch (e) {
      logger.error('BYBIT_WS', `Failed to initialize Bybit WebSocket: ${e.message}`);
      this.scheduleReconnect();
    }
  }

  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, 20000);
  }

  stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  async subscribeSymbols(symbols) {
    if (!symbols || symbols.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const newSyms = symbols.filter(s => !this.subscribedSymbols.has(s.toUpperCase()));
    if (newSyms.length === 0) return;

    // Chunk subscriptions into batches of 10
    for (let i = 0; i < newSyms.length; i += 10) {
      const chunk = newSyms.slice(i, i + 10);
      const args = chunk.map(s => `tickers.${s.toUpperCase()}`);
      this.ws.send(JSON.stringify({ op: 'subscribe', args: args }));
      chunk.forEach(s => this.subscribedSymbols.add(s.toUpperCase()));
    }
  }

  async subscribeActiveSymbols() {
    try {
      const symbols = await DB.getWhitelistSymbols('BYBIT');
      const symList = symbols.map(s => s.symbol);
      if (symList.length > 0) {
        await this.subscribeSymbols(symList.slice(0, 100)); // Subscribe top active
      }
    } catch (e) {
      // non-blocking
    }
  }

  getLivePrice(symbol) {
    if (!symbol) return null;
    return this.livePriceMap[symbol.toUpperCase()] || null;
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
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

module.exports = new BybitWsManager();
