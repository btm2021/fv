const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const DB = require('./db');
const binanceClient = require('./binanceClient');
const scanner = require('./scanner');
const notification = require('./notification');
const logger = require('./logger');
const Stat2Box = require('../indicators/indicator_stat2_box_strategy.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve indicator and SMC scripts statically so the frontend can reuse the exact same engine
app.use('/indicators', express.static(path.join(__dirname, '..', 'indicators')));
app.get('/smc.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'smc.js')));

// WebSocket connection handler
wss.on('connection', async (ws) => {
  notification.registerWsClient(ws);
  try {
    // Send initial snapshot
    ws.send(JSON.stringify({
      type: 'INITIAL_SNAPSHOT',
      data: {
        status: await scanner.getStatus(),
        signals: await DB.getSignals(30),
        positions: await DB.getActivePositions(),
        performance: await DB.getPerformanceStats(),
        logs: logger.getLogs(80)
      }
    }));
  } catch (err) {
    console.error('WS Snapshot Error:', err);
  }
});

// ── REST API ROUTES ──

// 1. System & Scanner Status
app.get('/api/status', async (req, res) => {
  try {
    res.json({
      success: true,
      status: await scanner.getStatus(),
      settings: await DB.getAllSettings()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/scanner/trigger', async (req, res) => {
  scanner.executeScanCycle().catch(err => console.error(err));
  res.json({ success: true, message: 'Scan cycle triggered asynchronously.' });
});

app.post('/api/scanner/toggle', async (req, res) => {
  try {
    const current = (await DB.getSetting('is_scanner_active', '1')) === '1';
    const next = !current;
    await DB.setSetting('is_scanner_active', next ? '1' : '0');
    res.json({ success: true, is_scanner_active: next });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Whitelist Symbol Entities
app.get('/api/whitelist', async (req, res) => {
  try {
    const symbols = await DB.getWhitelistSymbols();
    const result = [];
    for (const s of symbols) {
      const strats = await DB.getStrategiesForSymbol(s.symbol);
      const candles5m = await DB.getCandles(s.symbol, '5m', 1);
      result.push({
        ...s,
        strategies: strats,
        has_cached_candles: candles5m.length > 0
      });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/whitelist', async (req, res) => {
  const { symbol, category } = req.body;
  if (!symbol) return res.status(400).json({ success: false, error: 'Symbol is required' });
  try {
    const created = await DB.addWhitelistSymbol(symbol, category || 'Custom');
    res.json({ success: true, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/whitelist/:symbol/toggle', async (req, res) => {
  const { is_enabled } = req.body;
  try {
    await DB.toggleWhitelistSymbol(req.params.symbol, is_enabled);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/whitelist/:symbol', async (req, res) => {
  try {
    await DB.deleteWhitelistSymbol(req.params.symbol);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Multi-Strategy Manager per Symbol
app.get('/api/strategies/:symbol', async (req, res) => {
  try {
    const strats = await DB.getStrategiesForSymbol(req.params.symbol);
    res.json({ success: true, data: strats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/strategies', async (req, res) => {
  try {
    const stratId = await DB.saveStrategy(req.body);
    res.json({ success: true, id: stratId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/strategies/:id', async (req, res) => {
  try {
    await DB.deleteStrategy(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Import Top 500 Symbols (1,000 Strategies across 5m & 15m)
app.post('/api/admin/import-top-500', async (req, res) => {
  try {
    const importTop500 = require('../scripts/import_top_500_symbols');
    // Run async in background
    importTop500(true).catch(err => console.error('Background import top 500 error:', err));
    res.json({ success: true, message: 'Top 500 Binance Futures (5m & 15m) import started in background.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Reset Trade Positions, Signals, and Equity to $1,000
app.post('/api/admin/reset-trades', async (req, res) => {
  try {
    await DB.resetTradesAndSignals();
    logger.warn('ADMIN', '🗑️ User executed RESET: Cleared all trade positions, signals, and reset equity to $1,000.00 USD.');
    notification.broadcast('POSITIONS_UPDATE', {
      positions: [],
      stats: await DB.getPerformanceStats()
    });
    notification.broadcast('SIGNALS_UPDATE', { signals: [] });
    res.json({ success: true, message: 'All trade positions and signals have been reset. Account balance reset to $1,000.00 USD.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Full Database Factory Reset
app.post('/api/admin/reset-all', async (req, res) => {
  try {
    await DB.resetEntireDatabase();
    const importTop500 = require('../scripts/import_top_500_symbols');
    importTop500(false).catch(e => console.error(e));
    logger.warn('ADMIN', '⚠️ User executed FULL FACTORY RESET: Cleared DB tables and re-seeding Top 500 symbols.');
    notification.broadcast('POSITIONS_UPDATE', {
      positions: [],
      stats: await DB.getPerformanceStats()
    });
    res.json({ success: true, message: 'Full database reset completed. Top 500 symbols re-seeding in background.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Signals & Alerts
app.get('/api/signals', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  try {
    const signals = await DB.getSignals(limit);
    res.json({ success: true, data: signals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Trade Positions & Performance
app.get('/api/positions', async (req, res) => {
  try {
    const active = await DB.getActivePositions();
    const all = await DB.getAllPositions(50);
    const stats = await DB.getPerformanceStats();
    res.json({ success: true, active, all, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5b. Close Position at Market Price
app.post('/api/positions/close/:id', async (req, res) => {
  try {
    const tradeExecutor = require('./tradeExecutor');
    const binanceWs = require('./binanceWs');
    const pos = await DB.get('SELECT symbol FROM trade_positions WHERE id = ?', [req.params.id]);
    const livePrice = pos ? binanceWs.getLivePrice(pos.symbol) : null;
    const result = await tradeExecutor.closePositionMarket(req.params.id, livePrice);
    
    notification.broadcast('POSITIONS_UPDATE', {
      positions: await DB.getActivePositions(),
      stats: await DB.getPerformanceStats()
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5c. Adjust Strategy Leverage / Margin Mode
app.post('/api/positions/leverage', async (req, res) => {
  const { symbol, timeframe, leverage, margin_mode } = req.body;
  try {
    if (leverage) {
      await DB.run(`
        UPDATE symbol_strategies 
        SET leverage = ?, updated_at = ? 
        WHERE symbol = ? AND (timeframe = ? OR ? IS NULL)
      `, [Number(leverage), Date.now(), symbol.toUpperCase(), timeframe || null, timeframe ? 0 : null]);
    }
    if (margin_mode) {
      await DB.run(`
        UPDATE symbol_strategies 
        SET margin_mode = ?, updated_at = ? 
        WHERE symbol = ? AND (timeframe = ? OR ? IS NULL)
      `, [margin_mode.toUpperCase(), Date.now(), symbol.toUpperCase(), timeframe || null, timeframe ? 0 : null]);
    }
    res.json({ success: true, message: `Updated leverage ${leverage}x (${margin_mode}) for ${symbol}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5d. Place Manual Binance Futures Order
app.post('/api/orders/place', async (req, res) => {
  const { symbol, direction, entry_price, quantity, leverage, sl_price, tp1_price, tp2_price } = req.body;
  try {
    const tradeExecutor = require('./tradeExecutor');
    const ep = parseFloat(entry_price);
    const sl = parseFloat(sl_price || (direction === 'BUY' ? ep * 0.98 : ep * 1.02));
    const tp1 = parseFloat(tp1_price || (direction === 'BUY' ? ep * 1.015 : ep * 0.985));
    const tp2 = parseFloat(tp2_price || (direction === 'BUY' ? ep * 1.03 : ep * 0.97));
    
    const syntheticSignal = {
      symbol: symbol.toUpperCase(),
      strategy_id: `strat_${symbol.toLowerCase()}_manual`,
      id: `manual_${Date.now()}`,
      direction: direction.toUpperCase(),
      entry_price: ep,
      sl_price: sl,
      tp1_price: tp1,
      tp2_price: tp2,
      risk_pct: 1.0,
      timestamp: Date.now()
    };

    const posId = await tradeExecutor.openPositionFromSignal(syntheticSignal);
    if (!posId) {
      return res.status(400).json({ success: false, error: 'Could not open position (check active positions or margin).' });
    }

    notification.broadcast('POSITIONS_UPDATE', {
      positions: await DB.getActivePositions(),
      stats: await DB.getPerformanceStats()
    });
    res.json({ success: true, posId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Settings Configuration
app.get('/api/settings', async (req, res) => {
  try {
    res.json({ success: true, data: await DB.getAllSettings() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      await DB.setSetting(k, v);
    }
    res.json({ success: true, data: await DB.getAllSettings() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Interactive Chart Data Feed (OHLCV + SMC Calculation)
app.get('/api/chart/:symbol/:timeframe', async (req, res) => {
  const { symbol, timeframe } = req.params;
  const sym = symbol.toUpperCase();
  const tf = timeframe || '5m';

  try {
    let candles = await DB.getCandles(sym, tf, 1500);
    if (candles.length < 50) {
      candles = await binanceClient.syncCandles(sym, tf, 1500);
    }

    const calc = Stat2Box.calculate(candles, {
      strategyMode: req.query.strategyMode || 'dual',
      cmoLength: parseInt(req.query.cmoLength) || 14,
      maLength: parseInt(req.query.maLength) || 21,
      atrLength: parseInt(req.query.atrLength) || 14,
      atrMult: parseFloat(req.query.atrMult) || 2.0,
      minAtrPct: parseFloat(req.query.minAtrPct) || 0.35,
      liqThresholdPct: parseFloat(req.query.liqThresholdPct) || 1.5,
      fvgThresholdPct: parseFloat(req.query.fvgThresholdPct) || 1.5,
      swingLookback: parseInt(req.query.swingLookback) || 30
    });

    res.json({
      success: true,
      symbol: sym,
      timeframe: tf,
      candles: candles,
      cards: calc ? calc.cards : [],
      atrData: calc ? calc.atrData : [],
      liqList: calc ? calc.liqList : [],
      fvgList: calc ? calc.fvgList : []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Discover Binance Market Pairs
app.get('/api/binance/symbols', async (req, res) => {
  try {
    const list = await binanceClient.getExchangeInfo();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Real-Time System Logs Stream API
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const category = req.query.category || null;
  const level = req.query.level || null;
  res.json({ success: true, data: logger.getLogs(limit, category, level) });
});

app.post('/api/logs/clear', (req, res) => {
  logger.clear();
  logger.info('SYSTEM', 'System log buffer cleared by user from dashboard.');
  res.json({ success: true });
});

module.exports = { app, server };
