/**
 * SQLite3 Database Manager for Multi-Exchange SMC Trading System
 * Supports Binance Futures (USDT-M) & Bybit (V5 Linear) with isolated rate limits and feature tracking
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
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'BINANCE',
        is_enabled INTEGER DEFAULT 1,
        category TEXT DEFAULT 'Futures',
        tags TEXT DEFAULT '[]',
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(symbol, exchange)
      );

      -- 3. Symbol Strategies (1 Symbol -> Multiple Strategies per Exchange)
      CREATE TABLE IF NOT EXISTS symbol_strategies (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'BINANCE',
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
        exchange TEXT DEFAULT 'BINANCE',
        timeframe TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        PRIMARY KEY (symbol, exchange, timeframe, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_candles_lookup ON ohlcv_candles(symbol, exchange, timeframe, timestamp DESC);

      -- 5. Signals & Alerts Feed
      CREATE TABLE IF NOT EXISTS signals_alerts (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'BINANCE',
        strategy_id TEXT,
        strategy_name TEXT,
        timeframe TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        entry_price REAL NOT NULL,
        tp1_price REAL NOT NULL,
        tp2_price REAL NOT NULL,
        sl_price REAL NOT NULL,
        cmo_val REAL,
        atr_val REAL,
        atr_pct REAL,
        rr_ratio REAL,
        nearest_liq_dist_pct REAL,
        danger_level REAL,
        market_regime TEXT,
        side_rationale TEXT,
        entry_rationale TEXT,
        tp1_rationale TEXT,
        tp2_rationale TEXT,
        sl_rationale TEXT,
        rationale TEXT,
        features_json TEXT,
        timestamp INTEGER NOT NULL,
        is_sent INTEGER DEFAULT 0,
        created_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_signals_time ON signals_alerts(timestamp DESC);

      -- 6. Trade Positions (Multi-Exchange Forensics)
      CREATE TABLE IF NOT EXISTS trade_positions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'BINANCE',
        strategy_id TEXT,
        signal_id TEXT,
        signal_type TEXT,
        direction TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        leverage INTEGER DEFAULT 20,
        margin_mode TEXT DEFAULT 'ISOLATED',
        entry_price REAL NOT NULL,
        current_price REAL,
        exit_price REAL,
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
        cmo_val REAL,
        atr_val REAL,
        atr_pct REAL,
        rr_ratio REAL,
        nearest_liq_dist_pct REAL,
        danger_level REAL,
        market_regime TEXT,
        side_rationale TEXT,
        entry_rationale TEXT,
        tp1_rationale TEXT,
        tp2_rationale TEXT,
        sl_rationale TEXT,
        features_json TEXT,
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
        duration_seconds INTEGER DEFAULT 0,
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
    const safeAddColumn = async (table, colDef) => {
      try {
        await this.run(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
      } catch (e) {}
    };

    // Multi-Exchange column support
    await safeAddColumn('whitelist_symbols', "exchange TEXT DEFAULT 'BINANCE'");
    await safeAddColumn('symbol_strategies', "exchange TEXT DEFAULT 'BINANCE'");
    await safeAddColumn('ohlcv_candles', "exchange TEXT DEFAULT 'BINANCE'");
    await safeAddColumn('signals_alerts', "exchange TEXT DEFAULT 'BINANCE'");
    await safeAddColumn('trade_positions', "exchange TEXT DEFAULT 'BINANCE'");

    // Chart Drawings Table
    await this.run(`
      CREATE TABLE IF NOT EXISTS chart_drawings (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        exchange TEXT DEFAULT 'BINANCE',
        timeframe TEXT,
        drawing_type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_drawings_sym ON chart_drawings(symbol, exchange)`);

    // Order & Trade Notes Table
    await this.run(`
      CREATE TABLE IF NOT EXISTS order_notes (
        id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        note_text TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(target_id)
      )
    `);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_notes_target ON order_notes(target_id)`);

    // Safe migration: ensure whitelist_symbols has UNIQUE(symbol, exchange)
    try {
      const wlTable = await this.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='whitelist_symbols'");
      if (wlTable && wlTable.sql.includes('symbol TEXT UNIQUE')) {
        await this.run(`
          CREATE TABLE IF NOT EXISTS whitelist_symbols_mig (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            exchange TEXT DEFAULT 'BINANCE',
            is_enabled INTEGER DEFAULT 1,
            category TEXT DEFAULT 'Futures',
            tags TEXT DEFAULT '[]',
            created_at INTEGER,
            updated_at INTEGER,
            UNIQUE(symbol, exchange)
          )
        `);
        await this.run(`
          INSERT OR IGNORE INTO whitelist_symbols_mig (id, symbol, exchange, is_enabled, category, tags, created_at, updated_at)
          SELECT id, symbol, COALESCE(exchange, 'BINANCE'), is_enabled, category, tags, created_at, updated_at FROM whitelist_symbols
        `);
        await this.run(`DROP TABLE whitelist_symbols`);
        await this.run(`ALTER TABLE whitelist_symbols_mig RENAME TO whitelist_symbols`);
      }
    } catch (e) {}

    // Safe migration: ensure ohlcv_candles composite primary key includes exchange
    try {
      const candleTable = await this.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='ohlcv_candles'");
      if (candleTable && candleTable.sql.includes('PRIMARY KEY (symbol, timeframe, timestamp)')) {
        await this.run(`
          CREATE TABLE IF NOT EXISTS ohlcv_candles_mig (
            symbol TEXT NOT NULL,
            exchange TEXT DEFAULT 'BINANCE',
            timeframe TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL NOT NULL,
            PRIMARY KEY (symbol, exchange, timeframe, timestamp)
          )
        `);
        await this.run(`
          INSERT OR IGNORE INTO ohlcv_candles_mig (symbol, exchange, timeframe, timestamp, open, high, low, close, volume)
          SELECT symbol, COALESCE(exchange, 'BINANCE'), timeframe, timestamp, open, high, low, close, volume FROM ohlcv_candles
        `);
        await this.run(`DROP TABLE ohlcv_candles`);
        await this.run(`ALTER TABLE ohlcv_candles_mig RENAME TO ohlcv_candles`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_candles_lookup ON ohlcv_candles(symbol, exchange, timeframe, timestamp DESC)`);
      }
    } catch (e) {}

    // Strategies table
    await safeAddColumn('symbol_strategies', 'leverage INTEGER DEFAULT 20');
    await safeAddColumn('symbol_strategies', "margin_mode TEXT DEFAULT 'ISOLATED'");
    await safeAddColumn('symbol_strategies', "order_type TEXT DEFAULT 'MARKET'");

    // Positions table
    await safeAddColumn('trade_positions', 'signal_type TEXT');
    await safeAddColumn('trade_positions', 'leverage INTEGER DEFAULT 20');
    await safeAddColumn('trade_positions', "margin_mode TEXT DEFAULT 'ISOLATED'");
    await safeAddColumn('trade_positions', 'exit_price REAL');
    await safeAddColumn('trade_positions', 'initial_margin REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'maintenance_margin REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'liq_price REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'margin_ratio REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'roe_pct REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'is_liquidated INTEGER DEFAULT 0');
    await safeAddColumn('trade_positions', 'entry_fee REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'exit_fee REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'funding_fee REAL DEFAULT 0.0');
    await safeAddColumn('trade_positions', 'duration_seconds INTEGER DEFAULT 0');
    
    // Quantitative rationale & features columns
    await safeAddColumn('trade_positions', 'cmo_val REAL');
    await safeAddColumn('trade_positions', 'atr_val REAL');
    await safeAddColumn('trade_positions', 'atr_pct REAL');
    await safeAddColumn('trade_positions', 'rr_ratio REAL');
    await safeAddColumn('trade_positions', 'nearest_liq_dist_pct REAL');
    await safeAddColumn('trade_positions', 'danger_level REAL');
    await safeAddColumn('trade_positions', 'market_regime TEXT');
    await safeAddColumn('trade_positions', 'side_rationale TEXT');
    await safeAddColumn('trade_positions', 'entry_rationale TEXT');
    await safeAddColumn('trade_positions', 'tp1_rationale TEXT');
    await safeAddColumn('trade_positions', 'tp2_rationale TEXT');
    await safeAddColumn('trade_positions', 'sl_rationale TEXT');
    await safeAddColumn('trade_positions', 'features_json TEXT');

    // Signals table features
    await safeAddColumn('signals_alerts', 'cmo_val REAL');
    await safeAddColumn('signals_alerts', 'atr_val REAL');
    await safeAddColumn('signals_alerts', 'nearest_liq_dist_pct REAL');
    await safeAddColumn('signals_alerts', 'danger_level REAL');
    await safeAddColumn('signals_alerts', 'market_regime TEXT');
    await safeAddColumn('signals_alerts', 'side_rationale TEXT');
    await safeAddColumn('signals_alerts', 'entry_rationale TEXT');
    await safeAddColumn('signals_alerts', 'tp1_rationale TEXT');
    await safeAddColumn('signals_alerts', 'tp2_rationale TEXT');
    await safeAddColumn('signals_alerts', 'sl_rationale TEXT');
    await safeAddColumn('signals_alerts', 'features_json TEXT');
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

  // ── WHITELIST SYMBOLS (MULTI-EXCHANGE) ──
  async getWhitelistSymbols(exchange = null) {
    if (exchange) {
      return await this.all('SELECT * FROM whitelist_symbols WHERE exchange = ? ORDER BY created_at ASC', [exchange.toUpperCase()]);
    }
    return await this.all('SELECT * FROM whitelist_symbols ORDER BY created_at ASC');
  }

  async addWhitelistSymbol(symbol, category = 'Futures', tags = [], exchange = 'BINANCE') {
    const ex = (exchange || 'BINANCE').toUpperCase();
    const id = `sym_${ex.toLowerCase()}_${symbol.toLowerCase()}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO whitelist_symbols (id, symbol, exchange, is_enabled, category, tags, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET is_enabled = 1, updated_at = ?
    `, [id, symbol.toUpperCase(), ex, category, JSON.stringify(tags), now, now, now]);

    // Create default 5m & 15m strategies
    await this.addStrategy(symbol.toUpperCase(), `${symbol.toUpperCase()} Dual 5m Pro`, 'dual', '5m', 1.0, 20, ex);
    await this.addStrategy(symbol.toUpperCase(), `${symbol.toUpperCase()} Dual 15m Pro`, 'dual', '15m', 1.0, 20, ex);
    return id;
  }

  async toggleWhitelistSymbol(id, isEnabled) {
    const now = Date.now();
    await this.run('UPDATE whitelist_symbols SET is_enabled = ?, updated_at = ? WHERE id = ?', [isEnabled ? 1 : 0, now, id]);
    const sym = await this.get('SELECT symbol, exchange FROM whitelist_symbols WHERE id = ?', [id]);
    if (sym) {
      await this.run('UPDATE symbol_strategies SET is_enabled = ?, updated_at = ? WHERE symbol = ? AND exchange = ?', [isEnabled ? 1 : 0, now, sym.symbol, sym.exchange]);
    }
  }

  async deleteWhitelistSymbol(id) {
    const sym = await this.get('SELECT symbol, exchange FROM whitelist_symbols WHERE id = ?', [id]);
    if (sym) {
      await this.run('DELETE FROM symbol_strategies WHERE symbol = ? AND exchange = ?', [sym.symbol, sym.exchange]);
      await this.run('DELETE FROM ohlcv_candles WHERE symbol = ? AND exchange = ?', [sym.symbol, sym.exchange]);
    }
    await this.run('DELETE FROM whitelist_symbols WHERE id = ?', [id]);
  }

  // ── SYMBOL STRATEGIES (MULTI-EXCHANGE) ──
  async getStrategiesForSymbol(symbol, exchange = 'BINANCE') {
    return await this.all('SELECT * FROM symbol_strategies WHERE symbol = ? AND exchange = ? ORDER BY timeframe ASC', [symbol.toUpperCase(), exchange.toUpperCase()]);
  }

  async getAllEnabledStrategies(exchange = null) {
    if (exchange) {
      return await this.all(`
        SELECT s.* 
        FROM symbol_strategies s
        JOIN whitelist_symbols w ON s.symbol = w.symbol AND s.exchange = w.exchange
        WHERE s.is_enabled = 1 AND w.is_enabled = 1 AND s.exchange = ?
      `, [exchange.toUpperCase()]);
    }
    return await this.all(`
      SELECT s.* 
      FROM symbol_strategies s
      JOIN whitelist_symbols w ON s.symbol = w.symbol AND s.exchange = w.exchange
      WHERE s.is_enabled = 1 AND w.is_enabled = 1
    `);
  }

  async addStrategy(symbol, name, type = 'dual', timeframe = '5m', riskPct = 1.0, leverage = 20, exchange = 'BINANCE') {
    const ex = (exchange || 'BINANCE').toUpperCase();
    const id = `strat_${ex.toLowerCase()}_${symbol.toLowerCase()}_${timeframe}_${type}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO symbol_strategies (
        id, symbol, exchange, strategy_name, strategy_type, timeframe, is_enabled, risk_pct, leverage, margin_mode, order_type,
        cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct, fvg_threshold_pct, swing_lookback,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, 1, ?, ?, 'ISOLATED', 'MARKET',
        14, 21, 14, 2.0, 0.35, 1.5, 1.5, 30,
        ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET is_enabled = 1, updated_at = ?
    `, [id, symbol.toUpperCase(), ex, name, type, timeframe, riskPct, leverage, now, now, now]);
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

  // ── OHLCV CANDLES (MULTI-EXCHANGE) ──
  async saveCandles(symbol, timeframe, candles, exchange = 'BINANCE') {
    if (!candles || candles.length === 0) return;
    const ex = (exchange || 'BINANCE').toUpperCase();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ohlcv_candles (symbol, exchange, timeframe, timestamp, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.serialize(() => {
      this.db.run('BEGIN TRANSACTION');
      for (const c of candles) {
        stmt.run([symbol.toUpperCase(), ex, timeframe, c.time, c.open, c.high, c.low, c.close, c.volume]);
      }
      this.db.run('COMMIT');
    });
  }

  async getCandles(symbol, timeframe, limit = 1500, exchange = 'BINANCE') {
    const ex = (exchange || 'BINANCE').toUpperCase();
    const rows = await this.all(`
      SELECT timestamp as time, open, high, low, close, volume
      FROM ohlcv_candles
      WHERE symbol = ? AND exchange = ? AND timeframe = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [symbol.toUpperCase(), ex, timeframe, limit]);
    return rows.reverse();
  }

  // ── SIGNALS & ALERTS FEED (MULTI-EXCHANGE) ──
  async saveSignal(signal) {
    const ex = (signal.exchange || 'BINANCE').toUpperCase();
    const id = `sig_${ex.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO signals_alerts (
        id, symbol, exchange, strategy_id, strategy_name, timeframe, signal_type, direction,
        entry_price, tp1_price, tp2_price, sl_price, cmo_val, atr_val, atr_pct, rr_ratio,
        nearest_liq_dist_pct, danger_level, market_regime, side_rationale, entry_rationale,
        tp1_rationale, tp2_rationale, sl_rationale, rationale, features_json,
        timestamp, is_sent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `, [
      id,
      signal.symbol.toUpperCase(),
      ex,
      signal.strategy_id || '',
      signal.strategy_name || '',
      signal.timeframe,
      signal.signal_type,
      signal.direction,
      signal.entry_price,
      signal.tp1_price,
      signal.tp2_price,
      signal.sl_price,
      signal.cmo_val || 0,
      signal.atr_val || 0,
      signal.atr_pct || 0,
      signal.rr_ratio || 0,
      signal.nearest_liq_dist_pct || null,
      signal.danger_level || null,
      signal.market_regime || '',
      signal.side_rationale || '',
      signal.entry_rationale || '',
      signal.tp1_rationale || '',
      signal.tp2_rationale || '',
      signal.sl_rationale || '',
      signal.rationale || signal.side_rationale || '',
      typeof signal.features_json === 'object' ? JSON.stringify(signal.features_json) : (signal.features_json || '{}'),
      signal.timestamp || now,
      now
    ]);
    return id;
  }

  async getSignals(limit = 50, exchange = null) {
    if (exchange) {
      return await this.all('SELECT * FROM signals_alerts WHERE exchange = ? ORDER BY timestamp DESC LIMIT ?', [exchange.toUpperCase(), limit]);
    }
    return await this.all('SELECT * FROM signals_alerts ORDER BY timestamp DESC LIMIT ?', [limit]);
  }

  // ── TRADE POSITIONS & PERFORMANCE (MULTI-EXCHANGE) ──
  async createPosition(pos) {
    const ex = (pos.exchange || 'BINANCE').toUpperCase();
    const id = `pos_${ex.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO trade_positions (
        id, symbol, exchange, strategy_id, signal_id, signal_type, direction, status,
        leverage, margin_mode, entry_price, current_price,
        tp1_price, tp2_price, sl_price, original_sl,
        pos_size_usd, quantity, initial_margin, maintenance_margin,
        liq_price, margin_ratio, roe_pct, cmo_val, atr_val, atr_pct, rr_ratio,
        nearest_liq_dist_pct, danger_level, market_regime,
        side_rationale, entry_rationale, tp1_rationale, tp2_rationale, sl_rationale,
        features_json, is_tp1_hit, is_be_moved, is_liquidated,
        gross_pnl_usd, fee_usd, entry_fee, exit_fee, funding_fee,
        net_pnl_usd, net_pnl_pct, open_time, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, 'ACTIVE',
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, 0.0, 0.0, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, 0, 0, 0,
        0.0, ?, ?, 0.0, 0.0,
        0.0, 0.0, ?, ?, ?
      )
    `, [
      id,
      pos.symbol.toUpperCase(),
      ex,
      pos.strategy_id || '',
      pos.signal_id || '',
      pos.signal_type || '',
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
      pos.cmo_val || 0.0,
      pos.atr_val || 0.0,
      pos.atr_pct || 0.0,
      pos.rr_ratio || 0.0,
      pos.nearest_liq_dist_pct || null,
      pos.danger_level || null,
      pos.market_regime || '',
      pos.side_rationale || '',
      pos.entry_rationale || '',
      pos.tp1_rationale || '',
      pos.tp2_rationale || '',
      pos.sl_rationale || '',
      typeof pos.features_json === 'object' ? JSON.stringify(pos.features_json) : (pos.features_json || '{}'),
      pos.fee_usd || 0.0,
      pos.entry_fee || pos.fee_usd || 0.0,
      pos.open_time || now,
      now,
      now
    ]);
    return id;
  }

  async getActivePositions(exchange = null) {
    if (exchange) {
      return await this.all("SELECT * FROM trade_positions WHERE status = 'ACTIVE' AND exchange = ? ORDER BY open_time DESC", [exchange.toUpperCase()]);
    }
    return await this.all("SELECT * FROM trade_positions WHERE status = 'ACTIVE' ORDER BY open_time DESC");
  }

  async getPositionById(id) {
    return await this.get('SELECT * FROM trade_positions WHERE id = ?', [id]);
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

  async getAllPositions(limit = 200, exchange = null) {
    if (exchange) {
      return await this.all('SELECT * FROM trade_positions WHERE exchange = ? ORDER BY open_time DESC LIMIT ?', [exchange.toUpperCase(), limit]);
    }
    return await this.all('SELECT * FROM trade_positions ORDER BY open_time DESC LIMIT ?', [limit]);
  }

  async getPerformanceStats(exchange = null) {
    const closedSql = exchange
      ? "SELECT * FROM trade_positions WHERE status != 'ACTIVE' AND exchange = ?"
      : "SELECT * FROM trade_positions WHERE status != 'ACTIVE'";
    const activeSql = exchange
      ? "SELECT * FROM trade_positions WHERE status = 'ACTIVE' AND exchange = ?"
      : "SELECT * FROM trade_positions WHERE status = 'ACTIVE'";

    const closedTrades = await this.all(closedSql, exchange ? [exchange.toUpperCase()] : []);
    const activePositions = await this.all(activeSql, exchange ? [exchange.toUpperCase()] : []);

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
      exchange: exchange || 'ALL',
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
  async resetTradesAndSignals(exchange = null) {
    if (exchange) {
      await this.run('DELETE FROM trade_positions WHERE exchange = ?', [exchange.toUpperCase()]);
      await this.run('DELETE FROM signals_alerts WHERE exchange = ?', [exchange.toUpperCase()]);
    } else {
      await this.run('DELETE FROM trade_positions');
      await this.run('DELETE FROM signals_alerts');
    }
    await this.setSetting('account_equity', '1000.00');
    try { await this.run('VACUUM'); } catch (e) {}
  }

  // ── CHART DRAWINGS PERSISTENCE ──
  async saveDrawing(drawing) {
    const { id, symbol, exchange, timeframe, drawing_type, data_json } = drawing;
    const now = Date.now();
    await this.run(`
      INSERT INTO chart_drawings (id, symbol, exchange, timeframe, drawing_type, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        timeframe = excluded.timeframe,
        drawing_type = excluded.drawing_type,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `, [
      id || `draw_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      symbol.toUpperCase(),
      (exchange || 'BINANCE').toUpperCase(),
      timeframe || null,
      drawing_type,
      typeof data_json === 'object' ? JSON.stringify(data_json) : data_json,
      now,
      now
    ]);
    return { success: true, id };
  }

  async getDrawings(symbol, exchange = null) {
    if (exchange && exchange !== 'ALL') {
      const rows = await this.all(
        'SELECT * FROM chart_drawings WHERE symbol = ? AND exchange = ? ORDER BY created_at ASC',
        [symbol.toUpperCase(), exchange.toUpperCase()]
      );
      return rows.map(r => ({ ...r, data: JSON.parse(r.data_json || '{}') }));
    }
    const rows = await this.all(
      'SELECT * FROM chart_drawings WHERE symbol = ? ORDER BY created_at ASC',
      [symbol.toUpperCase()]
    );
    return rows.map(r => ({ ...r, data: JSON.parse(r.data_json || '{}') }));
  }

  async deleteDrawing(id) {
    await this.run('DELETE FROM chart_drawings WHERE id = ?', [id]);
    return { success: true };
  }

  async clearDrawings(symbol, exchange = null) {
    if (exchange && exchange !== 'ALL') {
      await this.run('DELETE FROM chart_drawings WHERE symbol = ? AND exchange = ?', [symbol.toUpperCase(), exchange.toUpperCase()]);
    } else {
      await this.run('DELETE FROM chart_drawings WHERE symbol = ?', [symbol.toUpperCase()]);
    }
    return { success: true };
  }

  // ── ORDER & TRADE NOTES PERSISTENCE ──
  async saveOrderNote(targetId, symbol, noteText) {
    const now = Date.now();
    await this.run(`
      INSERT INTO order_notes (id, target_id, symbol, note_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_id) DO UPDATE SET
        symbol = excluded.symbol,
        note_text = excluded.note_text,
        updated_at = excluded.updated_at
    `, [
      `note_${targetId}`,
      targetId,
      (symbol || '').toUpperCase(),
      noteText || '',
      now,
      now
    ]);
    return { success: true, target_id: targetId, note_text: noteText };
  }

  async getOrderNote(targetId) {
    const row = await this.get('SELECT * FROM order_notes WHERE target_id = ?', [targetId]);
    return row || { target_id: targetId, note_text: '' };
  }

  async getAllOrderNotes() {
    return await this.all('SELECT * FROM order_notes ORDER BY updated_at DESC');
  }

  async resetEntireDatabase() {
    await this.run('DELETE FROM trade_positions');
    await this.run('DELETE FROM signals_alerts');
    await this.run('DELETE FROM ohlcv_candles');
    await this.run('DELETE FROM symbol_strategies');
    await this.run('DELETE FROM whitelist_symbols');
    await this.run('DELETE FROM chart_drawings');
    await this.run('DELETE FROM order_notes');
    await this.setSetting('account_equity', '1000.00');
    await this.setSetting('is_scanner_active', '1');
    try { await this.run('VACUUM'); } catch (e) {}
  }

  // ── SETUP WIZARD INITIALIZER ──
  async initializeSystemWithWizard(options = {}) {
    const {
      resetTables = true,
      initialBalance = 1000.0,
      riskPct = 1.0,
      maxLeverage = 20,
      marginMode = 'ISOLATED',
      tp1Ratio = 1.5,
      tp1ClosePct = 50,
      autoBreakeven = true,
      tp2Ratio = 3.0,
      maxConcurrentPositions = 5,
      dailyDrawdownPct = 4.0,
      enabledExchanges = ['BINANCE', 'BYBIT', 'OKX', 'BITGET', 'GATE', 'BINGX'],
      autoSeedSymbols = true
    } = options;

    if (resetTables) {
      await this.run('DELETE FROM trade_positions');
      await this.run('DELETE FROM signals_alerts');
      await this.run('DELETE FROM ohlcv_candles');
      await this.run('DELETE FROM symbol_strategies');
      await this.run('DELETE FROM whitelist_symbols');
      await this.run('DELETE FROM chart_drawings');
      await this.run('DELETE FROM order_notes');
      try { await this.run('VACUUM'); } catch (e) {}
    }

    // Save System Risk & Capital Settings
    await this.setSetting('account_equity', String(Number(initialBalance).toFixed(2)));
    await this.setSetting('initial_capital', String(Number(initialBalance).toFixed(2)));
    await this.setSetting('risk_pct_per_trade', String(riskPct));
    await this.setSetting('max_leverage', String(maxLeverage));
    await this.setSetting('margin_mode', marginMode);
    await this.setSetting('tp1_ratio', String(tp1Ratio));
    await this.setSetting('tp1_close_pct', String(tp1ClosePct));
    await this.setSetting('auto_breakeven', autoBreakeven ? '1' : '0');
    await this.setSetting('tp2_ratio', String(tp2Ratio));
    await this.setSetting('max_concurrent_positions', String(maxConcurrentPositions));
    await this.setSetting('daily_max_drawdown_pct', String(dailyDrawdownPct));
    await this.setSetting('enabled_exchanges', JSON.stringify(enabledExchanges));
    await this.setSetting('is_scanner_active', '1');
    await this.setSetting('wizard_completed_at', String(Date.now()));

    // Seed 90% perpetual symbols for enabled exchanges
    const discoverySummary = [];
    if (autoSeedSymbols && enabledExchanges && enabledExchanges.length > 0) {
      const exchangeManager = require('./exchanges');
      for (const ex of enabledExchanges) {
        try {
          const res = await exchangeManager.discoverAndSeedPerpetuals(ex);
          discoverySummary.push(...res);
        } catch (err) {
          discoverySummary.push({ exchange: ex, error: err.message });
        }
      }
    }

    return {
      success: true,
      initialBalance: Number(initialBalance),
      riskSettings: { riskPct, maxLeverage, marginMode, tp1Ratio, tp1ClosePct, autoBreakeven, tp2Ratio, maxConcurrentPositions, dailyDrawdownPct },
      enabledExchanges,
      discoverySummary
    };
  }
}

module.exports = new DBManager();
