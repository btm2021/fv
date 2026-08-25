/**
 * 24/7 Timeframe-Aligned Background Market Scanner Engine
 */
const DB = require('./db');
const binanceClient = require('./binanceClient');
const strategyEngine = require('./strategyEngine');
const tradeExecutor = require('./tradeExecutor');
const notification = require('./notification');
const logger = require('./logger');

class ScannerEngine {
  constructor() {
    this.isRunning = false;
    this.isScanning = false;
    this.scanIntervalTimer = null;
    this.positionMonitorTimer = null;
    this.lastScanTime = null;
    this.lastScanDurationMs = 0;
    this.stats = {
      totalScansRun: 0,
      totalSignalsFound: 0,
      lastError: null
    };
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    logger.info('SCANNER', '══════════════════════════════════════════════════════════════════════');
    logger.info('SCANNER', '🚀 24/7 SMC + ATRBOT MARKET SCANNER ENGINE INITIALIZED (CAUSAL V2.7)');
    logger.info('SCANNER', '══════════════════════════════════════════════════════════════════════');

    // 1. Initial warm-up scan on startup
    setTimeout(() => {
      logger.info('SCANNER', 'Starting initial warm-up scan across all active Whitelist symbols...');
      this.executeScanCycle().catch(err => logger.error('SCANNER', `Initial Scan Error: ${err.message}`));
    }, 1500);

    // 2. Schedule timeframe aligned clock ticks every 1 second
    this.scanIntervalTimer = setInterval(() => this.checkTimeframeTriggers(), 1000);

    // 3. Fast Position Monitor: Check open trades against live prices every 5s
    this.positionMonitorTimer = setInterval(() => this.monitorOpenPositions(), 5000);
  }

  stop() {
    this.isRunning = false;
    if (this.scanIntervalTimer) clearInterval(this.scanIntervalTimer);
    if (this.positionMonitorTimer) clearInterval(this.positionMonitorTimer);
    logger.warn('SCANNER', '🛑 24/7 Scanner Engine Stopped.');
  }

  /**
   * Checks if current second matches any active timeframe boundaries (e.g. 5m close + 2s)
   */
  async checkTimeframeTriggers() {
    if (!this.isRunning || this.isScanning) return;

    const isScannerActive = (await DB.getSetting('is_scanner_active', '1')) === '1';
    if (!isScannerActive) return;

    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();

    // Trigger 5m scan at XX:00:02, XX:05:02, XX:10:02, XX:15:02... (2s grace for candle settlement)
    const is5mBoundary = (minutes % 5 === 0) && (seconds === 2);
    // Trigger 15m scan at XX:00:03, XX:15:03, XX:30:03...
    const is15mBoundary = (minutes % 15 === 0) && (seconds === 3);
    // Trigger 1h boundary
    const is1hBoundary = (minutes === 0) && (seconds === 4);

    if (is5mBoundary || is15mBoundary || is1hBoundary) {
      const tfLabel = is1hBoundary ? '1h' : (is15mBoundary ? '15m' : '5m');
      logger.info('TIMEFRAME', `⏰ Boundary reached: [${tfLabel}] closed at ${now.toISOString().substring(11, 19)}. Initiating scan cycle...`);
      this.executeScanCycle().catch(err => logger.error('SCANNER', `Scan Cycle Error: ${err.message}`));
    }
  }

  /**
   * Executes full market scan across all active Whitelist symbol strategies
   */
  async executeScanCycle() {
    if (this.isScanning) return;
    this.isScanning = true;
    const startTime = Date.now();

    try {
      const activeStrategies = await DB.getAllEnabledStrategies();
      if (!activeStrategies || activeStrategies.length === 0) {
        logger.warn('SCANNER', 'No enabled whitelist strategies found in database.');
        this.isScanning = false;
        return;
      }

      const targetBuffer = Number(await DB.getSetting('candle_buffer_limit', '1500')) || 1500;

      // Group strategies by (symbol, timeframe) so we only fetch candles ONCE per symbol/timeframe!
      const grouped = {};
      for (const strat of activeStrategies) {
        const key = `${strat.symbol}_${strat.timeframe}`;
        if (!grouped[key]) grouped[key] = { symbol: strat.symbol, timeframe: strat.timeframe, strats: [] };
        grouped[key].strats.push(strat);
      }

      const uniquePairs = Object.keys(grouped).length;
      logger.info('SCANNER', `Scanning ${activeStrategies.length} strategies across ${uniquePairs} unique symbol/timeframe pairs...`);

      let newSignalsCount = 0;
      const groupList = Object.values(grouped);
      const BATCH_CONCURRENCY = 6; // Scan 6 symbols in parallel

      for (let i = 0; i < groupList.length; i += BATCH_CONCURRENCY) {
        const chunk = groupList.slice(i, i + BATCH_CONCURRENCY);
        await Promise.all(chunk.map(async (group) => {
          try {
            // 1. Sync & update cached candles in SQLite
            const candles = await binanceClient.syncCandles(group.symbol, group.timeframe, targetBuffer);
            if (!candles || candles.length < 35) return;

            // 2. Run each strategy configured for this symbol/timeframe
            for (const strat of group.strats) {
              const signalResult = strategyEngine.evaluate(candles, strat);
              if (signalResult) {
                // Check if we already registered this signal timestamp
                const existingSig = await DB.get(`
                  SELECT id FROM signals_alerts
                  WHERE symbol = ? AND strategy_id = ? AND timestamp = ?
                `, [signalResult.symbol, signalResult.strategy_id, signalResult.timestamp]);

                if (!existingSig) {
                  // Save Signal to SQLite
                  const sigId = await DB.saveSignal(signalResult);
                  signalResult.id = sigId;
                  newSignalsCount++;
                  this.stats.totalSignalsFound++;

                  logger.signal('SIGNAL', `🔥 [NEW SIGNAL] ${signalResult.symbol} (${signalResult.timeframe}) -> ${signalResult.signal_type} (${signalResult.direction}) | Entry: ${signalResult.entry_price} | TP1: ${signalResult.tp1_price} (+${signalResult.tp1_pct.toFixed(1)}%) | TP2: ${signalResult.tp2_price} (+${signalResult.tp2_pct.toFixed(1)}%) | SL: ${signalResult.sl_price} (-${signalResult.sl_pct.toFixed(1)}%) | R:R: 1:${signalResult.rr_ratio.toFixed(2)} | ATR: ${signalResult.atr_pct.toFixed(2)}%`);

                  // Open Trade in Position Manager
                  await tradeExecutor.openPositionFromSignal(signalResult);

                  // Broadcast & Alert
                  await notification.sendSignalAlert(signalResult);
                }
              }
            }
          } catch (err) {
            logger.error('SCANNER', `Error evaluating ${group.symbol}: ${err.message}`);
          }
        }));
      }

      this.lastScanTime = Date.now();
      this.lastScanDurationMs = Date.now() - startTime;
      this.stats.totalScansRun++;

      logger.success('SCANNER', `Scan cycle finished in ${this.lastScanDurationMs}ms. Detected ${newSignalsCount} actionable signals.`);

      // Broadcast scanner heartbeat to UI
      notification.broadcast('SCANNER_HEARTBEAT', await this.getStatus());

    } catch (err) {
      logger.error('SCANNER', `Fatal scan error: ${err.message}`);
      this.stats.lastError = err.message;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Fast position monitor: fetches ticker prices and updates active trades
   */
  async monitorOpenPositions() {
    const activePositions = await DB.getActivePositions();
    if (!activePositions || activePositions.length === 0) return;

    try {
      // Fetch current ticker prices
      const tickers = await binanceClient.getTickerPrice();
      if (!Array.isArray(tickers)) return;

      const priceMap = {};
      for (const t of tickers) {
        priceMap[t.symbol] = parseFloat(t.price);
      }

      await tradeExecutor.updateActivePositions(priceMap);

      // Broadcast updated positions to UI
      notification.broadcast('POSITIONS_UPDATE', {
        positions: await DB.getActivePositions(),
        stats: await DB.getPerformanceStats()
      });
    } catch (err) {
      // Non-blocking ticker error
    }
  }

  async getStatus() {
    const whitelist = await DB.getWhitelistSymbols();
    const strats = await DB.getAllEnabledStrategies();
    const perf = await DB.getPerformanceStats();

    return {
      isRunning: this.isRunning,
      isScanning: this.isScanning,
      lastScanTime: this.lastScanTime,
      lastScanDurationMs: this.lastScanDurationMs,
      totalScansRun: this.stats.totalScansRun,
      totalSignalsFound: this.stats.totalSignalsFound,
      activeSymbolsCount: whitelist.filter(w => w.is_enabled).length,
      activeStrategiesCount: strats.length,
      performance: perf,
      lastError: this.stats.lastError
    };
  }
}

module.exports = new ScannerEngine();
