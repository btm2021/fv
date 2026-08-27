// Native .env file loader
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...values] = trimmed.split('=');
        if (key) {
          const val = values.join('=').trim().replace(/^["']|["']$/g, '');
          process.env[key.trim()] = val;
        }
      }
    });
  } catch (e) {}
}

const DB = require('./server/db');
const { server } = require('./server/app');
const scanner = require('./server/scanner');
const binanceWs = require('./server/binanceWs');

const PORT = parseInt(process.env.PORT, 10) || 8080;

// CLI Parameter Check: node server.js --reset
const isResetMode = process.argv.includes('--reset') || process.argv.includes('-r') || process.argv.includes('--reset-db') || process.env.RESET_DB === 'true';

async function bootstrap() {
  await DB.waitUntilReady();

  if (isResetMode) {
    console.log(`\n🧹 [RESET MODE DETECTED] Executing full clean system reset from scratch...`);
    await DB.resetAll();
    console.log(`✅ [RESET COMPLETE] All active/closed positions, signals, journal notes, and equity ($10,000.00) have been cleanly reset to initial state.\n`);
  }

  server.listen(PORT, () => {
    console.log(`\n══════════════════════════════════════════════════════════════════════`);
    console.log(`🌐 TRADING DASHBOARD & SCANNER ENGINE LIVE AT: http://localhost:${PORT}`);
    if (isResetMode) {
      console.log(`⚡ RUNNING IN CLEAN-SLATE RESET MODE (--reset)`);
    }
    console.log(`══════════════════════════════════════════════════════════════════════\n`);

    // 1. Connect Real-Time Binance WebSocket Price Stream (!miniTicker@arr)
    binanceWs.connect();

    // 2. Start 24/7 Scanner Engine
    scanner.start();
  });
}

bootstrap();

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\nStopping 24/7 Trading System...');
  scanner.stop();
  binanceWs.close();
  process.exit(0);
});
