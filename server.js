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

const { server } = require('./server/app');
const scanner = require('./server/scanner');
const binanceWs = require('./server/binanceWs');

const PORT = parseInt(process.env.PORT, 10) || 80;

server.listen(PORT, () => {
  console.log(`\n══════════════════════════════════════════════════════════════════════`);
  console.log(`🌐 TRADING DASHBOARD & SCANNER ENGINE LIVE AT: http://localhost:${PORT}`);
  console.log(`══════════════════════════════════════════════════════════════════════\n`);

  // 1. Connect Real-Time Binance WebSocket Price Stream (!miniTicker@arr)
  binanceWs.connect();

  // 2. Start 24/7 Scanner Engine
  scanner.start();
});

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\nStopping 24/7 Trading System...');
  scanner.stop();
  binanceWs.close();
  process.exit(0);
});
