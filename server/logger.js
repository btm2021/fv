/**
 * Centralized High-Precision Logging Engine for 24/7 Quantum Trading Hub
 * Outputs colored, structured terminal logs and broadcasts in real-time to Web Dashboard
 */

// ANSI Color Codes for Terminal
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m'
};

class Logger {
  constructor() {
    this.buffer = [];
    this.maxBufferSize = 500;
    this.wsBroadcaster = null;
  }

  setBroadcaster(broadcasterFn) {
    this.wsBroadcaster = broadcasterFn;
  }

  getTimestamp() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 19);
  }

  log(level, category, message, data = null) {
    const timestamp = this.getTimestamp();
    const logItem = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp,
      level: level.toUpperCase(),
      category: category.toUpperCase(),
      message,
      data
    };

    // Store in circular memory buffer
    this.buffer.push(logItem);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    // 1. Output formatted message to Terminal
    this.printToTerminal(logItem);

    // 2. Broadcast to Web Dashboard via WebSockets
    if (this.wsBroadcaster && typeof this.wsBroadcaster === 'function') {
      try {
        this.wsBroadcaster('SYSTEM_LOG', logItem);
      } catch (e) {
        // non-blocking
      }
    }

    return logItem;
  }

  printToTerminal(item) {
    const { timestamp, level, category, message } = item;
    let lvlColor = COLORS.cyan;
    let tag = `[${category}]`;

    switch (level) {
      case 'SUCCESS':
        lvlColor = COLORS.green;
        break;
      case 'WARN':
        lvlColor = COLORS.yellow;
        break;
      case 'ERROR':
        lvlColor = COLORS.red;
        break;
      case 'SIGNAL':
        lvlColor = COLORS.magenta;
        break;
      case 'TRADE':
        lvlColor = COLORS.green;
        break;
      default:
        lvlColor = COLORS.cyan;
    }

    const timeStr = `${COLORS.gray}${timestamp}${COLORS.reset}`;
    const catStr = `${lvlColor}${COLORS.bright}${tag.padEnd(12)}${COLORS.reset}`;
    console.log(`${timeStr} ${catStr} ${message}`);
  }

  info(category, message, data = null) {
    return this.log('INFO', category, message, data);
  }

  success(category, message, data = null) {
    return this.log('SUCCESS', category, message, data);
  }

  warn(category, message, data = null) {
    return this.log('WARN', category, message, data);
  }

  error(category, message, data = null) {
    return this.log('ERROR', category, message, data);
  }

  signal(category, message, data = null) {
    return this.log('SIGNAL', category, message, data);
  }

  trade(category, message, data = null) {
    return this.log('TRADE', category, message, data);
  }

  getLogs(limit = 100, category = null, level = null) {
    let result = [...this.buffer];
    if (category) {
      result = result.filter(l => l.category === category.toUpperCase());
    }
    if (level) {
      result = result.filter(l => l.level === level.toUpperCase());
    }
    return result.slice(-limit);
  }

  clear() {
    this.buffer = [];
  }
}

module.exports = new Logger();
