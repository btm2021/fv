/**
 * 24/7 Standardized Multi-Exchange Continuous Market Scanner Engine
 * 
 * Multi-Worker Architecture:
 * - Binance Futures: 500 Symbols x (5m + 15m) = 1,000 Tasks @ 200 fetches/min
 * - Bybit Linear:    300 Symbols x (5m + 15m) =   600 Tasks @ 120 fetches/min
 * - OKX Perpetual:   200 Symbols x (5m + 15m) =   400 Tasks @  80 fetches/min
 * - Independent pacing wheels, buckets, and rate-limit managers per exchange
 */
const DB = require('./db');
const exchangeManager = require('./exchanges');
const strategyEngine = require('./strategyEngine');
const tradeExecutor = require('./tradeExecutor');
const notification = require('./notification');
const logger = require('./logger');

class ExchangeWorker {
  constructor(exchangeAdapter) {
    this.adapter = exchangeAdapter;
    this.exchange = exchangeAdapter.id.toUpperCase();
    this.isRunning = false;
    this.isPacing = false;
    this.paceTimer = null;

    this.taskQueue = [];
    this.currentTaskIndex = 0;
    this.currentBucket = 0;
    this.bucketProgress = 0;
    this.cycleStartTime = 0;
    this.bucketStartTime = 0;

    const pConfig = exchangeAdapter.pacingConfig || {};
    this.MICRO_BATCH_SIZE = pConfig.microBatchSize || 10;
    this.TICK_INTERVAL_MS = pConfig.tickIntervalMs || 3000;
    this.TOTAL_BUCKETS = pConfig.totalBuckets || 5;
    this.TASKS_PER_BUCKET = pConfig.tasksPerBucket || 200;
    this.ratePerMin = pConfig.ratePerMin || 200;

    this.stats = {
      exchange: this.exchange,
      ratePerMin: this.ratePerMin,
      totalTasksExecuted: 0,
      totalCyclesCompleted: 0,
      totalSignalsFound: 0,
      currentBucket: 1,
      bucketProgress: 0,
      activeSymbolsCount: 0,
      activeStrategiesCount: 0
    };
  }

  async start() {
    this.isRunning = true;
    await this.refreshTaskQueue();
    this.cycleStartTime = Date.now();
    this.bucketStartTime = Date.now();
    this.paceTimer = setInterval(() => this.executeMicroBatch(), this.TICK_INTERVAL_MS);
    logger.info('SCANNER', `🚀 Started ${this.exchange} Scanner Worker: ${this.taskQueue.length} tasks @ ${this.ratePerMin} fetches/min.`);
  }

  stop() {
    this.isRunning = false;
    if (this.paceTimer) clearInterval(this.paceTimer);
  }

  async refreshTaskQueue() {
    const activeStrategies = await DB.getAllEnabledStrategies(this.exchange);
    const grouped = {};

    for (const strat of activeStrategies) {
      const key = `${strat.symbol}_${strat.timeframe}`;
      if (!grouped[key]) {
        grouped[key] = {
          symbol: strat.symbol,
          timeframe: strat.timeframe,
          exchange: this.exchange,
          strats: []
        };
      }
      grouped[key].strats.push(strat);
    }

    this.taskQueue = Object.values(grouped);
    this.stats.activeStrategiesCount = activeStrategies.length;
    this.stats.activeSymbolsCount = new Set(activeStrategies.map(s => s.symbol)).size;
  }

  async executeMicroBatch() {
    if (!this.isRunning || this.isPacing) return;
    if (this.taskQueue.length === 0) {
      await this.refreshTaskQueue();
      if (this.taskQueue.length === 0) return;
    }

    this.isPacing = true;
    try {
      const now = Date.now();

      // Bucket transition (every 60s)
      const elapsedBucketSec = (now - this.bucketStartTime) / 1000;
      if (elapsedBucketSec >= 60 || this.bucketProgress >= this.TASKS_PER_BUCKET) {
        this.currentBucket = (this.currentBucket + 1) % this.TOTAL_BUCKETS;
        this.bucketProgress = 0;
        this.bucketStartTime = now;

        if (this.currentBucket === 0) {
          this.stats.totalCyclesCompleted++;
          this.cycleStartTime = now;
          logger.info('SCANNER', `🔄 [${this.exchange}] COMPLETED 5-MIN SCAN CYCLE (${this.taskQueue.length} TASKS) ➔ STARTING NEW CYCLE`);
        }
      }

      const batchSize = Math.min(this.MICRO_BATCH_SIZE, this.taskQueue.length);
      const batch = [];
      for (let i = 0; i < batchSize; i++) {
        batch.push(this.taskQueue[this.currentTaskIndex]);
        this.currentTaskIndex = (this.currentTaskIndex + 1) % this.taskQueue.length;
      }

      const targetBuffer = Number(await DB.getSetting('candle_buffer_limit', '1500')) || 1500;

      await Promise.all(batch.map(async (task) => {
        if (!task) return;
        try {
          const candles = await this.adapter.syncCandles(task.symbol, task.timeframe, targetBuffer);
          if (!candles || candles.length < 35) {
            logger.warn('SCAN', `⚠️ [${this.exchange}] Fetch ${task.symbol} (${task.timeframe}): Không đủ dữ liệu nến (${candles ? candles.length : 0}/35) để phân tích.`);
            return;
          }

          let foundAnySignal = false;
          for (const strat of task.strats) {
            const signalResult = strategyEngine.evaluate(candles, strat);
            if (signalResult) {
              foundAnySignal = true;
              signalResult.exchange = this.exchange;

              const existing = await DB.get(`
                SELECT id FROM signals_alerts
                WHERE symbol = ? AND strategy_id = ? AND timestamp = ? AND exchange = ?
              `, [signalResult.symbol, signalResult.strategy_id, signalResult.timestamp, this.exchange]);

              if (!existing) {
                const sigId = await DB.saveSignal(signalResult);
                signalResult.id = sigId;
                this.stats.totalSignalsFound++;

                logger.signal('SIGNAL', `🔥 [${this.exchange} SIGNAL] ${signalResult.symbol} (${signalResult.timeframe}) -> ${signalResult.signal_type} (${signalResult.direction}) | Entry: ${signalResult.entry_price} | TP1: ${signalResult.tp1_price} | TP2: ${signalResult.tp2_price} | SL: ${signalResult.sl_price}`);

                await tradeExecutor.openPositionFromSignal(signalResult);
                await notification.sendSignalAlert(signalResult);
              }
            }
          }

          // Báo cáo nếu symbol đã xử lý nhưng không phát hiện tín hiệu
          if (!foundAnySignal) {
            const lastCandle = candles[candles.length - 1];
            logger.info('SCAN', `⚪ [${this.exchange}] ${task.symbol} (${task.timeframe}) [${candles.length} nến | Giá: $${lastCandle.close}]: Đã phân tích SMC/ATR ➔ Không phát hiện tín hiệu vào lệnh.`);
          }
        } catch (err) {
          logger.error('SCAN', `❌ [${this.exchange}] ${task.symbol} (${task.timeframe}) lỗi xử lý: ${err.message}`);
        }
      }));

      this.bucketProgress += batch.length;
      this.stats.totalTasksExecuted += batch.length;
      this.stats.currentBucket = this.currentBucket + 1;
      this.stats.bucketProgress = this.bucketProgress;
    } catch (err) {
      logger.error('SCANNER', `[${this.exchange}] Batch error: ${err.message}`);
    } finally {
      this.isPacing = false;
    }
  }
}

class ScannerEngine {
  constructor() {
    this.isRunning = false;
    this.workers = {};
    for (const adapter of exchangeManager.getAllExchanges()) {
      this.workers[adapter.id] = new ExchangeWorker(adapter);
    }
    this.positionMonitorTimer = null;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('SCANNER', '══════════════════════════════════════════════════════════════════════');
    logger.info('SCANNER', '🚀 STANDARDIZED MULTI-EXCHANGE CONTINUOUS SCANNER INITIALIZED');
    logger.info('SCANNER', '   • Binance Futures: 500 Symbols x (5m + 15m) = 1,000 Tasks @ 200/min');
    logger.info('SCANNER', '   • Bybit Linear:    300 Symbols x (5m + 15m) =   600 Tasks @ 120/min');
    logger.info('SCANNER', '   • OKX Perpetual:   200 Symbols x (5m + 15m) =   400 Tasks @  80/min');
    logger.info('SCANNER', '   • Independent Queues & Dedicated Rate Budgets (5-Minute Cycles)');
    logger.info('SCANNER', '══════════════════════════════════════════════════════════════════════');

    await this.ensureDatabasesSeeded();

    for (const worker of Object.values(this.workers)) {
      await worker.start();
    }

    this.positionMonitorTimer = setInterval(() => this.monitorOpenPositions(), 5000);
  }

  stop() {
    this.isRunning = false;
    for (const worker of Object.values(this.workers)) {
      worker.stop();
    }
    if (this.positionMonitorTimer) clearInterval(this.positionMonitorTimer);
    logger.warn('SCANNER', '🛑 Multi-Exchange Scanner Stopped.');
  }

  async restart() {
    logger.info('SCANNER', '🔄 Restarting Multi-Exchange Scanner with new configuration...');
    this.stop();
    await new Promise(r => setTimeout(r, 1000));
    await this.start();
    logger.info('SCANNER', '✅ Multi-Exchange Scanner Restarted Successfully!');
  }

  async ensureDatabasesSeeded() {
    try {
      const allSymbols = await DB.getWhitelistSymbols();
      if (!allSymbols || allSymbols.length < 500) {
        logger.info('SCANNER', '📡 Seeding 90% perpetual symbols across 6 exchanges via native source code...');
        await exchangeManager.discoverAndSeedPerpetuals();
      }
    } catch (e) {
      logger.error('SCANNER', `Auto-seed error: ${e.message}`);
    }
  }

  async monitorOpenPositions() {
    try {
      const activePositions = await DB.getActivePositions();
      if (!activePositions || activePositions.length === 0) return;

      const combinedPriceMap = {};
      for (const pos of activePositions) {
        const p = exchangeManager.getLivePrice(pos.symbol, pos.exchange || 'BINANCE');
        if (p) combinedPriceMap[pos.symbol] = p;
      }

      await tradeExecutor.updateActivePositions(combinedPriceMap);
    } catch (err) {
      // non-blocking
    }
  }

  getStatus() {
    const workerStats = {};
    for (const [id, worker] of Object.entries(this.workers)) {
      workerStats[id] = worker.stats;
    }
    return {
      isRunning: this.isRunning,
      workers: workerStats
    };
  }

  async refreshTaskQueue() {
    for (const worker of Object.values(this.workers)) {
      await worker.refreshTaskQueue();
    }
  }
}

module.exports = new ScannerEngine();
