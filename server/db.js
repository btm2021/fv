/**
 * SQLite3 Database Manager for 24/7 SMC + ATRBot Trading System
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

      -- 6. Simulated / Live Trade Positions
      CREATE TABLE IF NOT EXISTS trade_positions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        strategy_id TEXT,
        signal_id TEXT,
        direction TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        entry_price REAL NOT NULL,
        current_price REAL,
        tp1_price REAL NOT NULL,
        tp2_price REAL NOT NULL,
        sl_price REAL NOT NULL,
        original_sl REAL NOT NULL,
        pos_size_usd REAL NOT NULL,
        quantity REAL NOT NULL,
        is_tp1_hit INTEGER DEFAULT 0,
        is_be_moved INTEGER DEFAULT 0,
        gross_pnl_usd REAL DEFAULT 0.0,
        fee_usd REAL DEFAULT 0.0,
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
      else this.seedDefaults();
    });
  }

  async seedDefaults() {
    const defaultSettings = [
      { key: 'account_equity', value: '1000.00' },
      { key: 'default_risk_pct', value: '1.0' },
      { key: 'candle_buffer_limit', value: '1500' },
      { key: 'is_scanner_active', value: '1' },
      { key: 'paper_trading_mode', value: '1' },
      { key: 'telegram_bot_token', value: '' },
      { key: 'telegram_chat_id', value: '' },
      { key: 'discord_webhook_url', value: '' }
    ];

    for (const s of defaultSettings) {
      await this.run(
        'INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)',
        [s.key, s.value, Date.now()]
      );
    }

    const row = await this.get('SELECT COUNT(*) as count FROM whitelist_symbols');
    if (row && row.count === 0) {
      const seedSymbols = [
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT',
        'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT'
      ];
      const now = Date.now();
      for (const sym of seedSymbols) {
        const symId = `sym_${sym.toLowerCase()}`;
        await this.run(
          `INSERT OR IGNORE INTO whitelist_symbols (id, symbol, is_enabled, category, tags, created_at, updated_at)
           VALUES (?, ?, 1, 'Top Vol', '["Top10","Liquid"]', ?, ?)`,
          [symId, sym, now, now]
        );

        const stratId = `strat_${sym.toLowerCase()}_5m_dual`;
        await this.run(
          `INSERT OR IGNORE INTO symbol_strategies (
            id, symbol, strategy_name, strategy_type, timeframe, is_enabled, risk_pct,
            cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
            fvg_threshold_pct, swing_lookback, created_at, updated_at
          ) VALUES (?, ?, ?, 'dual', '5m', 1, 1.0, 14, 21, 14, 2.0, 0.35, 1.5, 1.5, 30, ?, ?)`,
          [stratId, sym, `${sym} Dual 5m Pro`, now, now]
        );
      }
      console.log('🌱 Seeded 10 default whitelist symbols & 5m Dual SMC strategies into SQLite.');
    }
  }

  // ── SETTINGS ──
  async getSetting(key, defaultVal = null) {
    const row = await this.get('SELECT value FROM system_settings WHERE key = ?', [key]);
    return row ? row.value : defaultVal;
  }

  async getAllSettings() {
    const rows = await this.all('SELECT key, value FROM system_settings');
    const res = {};
    for (const r of rows) res[r.key] = r.value;
    return res;
  }

  async setSetting(key, val) {
    await this.run(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, String(val), Date.now()]
    );
  }

  // ── WHITELIST ──
  async getWhitelistSymbols() {
    return await this.all('SELECT * FROM whitelist_symbols ORDER BY symbol ASC');
  }

  async addWhitelistSymbol(symbol, category = 'Custom') {
    const sym = symbol.toUpperCase().trim();
    const id = `sym_${sym.toLowerCase()}`;
    const now = Date.now();
    await this.run(
      `INSERT OR IGNORE INTO whitelist_symbols (id, symbol, is_enabled, category, tags, created_at, updated_at)
       VALUES (?, ?, 1, ?, '[]', ?, ?)`,
      [id, sym, category, now, now]
    );

    const stratId = `strat_${sym.toLowerCase()}_5m_dual`;
    await this.run(
      `INSERT OR IGNORE INTO symbol_strategies (
        id, symbol, strategy_name, strategy_type, timeframe, is_enabled, risk_pct,
        cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
        fvg_threshold_pct, swing_lookback, created_at, updated_at
      ) VALUES (?, ?, ?, 'dual', '5m', 1, 1.0, 14, 21, 14, 2.0, 0.35, 1.5, 1.5, 30, ?, ?)`,
      [stratId, sym, `${sym} Dual 5m Pro`, now, now]
    );

    return await this.get('SELECT * FROM whitelist_symbols WHERE symbol = ?', [sym]);
  }

  async toggleWhitelistSymbol(symbol, isEnabled) {
    await this.run(
      'UPDATE whitelist_symbols SET is_enabled = ?, updated_at = ? WHERE symbol = ?',
      [isEnabled ? 1 : 0, Date.now(), symbol]
    );
  }

  async deleteWhitelistSymbol(symbol) {
    await this.run('DELETE FROM whitelist_symbols WHERE symbol = ?', [symbol]);
    await this.run('DELETE FROM symbol_strategies WHERE symbol = ?', [symbol]);
  }

  // ── STRATEGIES ──
  async getStrategiesForSymbol(symbol) {
    return await this.all('SELECT * FROM symbol_strategies WHERE symbol = ? ORDER BY timeframe ASC', [symbol]);
  }

  async getAllEnabledStrategies() {
    return await this.all(`
      SELECT s.*, w.category 
      FROM symbol_strategies s
      JOIN whitelist_symbols w ON s.symbol = w.symbol
      WHERE s.is_enabled = 1 AND w.is_enabled = 1
      ORDER BY s.timeframe ASC, s.symbol ASC
    `);
  }

  async saveStrategy(data) {
    const id = data.id || `strat_${data.symbol.toLowerCase()}_${Date.now()}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO symbol_strategies (
        id, symbol, strategy_name, strategy_type, timeframe, is_enabled, risk_pct,
        cmo_length, ma_length, atr_length, atr_mult, min_atr_pct, liq_threshold_pct,
        fvg_threshold_pct, swing_lookback, inputs_json, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        strategy_name = excluded.strategy_name,
        strategy_type = excluded.strategy_type,
        timeframe = excluded.timeframe,
        is_enabled = excluded.is_enabled,
        risk_pct = excluded.risk_pct,
        cmo_length = excluded.cmo_length,
        ma_length = excluded.ma_length,
        atr_length = excluded.atr_length,
        atr_mult = excluded.atr_mult,
        min_atr_pct = excluded.min_atr_pct,
        liq_threshold_pct = excluded.liq_threshold_pct,
        fvg_threshold_pct = excluded.fvg_threshold_pct,
        swing_lookback = excluded.swing_lookback,
        inputs_json = excluded.inputs_json,
        updated_at = excluded.updated_at
    `, [
      id,
      data.symbol,
      data.strategy_name || `${data.symbol} ${data.timeframe}`,
      data.strategy_type || 'dual',
      data.timeframe || '5m',
      data.is_enabled !== undefined ? (data.is_enabled ? 1 : 0) : 1,
      Number(data.risk_pct) || 1.0,
      Number(data.cmo_length) || 14,
      Number(data.ma_length) || 21,
      Number(data.atr_length) || 14,
      Number(data.atr_mult) || 2.0,
      Number(data.min_atr_pct) || 0.35,
      Number(data.liq_threshold_pct) || 1.5,
      Number(data.fvg_threshold_pct) || 1.5,
      Number(data.swing_lookback) || 30,
      data.inputs_json || '{}',
      now,
      now
    ]);
    return id;
  }

  async deleteStrategy(id) {
    await this.run('DELETE FROM symbol_strategies WHERE id = ?', [id]);
  }

  // ── CANDLES ──
  async saveCandles(symbol, timeframe, candles) {
    if (!candles || candles.length === 0) return;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ohlcv_candles (symbol, timeframe, timestamp, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.serialize(() => {
      this.db.run('BEGIN TRANSACTION');
      for (const c of candles) {
        stmt.run(symbol, timeframe, Math.floor(c.time), c.open, c.high, c.low, c.close, c.volume);
      }
      this.db.run('COMMIT');
    });

    // Prune excess
    const limit = Number(await this.getSetting('candle_buffer_limit', '1500')) || 1500;
    await this.run(`
      DELETE FROM ohlcv_candles
      WHERE symbol = ? AND timeframe = ? AND timestamp NOT IN (
        SELECT timestamp FROM ohlcv_candles
        WHERE symbol = ? AND timeframe = ?
        ORDER BY timestamp DESC
        LIMIT ?
      )
    `, [symbol, timeframe, symbol, timeframe, limit]);
  }

  async getCandles(symbol, timeframe, limit = 1500) {
    const rows = await this.all(`
      SELECT timestamp as time, open, high, low, close, volume
      FROM ohlcv_candles
      WHERE symbol = ? AND timeframe = ?
      ORDER BY timestamp ASC
    `, [symbol, timeframe]);

    if (rows.length > limit) {
      return rows.slice(-limit);
    }
    return rows;
  }

  // ── SIGNALS ──
  async saveSignal(sig) {
    const id = sig.id || `sig_${sig.symbol}_${sig.timestamp}_${Date.now()}`;
    const now = Date.now();
    await this.run(`
      INSERT OR REPLACE INTO signals_alerts (
        id, symbol, strategy_id, strategy_name, timeframe, signal_type, direction,
        entry_price, tp1_price, tp2_price, sl_price, atr_pct, rr_ratio, rationale,
        timestamp, is_sent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `, [
      id,
      sig.symbol,
      sig.strategy_id || '',
      sig.strategy_name || '',
      sig.timeframe,
      sig.signal_type,
      sig.direction,
      sig.entry_price,
      sig.tp1_price,
      sig.tp2_price,
      sig.sl_price,
      sig.atr_pct || 0,
      sig.rr_ratio || 0,
      sig.rationale || sig.side_rationale || '',
      sig.timestamp,
      now
    ]);
    return id;
  }

  async getSignals(limit = 100) {
    return await this.all('SELECT * FROM signals_alerts ORDER BY timestamp DESC LIMIT ?', [limit]);
  }

  // ── POSITIONS ──
  async createPosition(pos) {
    const id = pos.id || `pos_${pos.symbol}_${Date.now()}`;
    const now = Date.now();
    await this.run(`
      INSERT INTO trade_positions (
        id, symbol, strategy_id, signal_id, direction, status, entry_price, current_price,
        tp1_price, tp2_price, sl_price, original_sl, pos_size_usd, quantity,
        is_tp1_hit, is_be_moved, gross_pnl_usd, fee_usd, net_pnl_usd, net_pnl_pct,
        open_time, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'ACTIVE', ?, ?,
        ?, ?, ?, ?, ?, ?,
        0, 0, 0.0, ?, 0.0, 0.0,
        ?, ?, ?
      )
    `, [
      id,
      pos.symbol,
      pos.strategy_id || '',
      pos.signal_id || '',
      pos.direction,
      pos.entry_price,
      pos.entry_price,
      pos.tp1_price,
      pos.tp2_price,
      pos.sl_price,
      pos.sl_price,
      pos.pos_size_usd,
      pos.quantity,
      pos.fee_usd || 0.0,
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
    const total = closedTrades.length;
    const wins = closedTrades.filter(t => t.net_pnl_usd > 0);
    const losses = closedTrades.filter(t => t.net_pnl_usd < 0);

    const winRate = total > 0 ? (wins.length / total * 100) : 0;
    const totalGain = wins.reduce((sum, t) => sum + t.net_pnl_usd, 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.net_pnl_usd, 0));
    const profitFactor = totalLoss > 0 ? (totalGain / totalLoss) : (totalGain > 0 ? 999 : 0);
    const netProfit = closedTrades.reduce((sum, t) => sum + t.net_pnl_usd, 0);

    const baseEq = Number(await this.getSetting('account_equity', '1000.00'));
    const equity = baseEq + netProfit;

    return {
      total_trades: total,
      wins: wins.length,
      losses: losses.length,
      win_rate: winRate,
      profit_factor: profitFactor,
      net_profit_usd: netProfit,
      current_equity_usd: equity
    };
  }
}

module.exports = new DBManager();
