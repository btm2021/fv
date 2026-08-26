/**
 * SQLite3 Database Manager for 24/7 Binance Futures SMC Trading System
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'trading_system.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

class DBManager {
  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
    this.db.serialize(() => {
      this.db.run('PRAGMA journal_mode = WAL;');
      this.db.run('PRAGMA synchronous = NORMAL;');
      this.initSchema();
    });
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  initSchema() {
    this.db.exec(`
      -- 1. System & Bot Settings
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );

      -- 2. Whitelist Symbols Entity
      CREATE TABLE IF NOT EXISTS whitelist_symbols (
        id TEXT PRIMARY KEY,
        symbol TEXT UNIQUE NOT NULL,
        is_enabled INTEGER DEFAULT 1,
        category TEXT DEFAULT 'Futures',
        tags TEXT DEFAULT '[]',
        created_at INTEGER,
        updated_at INTEGER
      );

      -- 3. Symbol Strategies (1 Symbol -> Multiple Strategies)
      CREATE TABLE IF NOT EXISTS symbol_strategies (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        strategy_name TEXT NOT NULL,
        strategy_type TEXT DEFAULT 'dual',
        timeframe TEXT DEFAULT '5m',
        is_enabled INTEGER DEFAULT 1,
        risk_pct REAL DEFAULT 1.0,
        leverage INTEGER DEFAULT 20,
        margin_mode TEXT DEFAULT 'ISOLATED',
        order_type TEXT DEFAULT 'MARKET',
        cmo_length INTEGER DEFAULT 14,
        ma_length INTEGER DEFAULT 21,
        atr_length INTEGER DEFAULT 14,
        atr_mult REAL DEFAULT 2.0,
        min_atr_pct REAL DEFAULT 0.35,
        liq_threshold_pct REAL DEFAULT 1.5,
        fvg_threshold_pct REAL DEFAULT 1.5,
        swing_lookback INTEGER DEFAULT 30,
        inputs_json TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      -- 4. Cached OHLCV Candles
      CREATE TABLE IF NOT EXISTS ohlcv_candles (
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        PRIMARY KEY (symbol, timeframe, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_candles_lookup ON ohlcv_candles(symbol, timeframe, timestamp DESC);

      -- 5. Signals & Alerts Feed
      CREATE TABLE IF NOT EXISTS signals_alerts (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        strategy_id TEXT,
        strategy_name TEXT,
        timeframe TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        entry_price REAL NOT NULL,
        tp1_price REAL NOT NULL,
        tp2_price REAL NOT NULL,
        sl_price REAL NOT NULL,
        atr_pct REAL,
        rr_ratio REAL,
        rationale TEXT,
        timestamp INTEGER NOT NULL,
        is_sent INTEGER DEFAULT 0,
        created_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_signals_time ON signals_alerts(timestamp DESC);

      -- 6. Binance Futures Trade Positions
      CREATE TABLE IF NOT EXISTS trade_positions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        strategy_id TEXT,
        signal_id TEXT,
        direction TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        leverage INTEGER DEFAULT 20,
        margin_mode TEXT DEFAULT 'ISOLATED',
        entry_price REAL NOT NULL,
        current_price REAL,
        tp1_price REAL NOT NULL,
        tp2_price REAL NOT NULL,
        sl_price REAL NOT NULL,
        original_sl REAL NOT NULL,
        pos_size_usd REAL NOT NULL,
        quantity REAL NOT NULL,
        initial_margin REAL NOT NULL DEFAULT 0.0,
        maintenance_margin REAL NOT NULL DEFAULT 0.0,
        liq_price REAL NOT NULL DEFAULT 0.0,
        margin_ratio REAL DEFAULT 0.0,
        roe_pct REAL DEFAULT 0.0,
        is_tp1_hit INTEGER DEFAULT 0,
        is_be_moved INTEGER DEFAULT 0,
        is_liquidated INTEGER DEFAULT 0,
        gross_pnl_usd REAL DEFAULT 0.0,
        fee_usd REAL DEFAULT 0.0,
        entry_fee REAL DEFAULT 0.0,
        exit_fee REAL DEFAULT 0.0,
        funding_fee REAL DEFAULT 0.0,
        net_pnl_usd REAL DEFAULT 0.0,
        net_pnl_pct REAL DEFAULT 0.0,
        open_time INTEGER NOT NULL,
        close_time INTEGER,
        exit_reason TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_trades_status ON trade_positions(status);
      CREATE INDEX IF NOT EXISTS idx_trades_open_time ON trade_positions(open_time DESC);
    `, (err) => {
      if (err) console.error('Schema Init Error:', err);
      else {
        this.applyMigrations();
        this.seedDefaults();
      }
    });
  }

  async applyMigrations() {
    // Check & dynamically add missing columns for existing databases
    const safeAddColumn = async (table, colDef) => {
      try {
        await this.run(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
      } catch (e) {
        // Column likely exists
      }
    };

    await safeAddColumn('symbol_strategies', 'leverage INTEGER DEFAULT 20');
    await safeAddColumn('symbol_strategies', "margin_mode TEXT DEFAULT 'ISOLATED'");
    await safeAddColumn('symbol_strategies', "order_type TEXT DEFAULT 'MARKET'");

    await safeAddColumn('trade_positions', 'leverage INTEGER DEFAULT 20');
    await safeAddColumn('trade_positions', "margin_mode TEXT DEFAULT 'ISOLATED'");
    await safeAddColumn('trade_positions', 'initial_margin REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'maintenance_margin REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'liq_price REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'margin_ratio REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'roe_pct REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'is_liquidated INTEGER DEFAULT 0');
    await safeAddColumn('trade_positions', 'entry_fee REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'exit_fee REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'funding_fee REAL DEFAULT 0.0');
  }

  async seedDefaults() {
    const defaultSettings = [
      { key: 'account_equity', value: '1000.00' },
      { key: 'default_risk_pct', value: '1.0' },
      { key: 'default_leverage', value: '20' },
      { key: 'default_margin_mode', value: 'ISOLATED' },
      { key: 'candle_buffer_limit', value: '1500' },
      { key: 'is_scanner_active', value: '1' },
      { key: 'paper_trading_mode', value: '1' },
      { key: 'telegram_bot_token', value: '' },
      { key: 'telegram_chat_id', value: '' },
      { key: 'discord_webhook_url', value: '' }
    ];

    for (const item of defaultSettings) {
      await this.run(`
        INSERT OR IGNORE INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
      `, [item.key, item.value, Date.now()]);
    }
  }

  // ── SETTINGS HELPERS ──
  async getSetting(key, defaultValue = null) {
    const row = await this.get('SELECT value FROM system_settings WHERE key = ?', [key]);
    return row ? row.value : defaultValue;
  }

  async setSetting(key, value) {
    const now = Date.now();
    await this.run(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `, [key, String(value), now]);
  }

  async getAllSettings() {
    const rows = await this.all('SELECT key, value FROM system_settings');
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    return settings;
  }

  // ── WHITELIST SYMBOLS ──
  async getWhitelistSymbols() {
    return await this.all('SELECT * FROM whitelist_symbols ORDER BY created_at ASC');
  }

  async addWhitelistSymbol(symbol, category = 'Futures', tags = []) {
    const id = `sym_${symbol.toLowerCase()}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO whitelist_symbols (id, symbol, is_enabled, category, tags, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET is_enabled = 1, updated_at = ?
    `, [id, symbol.toUpperCase(), category, JSON.stringify(tags), now, now, now]);

    // Create default 5m & 15m Binance Futures strategies
    await this.addStrategy(symbol.toUpperCase(), `${symbol.toUpperCase()} Dual 5m Pro`, 'dual', '5m', 1.0, 20);
    await this.addStrategy(symbol.toUpperCase(), `${symbol.toUpperCase()} Dual 15m Pro`, 'dual', '15m', 1.0, 20);
    return id;
  }

  async toggleWhitelistSymbol(id, isEnabled) {
    const now = Date.now();
    await this.run('UPDATE whitelist_symbols SET is_enabled = ?, updated_at = ? WHERE id = ?', [isEnabled ? 1 : 0, now, id]);
    const sym = await this.get('SELECT symbol FROM whitelist_symbols WHERE id = ?', [id]);
    if (sym) {
      await this.run('UPDATE symbol_strategies SET is_enabled = ?, updated_at = ? WHERE symbol = ?', [isEnabled ? 1 : 0, now, sym.symbol]);
    }
  }

  async deleteWhitelistSymbol(id) {
    const sym = await this.get('SELECT symbol FROM whitelist_symbols WHERE id = ?', [id]);
    if (sym) {
      await this.run('DELETE FROM symbol_strategies WHERE symbol = ?', [sym.symbol]);
      await this.run('DELETE FROM ohlcv_candles WHERE symbol = ?', [sym.symbol]);
    }
    await this.run('DELETE FROM whitelist_symbols WHERE id = ?', [id]);
  }

  // ── SYMBOL STRATEGIES ──
  async getStrategiesForSymbol(symbol) {
    return await this.all('SELECT * FROM symbol_strategies WHERE symbol = ? ORDER BY timeframe ASC', [symbol]);
  }

  async getAllEnabledStrategies() {
    return await this.all(`
      SELECT s.* 
      FROM symbol_strategies s
      JOIN whitelist_symbols w ON s.symbol = w.symbol
      WHERE s.is_enabled = 1 AND w.is_enabled = 1
    `);
  }

  async addStrategy(symbol, name, type = 'dual', timeframe = '5m', riskPct = 1.0, leverage = 20) {
    const id = `strat_${symbol.toLowerCase()}_${timeframe}_${type}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO symbol_strategies (
        id, symbol, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
        cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct, fvg_threshold_pct, swing_lookback,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 1, ?, ?, 'ISOLATED', 'MARKET',
        14, 21, 14, 2.0, 0.35, 1.5, 1.5, 30,
        ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET is_enabled = 1, updated_at = ?
    `, [id, symbol.toUpperCase(), name, type, timeframe, riskPct, leverage, now, now, now]);
    return id;
  }

  async updateStrategy(id, updates) {
    const fields = [];
    const values = [];
    for (const [k, v] of Object.entries(updates)) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    await this.run(`UPDATE symbol_strategies SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async deleteStrategy(id) {
    await this.run('DELETE FROM symbol_strategies WHERE id = ?', [id]);
  }

  // ── OHLCV CANDLES ──
  async saveCandles(symbol, timeframe, candles) {
    if (!candles || candles.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ohlcv_candles (symbol, timeframe, timestamp, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.serialize(() => {
      this.db.run('BEGIN TRANSACTION');
      for (const c of candles) {
        stmt.run([symbol, timeframe, c.time, c.open, c.high, c.low, c.close, c.volume]);
      }
      this.db.run('COMMIT');
    });
  }

  async getCandles(symbol, timeframe, limit = 1500) {
    const rows = await this.all(`
      SELECT timestamp as time, open, high, low, close, volume
      FROM ohlcv_candles
      WHERE symbol = ? AND timeframe = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [symbol, timeframe, limit]);
    return rows.reverse();
  }

  // ── SIGNALS & ALERTS ──
  async saveSignal(signal) {
    const id = `sig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO signals_alerts (
        id, symbol, strategy_id, strategy_name, timeframe, signal_type, direction,
        entry_price, tp1_price, tp2_price, sl_price, atr_pct, rr_ratio, rationale,
        timestamp, is_sent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `, [
      id,
      signal.symbol,
      signal.strategy_id || '',
      signal.strategy_name || '',
      signal.timeframe,
      signal.signal_type,
      signal.direction,
      signal.entry_price,
      signal.tp1_price,
      signal.tp2_price,
      signal.sl_price,
      signal.atr_pct || 0,
      signal.rr_ratio || 0,
      signal.rationale || '',
      signal.timestamp,
      now
    ]);
    return id;
  }

  async getSignals(limit = 50) {
    return await this.all('SELECT * FROM signals_alerts ORDER BY timestamp DESC LIMIT ?', [limit]);
  }

  // ── BINANCE FUTURES POSITIONS ──
  async createPosition(pos) {
    const id = `pos_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO trade_positions (
        id, symbol, strategy_id, signal_id, direction, status,
        leverage, margin_mode, entry_price, current_price,
        tp1_price, tp2_price, sl_price, original_sl,
        pos_size_usd, quantity, initial_margin, maintenance_margin,
        liq_price, margin_ratio, roe_pct, is_tp1_hit, is_be_moved,
        is_liquidated, gross_pnl_usd, fee_usd, entry_fee, exit_fee,
        funding_fee, net_pnl_usd, net_pnl_pct, open_time, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'ACTIVE',
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, 0.0, 0.0, 0, 0,
        0, 0.0, ?, ?, 0.0,
        0.0, 0.0, 0.0, ?, ?, ?
      )
    `, [
      id,
      pos.symbol,
      pos.strategy_id || '',
      pos.signal_id || '',
      pos.direction,
      pos.leverage || 20,
      pos.margin_mode || 'ISOLATED',
      pos.entry_price,
      pos.entry_price,
      pos.tp1_price,
      pos.tp2_price,
      pos.sl_price,
      pos.sl_price,
      pos.pos_size_usd,
      pos.quantity,
      pos.initial_margin || (pos.pos_size_usd / (pos.leverage || 20)),
      pos.maintenance_margin || (pos.pos_size_usd * 0.005),
      pos.liq_price || 0.0,
      pos.fee_usd || 0.0,
      pos.entry_fee || pos.fee_usd || 0.0,
      pos.open_time || now,
      now,
      now
    ]);
    return id;
  }

  async getActivePositions() {
    return await this.all("SELECT * FROM trade_positions WHERE status = 'ACTIVE' ORDER BY open_time DESC");
  }

  async updatePosition(posId, updates) {
    const fields = [];
    const values = [];
    for (const [k, v] of Object.entries(updates)) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(posId);

    await this.run(`UPDATE trade_positions SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  async getAllPositions(limit = 200) {
    return await this.all('SELECT * FROM trade_positions ORDER BY open_time DESC LIMIT ?', [limit]);
  }

  async getPerformanceStats() {
    const closedTrades = await this.all("SELECT * FROM trade_positions WHERE status != 'ACTIVE'");
    const activePositions = await this.all("SELECT * FROM trade_positions WHERE status = 'ACTIVE'");

    const total = closedTrades.length;
    const wins = closedTrades.filter(t => t.net_pnl_usd > 0);
    const losses = closedTrades.filter(t => t.net_pnl_usd < 0 && !t.is_liquidated);
    const liquidations = closedTrades.filter(t => t.is_liquidated === 1 || t.status === 'LIQ_HIT');

    const winRate = total > 0 ? (wins.length / total * 100) : 0;
    const totalGain = wins.reduce((sum, t) => sum + t.net_pnl_usd, 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.net_pnl_usd, 0));
    const profitFactor = totalLoss > 0 ? (totalGain / totalLoss) : (totalGain > 0 ? 999 : 0);
    const netRealizedProfit = closedTrades.reduce((sum, t) => sum + t.net_pnl_usd, 0);

    const baseEq = Number(await this.getSetting('account_equity', '1000.00'));
    const walletBalance = baseEq + netRealizedProfit;

    // Unrealized PnL from Active Positions
    const totalUnrealizedPnl = activePositions.reduce((sum, p) => sum + (p.net_pnl_usd || 0), 0);
    const totalInitialMarginUsed = activePositions.reduce((sum, p) => sum + (p.initial_margin || 0), 0);
    const totalMaintenanceMarginUsed = activePositions.reduce((sum, p) => sum + (p.maintenance_margin || 0), 0);

    const marginBalance = walletBalance + totalUnrealizedPnl;
    const availableBalance = Math.max(0, walletBalance - totalInitialMarginUsed);
    const accountMarginRatio = marginBalance > 0 ? (totalMaintenanceMarginUsed / marginBalance) * 100.0 : 0.0;

    return {
      total_trades: total,
      wins: wins.length,
      losses: losses.length,
      liquidations: liquidations.length,
      win_rate: winRate,
      profit_factor: profitFactor,
      net_profit_usd: netRealizedProfit,
      wallet_balance: walletBalance,
      margin_balance: marginBalance,
      available_balance: availableBalance,
      unrealized_pnl_usd: totalUnrealizedPnl,
      initial_margin_used: totalInitialMarginUsed,
      maintenance_margin_used: totalMaintenanceMarginUsed,
      margin_ratio: accountMarginRatio,
      current_equity_usd: marginBalance
    };
  }

  // ── RESET OPERATIONS ──
  async resetTradesAndSignals() {
    await this.run('DELETE FROM trade_positions');
    await this.run('DELETE FROM signals_alerts');
    await this.setSetting('account_equity', '1000.00');
    try {
      await this.run('VACUUM');
    } catch (e) {
      // Non-blocking vacuum
    }
  }

  async resetEntireDatabase() {
    await this.run('DELETE FROM trade_positions');
    await this.run('DELETE FROM signals_alerts');
    await this.run('DELETE FROM ohlcv_candles');
    await this.run('DELETE FROM symbol_strategies');
    await this.run('DELETE FROM whitelist_symbols');
    await this.setSetting('account_equity', '1000.00');
    await this.setSetting('is_scanner_active', '1');
    try {
      await this.run('VACUUM');
    } catch (e) {
      // Non-blocking vacuum
    }
  }
}

module.exports = new DBManager();
