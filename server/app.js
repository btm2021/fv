/**
 * Express REST API & WebSocket Server
 * Standardized Multi-Exchange Architecture (Binance, Bybit, OKX)
 */
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');

const DB = require('./db');
const scanner = require('./scanner');
const notification = require('./notification');
const exchangeManager = require('./exchanges');
const Stat2Box = require('../indicators/indicator_stat2_box_strategy');
const logger = require('./logger');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket stream and connect exchange feeds
notification.init(server);
exchangeManager.connectAllWebSockets();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/indicators', express.static(path.join(__dirname, '..', 'indicators')));
app.use('/libs', express.static(path.join(__dirname, '..', 'libs')));
app.get('/smc.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'smc.js')));

// ── REST API ROUTES ──

// 1. Health & Bot Status
app.get('/api/status', async (req, res) => {
  try {
    const exchange = req.query.exchange || null;
    res.json({
      success: true,
      status: scanner.getStatus(),
      settings: await DB.getAllSettings(),
      stats: await DB.getPerformanceStats(exchange)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/scanner/trigger', async (req, res) => {
  res.json({ success: true, message: 'Continuous scan wheels are active and pacing automatically.' });
});

app.post('/api/scanner/toggle', async (req, res) => {
  try {
    const current = (await DB.getSetting('is_scanner_active', '1')) === '1';
    const next = !current;
    await DB.setSetting('is_scanner_active', next ? '1' : '0');
    if (next) scanner.start();
    else scanner.stop();
    res.json({ success: true, is_scanner_active: next });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Whitelist Symbol Entities (Multi-Exchange)
app.get('/api/whitelist', async (req, res) => {
  const exchange = req.query.exchange || null;
  try {
    const symbols = await DB.getWhitelistSymbols(exchange);
    res.json({ success: true, data: symbols });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/whitelist', async (req, res) => {
  const { symbol, category, exchange } = req.body;
  if (!symbol) return res.status(400).json({ success: false, error: 'Symbol is required' });
  const ex = (exchange || 'BINANCE').toUpperCase();
  try {
    const created = await DB.addWhitelistSymbol(symbol, category || 'Custom', [], ex);
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
  const exchange = req.query.exchange || 'BINANCE';
  try {
    const strats = await DB.getStrategiesForSymbol(req.params.symbol, exchange);
    res.json({ success: true, data: strats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/strategies', async (req, res) => {
  const { symbol, strategy_name, strategy_type, timeframe, risk_pct, leverage, exchange } = req.body;
  try {
    const stratId = await DB.addStrategy(
      symbol,
      strategy_name || `${symbol} Strategy`,
      strategy_type || 'dual',
      timeframe || '5m',
      risk_pct || 1.0,
      leverage || 20,
      exchange || 'BINANCE'
    );
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

// Admin: Import Top 500 Binance Symbols
app.post('/api/admin/import-top-500', async (req, res) => {
  try {
    const importTop500 = require('../scripts/import_top_500_symbols');
    importTop500(false).catch(err => console.error('Background import top 500 error:', err));
    res.json({ success: true, message: 'Top 500 Binance Futures (5m & 15m) import started in background.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Import Top 300 Bybit Symbols
app.post('/api/admin/import-bybit', async (req, res) => {
  try {
    const importBybit = require('../scripts/import_bybit_symbols');
    importBybit(false).catch(err => console.error('Background import bybit error:', err));
    res.json({ success: true, message: 'Top 300 Bybit Linear Perpetual import started in background.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Import Top 200 OKX Symbols
app.post('/api/admin/import-okx', async (req, res) => {
  try {
    const importOkx = require('../scripts/import_okx_symbols');
    importOkx(false).catch(err => console.error('Background import okx error:', err));
    res.json({ success: true, message: 'Top 200 OKX USDT Swap Perpetual import started in background.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Reset Trade Positions & Signals
app.post('/api/admin/reset-trades', async (req, res) => {
  const exchange = req.query.exchange || null;
  try {
    await DB.resetTradesAndSignals(exchange);
    logger.warn('ADMIN', `🗑️ User executed RESET: Cleared trade positions, signals, and reset equity for [${exchange || 'ALL'}].`);
    notification.broadcast('POSITIONS_UPDATE', {
      positions: [],
      stats: await DB.getPerformanceStats()
    });
    notification.broadcast('SIGNALS_UPDATE', { signals: [] });
    res.json({ success: true, message: `Trade positions and signals reset for [${exchange || 'ALL'}].` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Full Database Factory Reset
app.post('/api/admin/reset-all', async (req, res) => {
  try {
    await DB.resetEntireDatabase();
    const importTop500 = require('../scripts/import_top_500_symbols');
    const importBybit = require('../scripts/import_bybit_symbols');
    const importOkx = require('../scripts/import_okx_symbols');
    importTop500(false).catch(e => console.error(e));
    importBybit(false).catch(e => console.error(e));
    importOkx(false).catch(e => console.error(e));
    logger.warn('ADMIN', '⚠️ User executed FULL FACTORY RESET: Cleared DB tables and re-seeding Binance, Bybit & OKX.');
    notification.broadcast('POSITIONS_UPDATE', {
      positions: [],
      stats: await DB.getPerformanceStats()
    });
    res.json({ success: true, message: 'Full database reset completed. Binance, Bybit & OKX symbols re-seeding in background.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Signals & Alerts (Multi-Exchange)
app.get('/api/signals', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const exchange = req.query.exchange || null;
  try {
    const signals = await DB.getSignals(limit, exchange);
    res.json({ success: true, data: signals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Trade Positions & Performance (Multi-Exchange)
app.get('/api/positions', async (req, res) => {
  const exchange = req.query.exchange || null;
  try {
    const active = await DB.getActivePositions(exchange);
    const all = await DB.getAllPositions(50, exchange);
    const stats = await DB.getPerformanceStats(exchange);
    res.json({ success: true, active, all, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5b. Close Position at Market Price
app.post('/api/positions/close/:id', async (req, res) => {
  try {
    const tradeExecutor = require('./tradeExecutor');
    const pos = await DB.get('SELECT symbol, exchange FROM trade_positions WHERE id = ?', [req.params.id]);
    const livePrice = pos ? exchangeManager.getLivePrice(pos.symbol, pos.exchange) : null;
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

// 5b2. Get Trade Forensics & Quantitative Features
app.get('/api/positions/:id/forensics', async (req, res) => {
  try {
    const pos = await DB.getPositionById(req.params.id);
    if (!pos) return res.status(404).json({ success: false, error: 'Position record not found.' });
    if (pos.features_json && typeof pos.features_json === 'string') {
      try {
        pos.features = JSON.parse(pos.features_json);
      } catch (e) {
        pos.features = {};
      }
    }
    res.json({ success: true, data: pos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5c. Adjust Strategy Leverage / Margin Mode
app.post('/api/positions/leverage', async (req, res) => {
  const { symbol, timeframe, leverage, margin_mode, exchange } = req.body;
  const ex = (exchange || 'BINANCE').toUpperCase();
  try {
    if (leverage) {
      await DB.run(`
        UPDATE symbol_strategies 
        SET leverage = ?, updated_at = ? 
        WHERE symbol = ? AND exchange = ? AND (timeframe = ? OR ? IS NULL)
      `, [Number(leverage), Date.now(), symbol.toUpperCase(), ex, timeframe || null, timeframe ? 0 : null]);
    }
    if (margin_mode) {
      await DB.run(`
        UPDATE symbol_strategies 
        SET margin_mode = ?, updated_at = ? 
        WHERE symbol = ? AND exchange = ? AND (timeframe = ? OR ? IS NULL)
      `, [margin_mode.toUpperCase(), Date.now(), symbol.toUpperCase(), ex, timeframe || null, timeframe ? 0 : null]);
    }
    res.json({ success: true, message: `Updated leverage ${leverage}x (${margin_mode}) for ${symbol} [${ex}]` });
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

// 7. Interactive Chart Data Feed (Multi-Exchange)
app.get('/api/chart/:symbol/:timeframe', async (req, res) => {
  const { symbol, timeframe } = req.params;
  const sym = symbol.toUpperCase();
  const tf = timeframe || '5m';
  const exchange = (req.query.exchange || 'BINANCE').toUpperCase();
  const exAdapter = exchangeManager.getExchange(exchange);

  try {
    let candles = await DB.getCandles(sym, tf, 1500, exchange);
    if (candles.length < 50) {
      candles = await exAdapter.syncCandles(sym, tf, 1500);
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
      exchange: exchange,
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

// 8. Discover Exchange Market Pairs
app.get('/api/binance/symbols', async (req, res) => {
  try {
    const ex = exchangeManager.getExchange('BINANCE');
    const list = await ex.getExchangeInfo();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/bybit/symbols', async (req, res) => {
  try {
    const ex = exchangeManager.getExchange('BYBIT');
    const list = await ex.getExchangeInfo();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/okx/symbols', async (req, res) => {
  try {
    const ex = exchangeManager.getExchange('OKX');
    const list = await ex.getExchangeInfo();
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

// 10. Chart Drawings Persistence API
app.get('/api/drawings', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'BTCUSDT';
    const exchange = req.query.exchange || null;
    const drawings = await DB.getDrawings(symbol, exchange);
    res.json({ success: true, data: drawings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/drawings', async (req, res) => {
  try {
    const { id, symbol, exchange, timeframe, drawing_type, data_json } = req.body;
    if (!symbol || !drawing_type || !data_json) {
      return res.status(400).json({ success: false, error: 'symbol, drawing_type, and data_json are required' });
    }
    const result = await DB.saveDrawing({ id, symbol, exchange, timeframe, drawing_type, data_json });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/drawings/:id', async (req, res) => {
  try {
    await DB.deleteDrawing(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/drawings', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    const exchange = req.query.exchange || null;
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol is required' });
    await DB.clearDrawings(symbol, exchange);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Order & Trade Notes API
app.get('/api/notes/:targetId', async (req, res) => {
  try {
    const note = await DB.getOrderNote(req.params.targetId);
    res.json({ success: true, data: note });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/notes/:targetId', async (req, res) => {
  try {
    const { symbol, note_text } = req.body;
    const result = await DB.saveOrderNote(req.params.targetId, symbol, note_text);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/notes', async (req, res) => {
  try {
    const notes = await DB.getAllOrderNotes();
    res.json({ success: true, data: notes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = { app, server };
