const DB = require('./db');
const logger = require('./logger');

class NotificationDispatcher {
  constructor() {
    this.wsClients = new Set();
    // Connect logger to WebSocket broadcaster
    logger.setBroadcaster((type, payload) => this.broadcast(type, payload));
  }

  registerWsClient(ws) {
    this.wsClients.add(ws);
    logger.info('WS', `Client connected. Total active UI sessions: ${this.wsClients.size}`);
    ws.on('close', () => {
      this.wsClients.delete(ws);
      logger.info('WS', `Client disconnected. Remaining active UI sessions: ${this.wsClients.size}`);
    });
  }

  broadcast(type, payload) {
    const msg = JSON.stringify({ type, data: payload, timestamp: Date.now() });
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) { // OPEN
        ws.send(msg);
      }
    }
  }

  async sendSignalAlert(signal) {
    // 1. Broadcast to Web Dashboard via WebSockets
    this.broadcast('NEW_SIGNAL', signal);

    // 2. Telegram Alert
    const botToken = await DB.getSetting('telegram_bot_token', '');
    const chatId = await DB.getSetting('telegram_chat_id', '');

    if (botToken && chatId) {
      try {
        const isLong = signal.direction === 'BUY';
        const icon = signal.signal_type.startsWith('FADE') ? '⚡' : (isLong ? '▲' : '▼');
        const text = `
${icon} <b>SMC + ATRBOT SIGNAL DETECTED</b>

🪙 <b>Symbol:</b> <code>${signal.symbol}</code> (${signal.timeframe})
🎯 <b>Strategy:</b> ${signal.strategy_name}
📊 <b>Type:</b> <code>${signal.signal_type}</code> (${signal.direction})

🔹 <b>Entry:</b> <code>${signal.entry_price}</code>
🎯 <b>TP1 (FVG):</b> <code>${signal.tp1_price}</code> (+${signal.tp1_pct.toFixed(1)}%)
🏆 <b>TP2 (Liq):</b> <code>${signal.tp2_price}</code> (+${signal.tp2_pct.toFixed(1)}%)
🛑 <b>SL (Swing):</b> <code>${signal.sl_price}</code> (-${signal.sl_pct.toFixed(1)}%)

⚖️ <b>R:R Ratio:</b> 1 : ${(signal.rr_ratio || 2.0).toFixed(2)}
📈 <b>ATR Engine:</b> ${(signal.atr_pct || 0.5).toFixed(2)}%
🕒 <b>Time:</b> ${new Date(signal.timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19)}

💡 <i>${signal.side_rationale || ''}</i>
        `.trim();

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
          })
        });
      } catch (err) {
        console.error('[Telegram Alert Error]', err.message);
      }
    }

    // 3. Discord Webhook
    const discordWebhook = await DB.getSetting('discord_webhook_url', '');
    if (discordWebhook) {
      try {
        const isLong = signal.direction === 'BUY';
        const color = isLong ? 0x10b981 : 0xf43f5e;
        await fetch(discordWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{
              title: `⚡ SMC Signal: ${signal.symbol} ${signal.signal_type}`,
              color: color,
              fields: [
                { name: 'Symbol / TF', value: `${signal.symbol} (${signal.timeframe})`, inline: true },
                { name: 'Direction', value: signal.direction, inline: true },
                { name: 'Entry', value: `${signal.entry_price}`, inline: true },
                { name: 'TP1 (50% + BE)', value: `${signal.tp1_price} (+${signal.tp1_pct.toFixed(1)}%)`, inline: true },
                { name: 'TP2 (Liq)', value: `${signal.tp2_price} (+${signal.tp2_pct.toFixed(1)}%)`, inline: true },
                { name: 'Stop Loss', value: `${signal.sl_price} (-${signal.sl_pct.toFixed(1)}%)`, inline: true }
              ],
              footer: { text: `ATR: ${(signal.atr_pct || 0.5).toFixed(2)}% | R:R: ${(signal.rr_ratio || 2.0).toFixed(2)}` },
              timestamp: new Date().toISOString()
            }]
          })
        });
      } catch (err) {
        console.error('[Discord Alert Error]', err.message);
      }
    }
  }
}

module.exports = new NotificationDispatcher();
