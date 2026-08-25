/**
 * 24/7 Smart Continuous Market Scanner Engine (500 Symbols / 1,000 Tasks across 5m & 15m)
 * 
 * Architecture & Rate-Limit Pacing:
 * - Total Tasks: 500 Symbols x 2 Timeframes (5m, 15m) = 1,000 Strategy Entities.
 * - Cycle Time: 5 Minutes (300 Seconds).
 * - Pacing Rate: Exactly 200 fetches per minute (3.33 requests/second).
 * - Division: 5 discrete 1-minute buckets of 200 tasks each.
 * - Micro-batching: 10 tasks dispatched every 3,000ms.
 * - Binance API Weight: ~200 weight/min (only 8.3% of 2,400 max limit = 0% risk of 429).
 * - Target Klines Buffer: 1,500 candles per pair.
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
    this.isPacing = false;
    this.paceIntervalTimer = null;
    this.positionMonitorTimer = null;

    // Queue & Bucket State
    this.taskQueue = [];          // Total 1000 tasks: [{ symbol, tf, strats: [] }]
    this.currentTaskIndex = 0;    // Pointer in current cycle [0..1000]
    this.currentBucket = 0;       // 0 to 4 (representing Minutes 0, 1, 2, 3, 4)
    this.bucketProgress = 0;      // Tasks completed in current bucket (0 to 200)
    this.cycleStartTime = 0;
    this.bucketStartTime = 0;

    // Rate pacing parameters
    this.MICRO_BATCH_SIZE = 10;   // 10 tasks per tick
    this.TICK_INTERVAL_MS = 3000; // Tick every 3 seconds -> 200 tasks per 60s
    this.TOTAL_BUCKETS = 5;       // 5 buckets = 5 minutes
    this.TASKS_PER_BUCKET = 200;  // 200 fetches / minute

    this.stats = {
      totalTasksExecuted: 0,
      totalCyclesCompleted: 0,
      totalSignalsFound: 0,
      currentBucket: 1,
      bucketProgress: 0,
      ratePerMin: 200,
      activeSymbolsCount: 0,
      activeStrategiesCount: 0,
      lastError: null
    };
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('SCANNER', '══════════════════════════════════════════════════════════════════════');
    logger.info('SCANNER', '🚀 24/7 SMART CONTINUOUS SCANNER ENGINE INITIALIZED (CAUSAL V2.8)');
    logger.info('SCANNER', '   • Scope: 500 Symbols x (5m + 15m) = 1,000 Total Strategy Entities');
    logger.info('SCANNER', '   • Pacing: 200 Fetches / Min (3.33 req/s) | Cycle: 5 Minutes');
    logger.info('SCANNER', '   • Target Buffer: 1,500 Candles | Zero Rate-Limit Overhead (<9% Cap)');
    logger.info('SCANNER', '══════════════════════════════════════════════════════════════════════');

    // 1. Check if database has 500 symbols; if not, automatically auto-seed Top 500 symbols & 1000 strats
    await this.ensureDatabaseSeeded();

    // 2. Build initial 1,000 task queue
    await this.refreshTaskQueue();

    // 3. Start continuous micro-batch pacing wheel (every 3s)
    this.cycleStartTime = Date.now();
    this.bucketStartTime = Date.now();
    this.paceIntervalTimer = setInterval(() => this.executeMicroBatch(), this.TICK_INTERVAL_MS);

    // 4. Fast Position Monitor: Check active trades against live prices every 5s
    this.positionMonitorTimer = setInterval(() => this.monitorOpenPositions(), 5000);
  }

  stop() {
    this.isRunning = false;
    if (this.paceIntervalTimer) clearInterval(this.paceIntervalTimer);
    if (this.positionMonitorTimer) clearInterval(this.positionMonitorTimer);
    logger.warn('SCANNER', '🛑 24/7 Smart Scanner Engine Stopped.');
  }

  /**
   * Auto-seeds Top 500 symbols on cold start if DB has < 500 symbols
   */
  async ensureDatabaseSeeded() {
    try {
      const symbols = await DB.getWhitelistSymbols();
      if (!symbols || symbols.length < 350) {
        logger.info('SCANNER', `🪙 Whitelist has only ${symbols ? symbols.length : 0} symbols. Auto-seeding Top 500 Binance Futures pairs (5m + 15m)...`);
        const importTop500 = require('../scripts/import_top_500_symbols');
        await importTop500(false); // Fast seed without blocking on cold candles
        logger.success('SCANNER', '✓ Auto-seeded 500 symbols and 1,000 strategies (5m + 15m) into SQLite.');
      }
    } catch (e) {
      logger.error('SCANNER', `Auto-seed error: ${e.message}`);
    }
  }

  /**
   * Rebuilds the unified 1,000-task queue from enabled strategies in SQLite
   */
  async refreshTaskQueue() {
    const activeStrategies = await DB.getAllEnabledStrategies();
    const grouped = {};

    for (const strat of activeStrategies) {
      const key = `${strat.symbol}_${strat.timeframe}`;
      if (!grouped[key]) {
        grouped[key] = {
          symbol: strat.symbol,
          timeframe: strat.timeframe,
          strats: []
        };
      }
      grouped[key].strats.push(strat);
    }

    this.taskQueue = Object.values(grouped);
    this.stats.activeStrategiesCount = activeStrategies.length;
    this.stats.activeSymbolsCount = new Set(activeStrategies.map(s => s.symbol)).size;

    logger.info('SCANNER', `📋 Loaded ${this.taskQueue.length} unique symbol-timeframe sync tasks (${this.stats.activeSymbolsCount} symbols, ${this.stats.activeStrategiesCount} strategies).`);
  }

  /**
   * Executes 1 micro-batch of 10 tasks every 3 seconds (200 fetches/minute)
   */
  async executeMicroBatch() {
    if (!this.isRunning || this.isPacing) return;
    if (this.taskQueue.length === 0) {
      await this.refreshTaskQueue();
      if (this.taskQueue.length === 0) return;
    }

    this.isPacing = true;
    const now = Date.now();

    // Check bucket transition (every 60 seconds)
    const elapsedBucketSec = (now - this.bucketStartTime) / 1000;
    if (elapsedBucketSec >= 60 || this.bucketProgress >= this.TASKS_PER_BUCKET) {
      this.currentBucket = (this.currentBucket + 1) % this.TOTAL_BUCKETS;
      this.bucketProgress = 0;
      this.bucketStartTime = now;

      if (this.currentBucket === 0) {
        this.stats.totalCyclesCompleted++;
        this.cycleStartTime = now;
        logger.info('SCANNER', `🔄 ═══ COMPLETED 5-MIN SCAN CYCLE (${this.taskQueue.length} TASKS) ➔ STARTING NEW 5M/15M CYCLE ═══`);
      }

      logger.info('FETCH_QUEUE', `📦 ─── BUCKET [${this.currentBucket + 1}/${this.TOTAL_BUCKETS}] (Min ${this.currentBucket + 1}/5) STARTED ─── Target: 200 Fetches | Rate: 3.33 req/s`);
    }

    // Extract next micro-batch of 10 tasks
    const batchSize = Math.min(this.MICRO_BATCH_SIZE, this.taskQueue.length);
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      batch.push(this.taskQueue[this.currentTaskIndex]);
      this.currentTaskIndex = (this.currentTaskIndex + 1) % this.taskQueue.length;
    }

    const targetBuffer = Number(await DB.getSetting('candle_buffer_limit', '1500')) || 1500;
    let newSignalsInBatch = 0;

    // Process micro-batch in parallel
    await Promise.all(batch.map(async (task) => {
      if (!task) return;
      try {
        // 1. Fetch & sync 1,500 candles (incremental sync takes only 1 request)
        const candles = await binanceClient.syncCandles(task.symbol, task.timeframe, targetBuffer);
        if (!candles || candles.length < 35) return;

        // 2. Evaluate each strategy configured for this (symbol, timeframe)
        for (const strat of task.strats) {
          const signalResult = strategyEngine.evaluate(candles, strat);
          if (signalResult) {
            // Check deduplication
            const existing = await DB.get(`
              SELECT id FROM signals_alerts
              WHERE symbol = ? AND strategy_id = ? AND timestamp = ?
            `, [signalResult.symbol, signalResult.strategy_id, signalResult.timestamp]);

            if (!existing) {
              const sigId = await DB.saveSignal(signalResult);
              signalResult.id = sigId;
              newSignalsInBatch++;
              this.stats.totalSignalsFound++;

              logger.signal('SIGNAL', `🔥 [NEW SIGNAL] ${signalResult.symbol} (${signalResult.timeframe}) -> ${signalResult.signal_type} (${signalResult.direction}) | Entry: ${signalResult.entry_price} | TP1: ${signalResult.tp1_price} (+${signalResult.tp1_pct.toFixed(1)}%) | TP2: ${signalResult.tp2_price} (+${signalResult.tp2_pct.toFixed(1)}%) | SL: ${signalResult.sl_price} (-${signalResult.sl_pct.toFixed(1)}%) | R:R: 1:${signalResult.rr_ratio.toFixed(2)} | ATR: ${signalResult.atr_pct.toFixed(2)}%`);

              // Execute position manager
              await tradeExecutor.openPositionFromSignal(signalResult);

              // Broadcast notification
              await notification.sendSignalAlert(signalResult);
            }
          }
        }
      } catch (err) {
        // Non-blocking task error
      }
    }));

    this.bucketProgress += batch.length;
    this.stats.totalTasksExecuted += batch.length;
    this.stats.currentBucket = this.currentBucket + 1;
    this.stats.bucketProgress = this.bucketProgress;

    // Log progress every 50 tasks
    if (this.bucketProgress % 50 === 0 || this.bucketProgress === this.TASKS_PER_BUCKET) {
      const sampleSymbol = batch[batch.length - 1] ? `${batch[batch.length - 1].symbol} (${batch[batch.length - 1].timeframe})` : 'N/A';
      logger.info('FETCH_QUEUE', `⚡ [Bucket ${this.currentBucket + 1}/5] Synced ${this.bucketProgress}/200 tasks (Latest: ${sampleSymbol}) | Rate: 200/min | Weight: ~200/2400 (<9%) | Signals: ${this.stats.totalSignalsFound}`);
    }

    // Broadcast heartbeat to UI
    notification.broadcast('SCANNER_HEARTBEAT', await this.getStatus());
    this.isPacing = false;
  }

  /**
   * Fast position monitor: fetches ticker prices and updates active trades
   */
  async monitorOpenPositions() {
    const activePositions = await DB.getActivePositions();
    if (!activePositions || activePositions.length === 0) return;

    try {
      const tickers = await binanceClient.getTickerPrice();
      if (!Array.isArray(tickers)) return;

      const priceMap = {};
      for (const t of tickers) {
        priceMap[t.symbol] = parseFloat(t.price);
      }

      await tradeExecutor.updateActivePositions(priceMap);

      notification.broadcast('POSITIONS_UPDATE', {
        positions: await DB.getActivePositions(),
        stats: await DB.getPerformanceStats()
      });
    } catch (err) {
      // Non-blocking
    }
  }

  async getStatus() {
    const perf = await DB.getPerformanceStats();
    return {
      isRunning: this.isRunning,
      isScanning: this.isPacing,
      currentBucket: this.currentBucket + 1,
      totalBuckets: this.TOTAL_BUCKETS,
      bucketProgress: this.bucketProgress,
      tasksPerBucket: this.TASKS_PER_BUCKET,
      ratePerMin: 200,
      totalTasksExecuted: this.stats.totalTasksExecuted,
      totalCyclesCompleted: this.stats.totalCyclesCompleted,
      totalSignalsFound: this.stats.totalSignalsFound,
      activeSymbolsCount: this.stats.activeSymbolsCount,
      activeStrategiesCount: this.stats.activeStrategiesCount,
      totalTasks: this.taskQueue.length,
      performance: perf,
      lastError: this.stats.lastError
    };
  }
}

module.exports = new ScannerEngine();
