/**
 * Strategy Execution Engine for 24/7 Scanning
 * Runs Universal SMC + ATRBot Strategy per Symbol Entity
 */
const SMC = require('../smc.js');
const Stat2Box = require('../indicators/indicator_stat2_box_strategy.js');

class StrategyEngine {
  /**
   * Evaluates a strategy configuration on a series of OHLCV candles
   * Returns signal result if the latest closed candle produced a valid actionable signal
   */
  evaluate(candles, strategyConfig) {
    if (!candles || candles.length < 35) {
      return null;
    }

    const inputs = {
      strategyMode: strategyConfig.strategy_type || 'dual',
      cmoLength: strategyConfig.cmo_length || 14,
      maLength: strategyConfig.ma_length || 21,
      atrLength: strategyConfig.atr_length || 14,
      atrMult: strategyConfig.atr_mult || 2.0,
      minAtrPct: strategyConfig.min_atr_pct || 0.35,
      liqThresholdPct: strategyConfig.liq_threshold_pct || 1.5,
      fvgThresholdPct: strategyConfig.fvg_threshold_pct || 1.5,
      swingLookback: strategyConfig.swing_lookback || 30
    };

    // Calculate indicator on cached candles
    const calcResult = Stat2Box.calculate(candles, inputs);
    if (!calcResult || !calcResult.cards || calcResult.cards.length === 0) {
      return null;
    }

    // Check if a card was generated on the latest closed bar or second-to-last bar
    const lastBarIdx = candles.length - 2; // Last closed complete candle
    const latestCard = calcResult.cards.find(c => c.barIndex === lastBarIdx || c.barIndex === lastBarIdx + 1);

    if (!latestCard) {
      return null;
    }

    return {
      symbol: strategyConfig.symbol,
      strategy_id: strategyConfig.id,
      strategy_name: strategyConfig.strategy_name,
      timeframe: strategyConfig.timeframe,
      signal_type: latestCard.signalType,
      direction: latestCard.tradeDir,
      entry_price: latestCard.entryPrice,
      tp1_price: latestCard.tp1Price,
      tp2_price: latestCard.tp2Price,
      sl_price: latestCard.slPrice,
      tp1_pct: latestCard.tp1Pct,
      tp2_pct: latestCard.tp2Pct,
      sl_pct: latestCard.slPct,
      atr_pct: latestCard.atrPct,
      rr_ratio: latestCard.rrRatio,
      side_rationale: latestCard.sideRationale,
      entry_rationale: latestCard.entryRationale,
      tp1_rationale: latestCard.tp1Rationale,
      tp2_rationale: latestCard.tp2Rationale,
      sl_rationale: latestCard.slRationale,
      timestamp: latestCard.time,
      status_badge: latestCard.statusBadge
    };
  }
}

module.exports = new StrategyEngine();
