/**
 * Trade Position Execution & Lifecycle Manager
 * Handles Paper Trading, Stop-Loss trailing to Breakeven (+0.05%), TP1/TP2 partial exits
 */
const DB = require('./db');
const logger = require('./logger');

class TradeExecutor {
  constructor() {
    this.isChecking = false;
  }

  /**
   * Opens a new position when a signal is detected
   */
  async openPositionFromSignal(signal) {
    const isPaper = (await DB.getSetting('paper_trading_mode', '1')) === '1';
    const currentEquity = Number(await DB.getSetting('account_equity', '1000.00'));
    const riskPct = Number(signal.risk_pct || (await DB.getSetting('default_risk_pct', '1.0'))) / 100.0;

    // Check if there is already an ACTIVE position for this symbol & strategy
    const existing = await DB.get(`
      SELECT id FROM trade_positions 
      WHERE symbol = ? AND strategy_id = ? AND status = 'ACTIVE'
    `, [signal.symbol, signal.strategy_id]);

    if (existing) {
      logger.warn('TRADE', `Active position already exists for ${signal.symbol} (${signal.strategy_id}). Skipping duplicate entry.`);
      return null;
    }

    // Position Sizing: Risk = Equity * RiskPct, Position = Risk / SL_Dist
    const slDistPct = Math.abs(signal.entry_price - signal.sl_price) / signal.entry_price;
    const effectiveSlPct = Math.max(slDistPct, 0.015);
    const riskUsd = currentEquity * riskPct;
    let posSizeUsd = riskUsd / effectiveSlPct;

    // Safety Leverage Cap (Max 10x)
    posSizeUsd = Math.min(posSizeUsd, currentEquity * 10.0);
    const quantity = posSizeUsd / signal.entry_price;
    const feeUsd = posSizeUsd * 0.0005; // 0.05% Taker entry fee

    const posId = await DB.createPosition({
      symbol: signal.symbol,
      strategy_id: signal.strategy_id,
      signal_id: signal.id,
      direction: signal.direction,
      entry_price: signal.entry_price,
      tp1_price: signal.tp1_price,
      tp2_price: signal.tp2_price,
      sl_price: signal.sl_price,
      pos_size_usd: posSizeUsd,
      quantity: quantity,
      fee_usd: feeUsd,
      open_time: signal.timestamp || Date.now()
    });

    const isLong = signal.direction === 'BUY';
    const sideTag = isLong ? '▲ LONG' : '▼ SHORT';
    logger.trade('EXECUTION', `🟢 [ORDER OPENED] ${sideTag} on ${signal.symbol} | Size: $${posSizeUsd.toFixed(2)} USD (Qty: ${quantity.toFixed(4)}) | Entry: ${signal.entry_price} | SL: ${signal.sl_price} (-${signal.sl_pct.toFixed(1)}%) | TP1: ${signal.tp1_price} | TP2: ${signal.tp2_price}`);
    return posId;
  }

  /**
   * Periodic check against live prices for all active positions
   */
  async updateActivePositions(livePriceMap) {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const activePositions = await DB.getActivePositions();
      if (!activePositions || activePositions.length === 0) {
        this.isChecking = false;
        return;
      }

      for (const pos of activePositions) {
        const currentPrice = livePriceMap[pos.symbol] || pos.current_price;
        if (!currentPrice) continue;

        const isLong = pos.direction === 'BUY';
        let updates = { current_price: currentPrice };

        // 1. Check TP1 Hit (Move Stop Loss to Breakeven + 0.05%)
        if (!pos.is_tp1_hit) {
          const isTp1Reached = isLong ? (currentPrice >= pos.tp1_price) : (currentPrice <= pos.tp1_price);
          if (isTp1Reached) {
            updates.is_tp1_hit = 1;
            updates.is_be_moved = 1;
            // Move SL to Breakeven + fee margin
            const beSl = isLong ? pos.entry_price * 1.0005 : pos.entry_price * 0.9995;
            updates.sl_price = beSl;
            logger.trade('TP_HIT', `🎯 [TP1 TRIGGERED] ${pos.symbol} touched TP1 (${pos.tp1_price}). Trailing SL automatically moved to Breakeven (${beSl.toFixed(4)})!`);
          }
        }

        // 2. Check TP2 Hit (Take full profit & Close)
        const isTp2Reached = isLong ? (currentPrice >= pos.tp2_price) : (currentPrice <= pos.tp2_price);
        if (isTp2Reached) {
          const grossPnlPct = isLong ? ((pos.tp2_price - pos.entry_price) / pos.entry_price) : ((pos.entry_price - pos.tp2_price) / pos.entry_price);
          const grossPnlUsd = pos.pos_size_usd * grossPnlPct;
          const exitFee = pos.pos_size_usd * 0.0002; // Maker fee 0.02%
          const totalFee = (pos.fee_usd || 0) + exitFee;
          const netPnlUsd = grossPnlUsd - totalFee;

          updates.status = 'TP2_HIT';
          updates.close_time = Date.now();
          updates.exit_reason = 'TP2_HIT';
          updates.gross_pnl_usd = grossPnlUsd;
          updates.fee_usd = totalFee;
          updates.net_pnl_usd = netPnlUsd;
          updates.net_pnl_pct = (netPnlUsd / pos.pos_size_usd) * 100.0;

          await DB.updatePosition(pos.id, updates);
          logger.trade('WIN_CLOSE', `🏆 [TP2 WIN REACHED] ${pos.symbol} fully closed at target TP2 (${pos.tp2_price}). Net Profit: +$${netPnlUsd.toFixed(2)} USD (+${updates.net_pnl_pct.toFixed(2)}%)!`);
          continue;
        }

        // 3. Check Stop-Loss Hit (or Breakeven Stop Hit)
        const isSlHit = isLong ? (currentPrice <= pos.sl_price) : (currentPrice >= pos.sl_price);
        if (isSlHit) {
          const grossPnlPct = isLong ? ((pos.sl_price - pos.entry_price) / pos.entry_price) : ((pos.entry_price - pos.sl_price) / pos.entry_price);
          const grossPnlUsd = pos.pos_size_usd * grossPnlPct;
          const exitFee = pos.pos_size_usd * 0.0005; // Taker market stop fee
          const totalFee = (pos.fee_usd || 0) + exitFee;
          const netPnlUsd = grossPnlUsd - totalFee;

          const exitStatus = pos.is_be_moved ? 'BE_HIT' : 'SL_HIT';
          updates.status = exitStatus;
          updates.close_time = Date.now();
          updates.exit_reason = exitStatus;
          updates.gross_pnl_usd = grossPnlUsd;
          updates.fee_usd = totalFee;
          updates.net_pnl_usd = netPnlUsd;
          updates.net_pnl_pct = (netPnlUsd / pos.pos_size_usd) * 100.0;

          await DB.updatePosition(pos.id, updates);
          const icon = pos.is_be_moved ? '⚡' : '🛑';
          logger.trade(exitStatus, `${icon} [${exitStatus}] ${pos.symbol} closed at SL (${pos.sl_price}). Net Realized PnL: ${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)} USD`);
          continue;
        }

        // 4. Update Unrealized PnL while trade is active
        const unrealizedPnlPct = isLong ? ((currentPrice - pos.entry_price) / pos.entry_price) : ((pos.entry_price - currentPrice) / pos.entry_price);
        const unrealizedPnlUsd = pos.pos_size_usd * unrealizedPnlPct;
        updates.gross_pnl_usd = unrealizedPnlUsd;
        updates.net_pnl_usd = unrealizedPnlUsd - (pos.fee_usd || 0);
        updates.net_pnl_pct = (updates.net_pnl_usd / pos.pos_size_usd) * 100.0;

        await DB.updatePosition(pos.id, updates);
      }
    } catch (err) {
      logger.error('TRADE', `Trade monitor error: ${err.message}`);
    } finally {
      this.isChecking = false;
    }
  }
}

module.exports = new TradeExecutor();
