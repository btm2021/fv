const { server } = require('./server/app');
const scanner = require('./server/scanner');
const binanceWs = require('./server/binanceWs');

const PORT = process.env.PORT || 3000;

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
