/**
 * Strategy Execution Engine for 24/7 Scanning
 * Runs Universal SMC + ATRBot Strategy per Symbol Entity
 * Generates rich quantitative feature vectors and trade forensics
 */
const SMC = require('../smc.js');
const Stat2Box = require('../indicators/indicator_stat2_box_strategy.js');

class StrategyEngine {
  getTfSeconds(tf) {
    if (!tf) return 300;
    if (tf === '1m') return 60;
    if (tf === '3m') return 180;
    if (tf === '5m') return 300;
    if (tf === '15m') return 900;
    if (tf === '30m') return 1800;
    if (tf === '1h') return 3600;
    if (tf === '4h') return 14400;
    if (tf === '1d') return 86400;
    return 300;
  }

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

    // STRICT FRESHNESS FILTER:
    // Only fire live actionable signals if the signal candle occurred within the current live bar window!
    const tfSec = this.getTfSeconds(strategyConfig.timeframe);
    const nowSec = Math.floor(Date.now() / 1000);
    const candleAgeSec = nowSec - latestCard.time;
    if (candleAgeSec > tfSec * 2.0) {
      // Stale historical card (e.g. from hours or days ago) - DO NOT execute live order!
      return null;
    }

    const sigCandle = candles[latestCard.barIndex] || candles[candles.length - 1];
    const atrItem = (calcResult.atrData && calcResult.atrData[latestCard.barIndex]) || {};

    const marketRegime = latestCard.signalType.startsWith('FADE')
      ? 'LIQUIDITY_TRAP_FADE'
      : (latestCard.tradeDir === 'BUY' ? 'BULLISH_TREND_BREAKOUT' : 'BEARISH_TREND_BREAKDOWN');

    const features = {
      symbol: strategyConfig.symbol,
      timeframe: strategyConfig.timeframe,
      bar_index: latestCard.barIndex,
      timestamp: latestCard.time,
      datetime: latestCard.datetimeStr,
      signal_type: latestCard.signalType,
      direction: latestCard.tradeDir,
      market_regime: marketRegime,
      entry_price: latestCard.entryPrice,
      sl_price: latestCard.slPrice,
      tp1_price: latestCard.tp1Price,
      tp2_price: latestCard.tp2Price,
      sl_pct: latestCard.slPct,
      tp1_pct: latestCard.tp1Pct,
      tp2_pct: latestCard.tp2Pct,
      rr_ratio: latestCard.rrRatio,
      atr_pct: latestCard.atrPct,
      atr_val: latestCard.entryPrice * (latestCard.atrPct / 100.0),
      nearest_liq_dist: latestCard.nearestDist,
      danger_level: latestCard.dangerLevel,
      candle_open: sigCandle.open,
      candle_high: sigCandle.high,
      candle_low: sigCandle.low,
      candle_close: sigCandle.close,
      candle_volume: sigCandle.volume,
      vidya_trail1: atrItem.trail1 || null,
      vidya_trail2: atrItem.trail2 || null,
      trend_state: atrItem.trend || null,
      strategy_mode: inputs.strategyMode,
      cmo_length: inputs.cmoLength,
      ma_length: inputs.maLength,
      atr_mult: inputs.atrMult
    };

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
      atr_val: features.atr_val,
      atr_pct: latestCard.atrPct,
      rr_ratio: latestCard.rrRatio,
      nearest_liq_dist_pct: latestCard.nearestDist,
      danger_level: latestCard.dangerLevel,
      market_regime: marketRegime,
      side_rationale: latestCard.sideRationale,
      entry_rationale: latestCard.entryRationale,
      tp1_rationale: latestCard.tp1Rationale,
      tp2_rationale: latestCard.tp2Rationale,
      sl_rationale: latestCard.slRationale,
      features_json: features,
      timestamp: latestCard.time,
      status_badge: latestCard.statusBadge
    };
  }
}

module.exports = new StrategyEngine();
