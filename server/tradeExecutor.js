/**
 * Standardized Multi-Exchange Trade Execution & Lifecycle Engine
 * 
 * Supports Binance Futures, Bybit Linear, and OKX Swap with exchange-specific
 * fee schedules, maintenance margin rates (MMR), and forensic feature logging
 */
const DB = require('./db');
const exchangeManager = require('./exchanges');
const logger = require('./logger');

class TradeExecutor {
  constructor() {
    this.isChecking = false;
  }

  /**
   * Opens a standardized position from a strategy signal with complete ML features
   */
  async openPositionFromSignal(signal) {
    const exchangeId = (signal.exchange || 'BINANCE').toUpperCase();
    const exAdapter = exchangeManager.getExchange(exchangeId);
    const takerFeeRate = exAdapter.takerFeeRate || 0.0005;
    const mmrRate = exAdapter.mmrRate || 0.005;

    const stats = await DB.getPerformanceStats(exchangeId);
    const availableBalance = stats.available_balance || 1000.0;
    const walletBalance = stats.wallet_balance || 1000.0;

    // Fetch strategy configuration
    const strat = await DB.get('SELECT * FROM symbol_strategies WHERE id = ?', [signal.strategy_id]);
    const leverage = Number(strat && strat.leverage ? strat.leverage : await DB.getSetting('default_leverage', '20')) || 20;
    const marginMode = (strat && strat.margin_mode ? strat.margin_mode : await DB.getSetting('default_margin_mode', 'ISOLATED')).toUpperCase();
    const riskPct = Number(signal.risk_pct || (strat && strat.risk_pct ? strat.risk_pct : 1.0)) / 100.0;

    // Check if duplicate ACTIVE position exists
    const existing = await DB.get(`
      SELECT id FROM trade_positions 
      WHERE symbol = ? AND strategy_id = ? AND status = 'ACTIVE' AND exchange = ?
    `, [signal.symbol, signal.strategy_id, exchangeId]);

    if (existing) {
      logger.warn('TRADE', `Active position already exists for ${signal.symbol} on ${exchangeId}. Skipping duplicate entry.`);
      return null;
    }

    // Safety Check: Validate against live WebSocket price before entering
    const livePrice = exAdapter.getLivePrice(signal.symbol);
    if (livePrice) {
      const isLong = signal.direction === 'BUY';
      const slippage = Math.abs(livePrice - signal.entry_price) / signal.entry_price;

      // 1. If live market price is already past Stop Loss, REJECT
      if ((isLong && livePrice <= signal.sl_price) || (!isLong && livePrice >= signal.sl_price)) {
        logger.warn('TRADE', `⚠️ [REJECTED] ${signal.symbol} (${exchangeId}) live price ($${livePrice}) is past Stop-Loss ($${signal.sl_price}). Entry aborted.`);
        return null;
      }

      // 2. If live market price has already hit TP1, REJECT
      if ((isLong && livePrice >= signal.tp1_price) || (!isLong && livePrice <= signal.tp1_price)) {
        logger.warn('TRADE', `⚠️ [REJECTED] ${signal.symbol} (${exchangeId}) live price ($${livePrice}) has hit TP1 ($${signal.tp1_price}). Entry aborted.`);
        return null;
      }

      // 3. If price slipped more than 0.5% from signal entry, REJECT
      if (slippage > 0.005) {
        logger.warn('TRADE', `⚠️ [REJECTED] ${signal.symbol} (${exchangeId}) live price ($${livePrice}) slipped ${(slippage * 100).toFixed(2)}% from entry.`);
        return null;
      }
    }

    // ── STANDARDIZED SIZING & MARGIN ──
    const slDistPct = Math.abs(signal.entry_price - signal.sl_price) / signal.entry_price;
    const effectiveSlPct = Math.max(slDistPct, 0.012); // Minimum 1.2% SL distance for safety
    const riskUsd = walletBalance * riskPct;

    let initialMargin = riskUsd / (effectiveSlPct * leverage);
    initialMargin = Math.min(initialMargin, availableBalance * 0.3, 250.0);
    if (initialMargin < 5.0) {
      initialMargin = Math.min(5.0, availableBalance * 0.95);
    }

    if (availableBalance < initialMargin || initialMargin <= 0) {
      logger.warn('TRADE', `⚠️ [INSUFFICIENT MARGIN] [${exchangeId}] Available: $${availableBalance.toFixed(2)}. Required: $${initialMargin.toFixed(2)}. Skipped.`);
      return null;
    }

    const notionalSizeUsd = initialMargin * leverage;
    const quantity = notionalSizeUsd / signal.entry_price;
    const entryFee = notionalSizeUsd * takerFeeRate;
    const maintenanceMargin = notionalSizeUsd * mmrRate;

    // ── ESTIMATED LIQUIDATION PRICE FORMULA ──
    const isLong = signal.direction === 'BUY';
    let liqPrice = 0;
    if (isLong) {
      liqPrice = signal.entry_price * (1 - (1 / leverage) + mmrRate);
    } else {
      liqPrice = signal.entry_price * (1 + (1 / leverage) - mmrRate);
    }

    const posId = await DB.createPosition({
      symbol: signal.symbol,
      exchange: exchangeId,
      strategy_id: signal.strategy_id,
      signal_id: signal.id,
      signal_type: signal.signal_type || '',
      direction: signal.direction,
      leverage: leverage,
      margin_mode: marginMode,
      entry_price: signal.entry_price,
      tp1_price: signal.tp1_price,
      tp2_price: signal.tp2_price,
      sl_price: signal.sl_price,
      pos_size_usd: notionalSizeUsd,
      quantity: quantity,
      initial_margin: initialMargin,
      maintenance_margin: maintenanceMargin,
      liq_price: liqPrice,
      cmo_val: signal.cmo_val || 0.0,
      atr_val: signal.atr_val || 0.0,
      atr_pct: signal.atr_pct || 0.0,
      rr_ratio: signal.rr_ratio || 0.0,
      nearest_liq_dist_pct: signal.nearest_liq_dist_pct || null,
      danger_level: signal.danger_level || null,
      market_regime: signal.market_regime || '',
      side_rationale: signal.side_rationale || '',
      entry_rationale: signal.entry_rationale || '',
      tp1_rationale: signal.tp1_rationale || '',
      tp2_rationale: signal.tp2_rationale || '',
      sl_rationale: signal.sl_rationale || '',
      features_json: signal.features_json || {},
      fee_usd: entryFee,
      entry_fee: entryFee,
      open_time: signal.timestamp || Date.now()
    });

    const sideTag = isLong ? '▲ LONG' : '▼ SHORT';
    logger.trade('EXECUTION', `🟢 [${exchangeId} ORDER] ${sideTag} ${signal.symbol} [${leverage}x ${marginMode}] | Margin: $${initialMargin.toFixed(2)} | Entry: ${signal.entry_price} | Liq: ${liqPrice.toFixed(4)} | SL: ${signal.sl_price} | TP1: ${signal.tp1_price}`);
    return posId;
  }

  /**
   * Periodic check against live prices for all active positions across exchanges
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

      const now = Date.now();

      for (const pos of activePositions) {
        const currentPrice = livePriceMap[pos.symbol] || pos.current_price;
        if (!currentPrice) continue;

        const exchangeId = (pos.exchange || 'BINANCE').toUpperCase();
        const exAdapter = exchangeManager.getExchange(exchangeId);
        const takerFeeRate = exAdapter.takerFeeRate || 0.0005;
        const makerFeeRate = exAdapter.makerFeeRate || 0.0002;

        const isLong = pos.direction === 'BUY';
        let updates = { current_price: currentPrice };
        const durationSec = Math.max(1, Math.round((now - (pos.open_time || now)) / 1000));

        // ── 1. LIQUIDATION CHECK ──
        const isLiquidated = isLong ? (currentPrice <= pos.liq_price) : (currentPrice >= pos.liq_price);
        if (isLiquidated) {
          const exitFee = pos.pos_size_usd * takerFeeRate;
          const totalFee = (pos.entry_fee || pos.fee_usd || 0) + exitFee;
          const netPnlUsd = -(pos.initial_margin || (pos.pos_size_usd / pos.leverage));

          updates.status = 'LIQ_HIT';
          updates.is_liquidated = 1;
          updates.close_time = now;
          updates.duration_seconds = durationSec;
          updates.exit_price = currentPrice;
          updates.exit_reason = 'LIQUIDATED';
          updates.gross_pnl_usd = netPnlUsd;
          updates.fee_usd = totalFee;
          updates.exit_fee = exitFee;
          updates.net_pnl_usd = netPnlUsd;
          updates.net_pnl_pct = -100.0;
          updates.roe_pct = -100.0;
          updates.margin_ratio = 100.0;

          await DB.updatePosition(pos.id, updates);
          logger.trade('LIQ_HIT', `💀 [LIQUIDATION HIT] [${exchangeId}] ${pos.symbol} liquidated at ${currentPrice}. Loss: -$${pos.initial_margin.toFixed(2)} USD (-100% ROE)`);
          continue;
        }

        // ── 2. TP1 HIT CHECK (Move SL to Breakeven + 0.05%) ──
        if (!pos.is_tp1_hit) {
          const isTp1Reached = isLong ? (currentPrice >= pos.tp1_price) : (currentPrice <= pos.tp1_price);
          if (isTp1Reached) {
            updates.is_tp1_hit = 1;
            updates.is_be_moved = 1;
            const beSl = isLong ? pos.entry_price * 1.0005 : pos.entry_price * 0.9995;
            updates.sl_price = beSl;
            logger.trade('TP_HIT', `🎯 [TP1 TRIGGERED] [${exchangeId}] ${pos.symbol} touched TP1 (${pos.tp1_price}). Trailing SL moved to BE (${beSl.toFixed(4)})!`);
          }
        }

        // ── 3. TP2 HIT CHECK (Full profit with Maker Fee) ──
        const isTp2Reached = isLong ? (currentPrice >= pos.tp2_price) : (currentPrice <= pos.tp2_price);
        if (isTp2Reached) {
          const grossPnlUsd = isLong ? (pos.quantity * (pos.tp2_price - pos.entry_price)) : (pos.quantity * (pos.entry_price - pos.tp2_price));
          const exitFee = pos.pos_size_usd * makerFeeRate;
          const totalFee = (pos.entry_fee || pos.fee_usd || 0) + exitFee;
          const netPnlUsd = grossPnlUsd - totalFee;
          const roePct = pos.initial_margin > 0 ? (netPnlUsd / pos.initial_margin) * 100.0 : 0.0;

          updates.status = 'TP2_HIT';
          updates.close_time = now;
          updates.duration_seconds = durationSec;
          updates.exit_price = pos.tp2_price;
          updates.exit_reason = 'TP2_HIT';
          updates.gross_pnl_usd = grossPnlUsd;
          updates.fee_usd = totalFee;
          updates.exit_fee = exitFee;
          updates.net_pnl_usd = netPnlUsd;
          updates.net_pnl_pct = (netPnlUsd / pos.pos_size_usd) * 100.0;
          updates.roe_pct = roePct;

          await DB.updatePosition(pos.id, updates);
          logger.trade('WIN_CLOSE', `🏆 [TP2 WIN] [${exchangeId}] ${pos.symbol} closed at TP2 (${pos.tp2_price}). Realized: +$${netPnlUsd.toFixed(2)} USD (+${roePct.toFixed(2)}% ROE)!`);
          continue;
        }

        // ── 4. STOP-LOSS HIT CHECK ──
        const isSlHit = isLong ? (currentPrice <= pos.sl_price) : (currentPrice >= pos.sl_price);
        if (isSlHit) {
          const grossPnlUsd = isLong ? (pos.quantity * (pos.sl_price - pos.entry_price)) : (pos.quantity * (pos.entry_price - pos.sl_price));
          const exitFee = pos.pos_size_usd * takerFeeRate;
          const totalFee = (pos.entry_fee || pos.fee_usd || 0) + exitFee;
          const netPnlUsd = grossPnlUsd - totalFee;
          const roePct = pos.initial_margin > 0 ? (netPnlUsd / pos.initial_margin) * 100.0 : 0.0;

          const exitStatus = pos.is_be_moved ? 'BE_HIT' : 'SL_HIT';
          updates.status = exitStatus;
          updates.close_time = now;
          updates.duration_seconds = durationSec;
          updates.exit_price = pos.sl_price;
          updates.exit_reason = exitStatus;
          updates.gross_pnl_usd = grossPnlUsd;
          updates.fee_usd = totalFee;
          updates.exit_fee = exitFee;
          updates.net_pnl_usd = netPnlUsd;
          updates.net_pnl_pct = (netPnlUsd / pos.pos_size_usd) * 100.0;
          updates.roe_pct = roePct;

          await DB.updatePosition(pos.id, updates);
          const icon = pos.is_be_moved ? '⚡' : '🛑';
          logger.trade(exitStatus, `${icon} [${exitStatus}] [${exchangeId}] ${pos.symbol} closed at SL (${pos.sl_price}). Realized: ${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)} USD (${roePct.toFixed(2)}% ROE)`);
          continue;
        }

        // ── 5. REAL-TIME UNREALIZED PNL & ROE & MARGIN RATIO ──
        const unrealizedGrossPnl = isLong ? (pos.quantity * (currentPrice - pos.entry_price)) : (pos.quantity * (pos.entry_price - currentPrice));
        const estimatedExitFee = pos.pos_size_usd * takerFeeRate;
        const totalEstimatedFee = (pos.entry_fee || pos.fee_usd || 0) + estimatedExitFee;
        const unrealizedNetPnl = unrealizedGrossPnl - totalEstimatedFee;

        const roePct = pos.initial_margin > 0 ? (unrealizedNetPnl / pos.initial_margin) * 100.0 : 0.0;
        const positionMarginBalance = pos.initial_margin + unrealizedGrossPnl;
        const marginRatio = positionMarginBalance > 0 ? (pos.maintenance_margin / positionMarginBalance) * 100.0 : 100.0;

        updates.gross_pnl_usd = unrealizedGrossPnl;
        updates.fee_usd = totalEstimatedFee;
        updates.net_pnl_usd = unrealizedNetPnl;
        updates.net_pnl_pct = (unrealizedNetPnl / pos.pos_size_usd) * 100.0;
        updates.roe_pct = roePct;
        updates.margin_ratio = marginRatio;

        await DB.updatePosition(pos.id, updates);
      }
    } catch (err) {
      logger.error('TRADE', `Multi-Exchange trade monitor error: ${err.message}`);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Manually Market Close an active position
   */
  async closePositionMarket(posId, marketPrice) {
    const pos = await DB.get('SELECT * FROM trade_positions WHERE id = ? AND status = "ACTIVE"', [posId]);
    if (!pos) throw new Error('Active position not found');

    const exchangeId = (pos.exchange || 'BINANCE').toUpperCase();
    const exAdapter = exchangeManager.getExchange(exchangeId);
    const takerFeeRate = exAdapter.takerFeeRate || 0.0005;

    const isLong = pos.direction === 'BUY';
    const closePrice = marketPrice || pos.current_price || pos.entry_price;
    const grossPnlUsd = isLong ? (pos.quantity * (closePrice - pos.entry_price)) : (pos.quantity * (pos.entry_price - closePrice));
    const exitFee = pos.pos_size_usd * takerFeeRate;
    const totalFee = (pos.entry_fee || pos.fee_usd || 0) + exitFee;
    const netPnlUsd = grossPnlUsd - totalFee;
    const roePct = pos.initial_margin > 0 ? (netPnlUsd / pos.initial_margin) * 100.0 : 0.0;
    const now = Date.now();
    const durationSec = Math.max(1, Math.round((now - (pos.open_time || now)) / 1000));

    const updates = {
      status: 'MANUAL_CLOSE',
      close_time: now,
      duration_seconds: durationSec,
      exit_price: closePrice,
      exit_reason: 'MANUAL_CLOSE',
      current_price: closePrice,
      gross_pnl_usd: grossPnlUsd,
      fee_usd: totalFee,
      exit_fee: exitFee,
      net_pnl_usd: netPnlUsd,
      net_pnl_pct: (netPnlUsd / pos.pos_size_usd) * 100.0,
      roe_pct: roePct
    };

    await DB.updatePosition(posId, updates);
    logger.trade('MANUAL_CLOSE', `🖐️ [MANUAL CLOSE] [${exchangeId}] ${pos.symbol} closed at ${closePrice}. Realized PnL: ${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)} USD (${roePct.toFixed(2)}% ROE)`);
    return updates;
  }
}

module.exports = new TradeExecutor();
