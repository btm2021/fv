/**
 * Advanced Multi-Setup Strategy Execution Engine for 24/7 Scanning
 * Runs Universal SMC (BOS/CHoCH, FVG Retest, Liquidity Sweep) + ATRBot Dual Engine
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
   * Calculates ATR
   */
  calculateATR(candles, length = 14) {
    if (!candles || candles.length < length) return 0;
    let trSum = 0;
    for (let i = candles.length - length; i < candles.length; i++) {
      const c = candles[i];
      const prev = candles[i - 1] || c;
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      );
      trSum += tr;
    }
    return trSum / length;
  }

  /**
   * Calculates CMO
   */
  calculateCMO(candles, length = 14) {
    if (!candles || candles.length <= length) return 0;
    let su = 0;
    let sd = 0;
    for (let i = candles.length - length; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff > 0) su += diff;
      else if (diff < 0) sd += Math.abs(diff);
    }
    const tot = su + sd;
    return tot > 0 ? (100 * (su - sd)) / tot : 0;
  }

  /**
   * Calculates EMA 21
   */
  calculateEMA(candles, length = 21) {
    if (!candles || candles.length === 0) return 0;
    const k = 2 / (length + 1);
    let ema = candles[0].close;
    for (let i = 1; i < candles.length; i++) {
      ema = candles[i].close * k + ema * (1 - k);
    }
    return ema;
  }

  /**
   * Evaluates strategy on live candle stream
   */
  evaluate(candles, strategyConfig) {
    if (!candles || candles.length < 35) {
      return null;
    }

    const n = candles.length;
    const cur = candles[n - 1];
    const prev = candles[n - 2];
    const nowSec = Math.floor(Date.now() / 1000);
    const tfSec = this.getTfSeconds(strategyConfig.timeframe);

    const atr = this.calculateATR(candles, 14);
    const atrPct = cur.close > 0 ? (atr / cur.close) * 100.0 : 0;
    const minAtrPct = strategyConfig.min_atr_pct || 0.30;
    if (atrPct < minAtrPct) {
      return null; // Low volatility filter
    }

    const cmo = this.calculateCMO(candles, 14);
    const ema21 = this.calculateEMA(candles, 21);

    // ── 1. CHECK STAT2 BOX INDICATOR CARDS (VIDYA TREND / FADE TRAP) ──
    const inputs = {
      strategyMode: strategyConfig.strategy_type || 'dual',
      cmoLength: strategyConfig.cmo_length || 14,
      maLength: strategyConfig.ma_length || 21,
      atrLength: strategyConfig.atr_length || 14,
      atrMult: strategyConfig.atr_mult || 2.0,
      minAtrPct: minAtrPct,
      liqThresholdPct: strategyConfig.liq_threshold_pct || 1.5,
      fvgThresholdPct: strategyConfig.fvg_threshold_pct || 1.5,
      swingLookback: strategyConfig.swing_lookback || 30
    };

    const calcResult = Stat2Box.calculate(candles, inputs);
    if (calcResult && calcResult.cards && calcResult.cards.length > 0) {
      const lastBarIdx = n - 2;
      const latestCard = (calcResult.cards || []).slice().reverse().find(c => c.barIndex >= lastBarIdx - 2);

      if (latestCard) {
        const candleAgeSec = nowSec - latestCard.time;
        if (candleAgeSec <= tfSec * 4.0) {
          const sigCandle = candles[latestCard.barIndex] || cur;
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
            cmo_val: cmo,
            ema_21: ema21
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
    }

    // ── 2. CHECK PURE SMC FVG RETEST & LIQUIDITY SWEEPS ──
    const swings = SMC.swingHighsLows(candles, 20);
    const fvgs = SMC.fvg(candles, false) || [];
    const liqs = SMC.liquidity(candles, swings, 0.01) || [];

    // A. Check Liquidity Sweeps (Recent 2 bars)
    for (const l of liqs) {
      if (l.Swept && l.Swept >= n - 2) {
        const isBullishSweep = l.Liquidity === -1; // Swept SSL Low -> Bullish Reversal
        const isBearishSweep = l.Liquidity === 1;  // Swept BSL High -> Bearish Reversal

        if (isBullishSweep && (cmo <= -20 || cur.close > prev.low)) {
          const entry = cur.close;
          const sl = l.Level - (0.5 * atr);
          const tp1 = entry + (1.5 * (entry - sl));
          const tp2 = entry + (3.0 * (entry - sl));
          const slPct = Math.abs((entry - sl) / entry * 100);

          return {
            symbol: strategyConfig.symbol,
            strategy_id: strategyConfig.id,
            strategy_name: strategyConfig.strategy_name,
            timeframe: strategyConfig.timeframe,
            signal_type: 'FADE_LONG',
            direction: 'BUY',
            entry_price: entry,
            tp1_price: tp1,
            tp2_price: tp2,
            sl_price: sl,
            tp1_pct: ((tp1 - entry) / entry) * 100,
            tp2_pct: ((tp2 - entry) / entry) * 100,
            sl_pct: slPct,
            atr_val: atr,
            atr_pct: atrPct,
            rr_ratio: 2.25,
            market_regime: 'LIQUIDITY_TRAP_FADE',
            side_rationale: `Phát hiện QUÉT THANH KHOẢN (SSL Swept $${l.Level.toFixed(4)}): Cá mập đã quét râu săn Stop Loss và rút chân mạnh mẽ.`,
            entry_rationale: `Vào lệnh LONG đảo chiều tại giá đóng cửa $${entry.toFixed(4)}.`,
            tp1_rationale: `Chốt 50% tại 1.5R ($${tp1.toFixed(4)}) & Tự động kéo SL về Breakeven.`,
            tp2_rationale: `Chốt 50% còn lại tại 3.0R ($${tp2.toFixed(4)}).`,
            sl_rationale: `Cắt lỗ an toàn dưới đáy râu nến quét ($${sl.toFixed(4)}).`,
            features_json: { symbol: strategyConfig.symbol, cmo, ema21, atrPct },
            timestamp: cur.time,
            status_badge: '🟢 ACTIVE'
          };
        } else if (isBearishSweep && (cmo >= 20 || cur.close < prev.high)) {
          const entry = cur.close;
          const sl = l.Level + (0.5 * atr);
          const tp1 = entry - (1.5 * (sl - entry));
          const tp2 = entry - (3.0 * (sl - entry));
          const slPct = Math.abs((sl - entry) / entry * 100);

          return {
            symbol: strategyConfig.symbol,
            strategy_id: strategyConfig.id,
            strategy_name: strategyConfig.strategy_name,
            timeframe: strategyConfig.timeframe,
            signal_type: 'FADE_SHORT',
            direction: 'SELL',
            entry_price: entry,
            tp1_price: tp1,
            tp2_price: tp2,
            sl_price: sl,
            tp1_pct: ((entry - tp1) / entry) * 100,
            tp2_pct: ((entry - tp2) / entry) * 100,
            sl_pct: slPct,
            atr_val: atr,
            atr_pct: atrPct,
            rr_ratio: 2.25,
            market_regime: 'LIQUIDITY_TRAP_FADE',
            side_rationale: `Phát hiện QUÉT THANH KHOẢN (BSL Swept $${l.Level.toFixed(4)}): Cá mập đã đâm thủng đỉnh dụ mua rồi xả hàng.`,
            entry_rationale: `Vào lệnh SHORT đánh chặn tại giá đóng cửa $${entry.toFixed(4)}.`,
            tp1_rationale: `Chốt 50% tại 1.5R ($${tp1.toFixed(4)}) & Tự động dời SL về hòa vốn.`,
            tp2_rationale: `Chốt 50% còn lại tại 3.0R ($${tp2.toFixed(4)}).`,
            sl_rationale: `Cắt lỗ trên đỉnh râu quét ($${sl.toFixed(4)}).`,
            features_json: { symbol: strategyConfig.symbol, cmo, ema21, atrPct },
            timestamp: cur.time,
            status_badge: '🟢 ACTIVE'
          };
        }
      }
    }

    // B. Check FVG Retest in Trend Direction
    const activeFvgs = fvgs.filter(f => f.MitigatedIndex === null || f.MitigatedIndex >= n - 2);
    for (const f of activeFvgs) {
      // Bullish FVG Retest (Uptrend)
      if (f.FVG === 1 && cur.close > ema21 && cur.low <= f.Top && cur.close >= f.Bottom && cmo >= 10) {
        const entry = cur.close;
        const sl = f.Bottom - (0.5 * atr);
        const tp1 = entry + (1.5 * (entry - sl));
        const tp2 = entry + (3.0 * (entry - sl));
        const slPct = Math.abs((entry - sl) / entry * 100);

        return {
          symbol: strategyConfig.symbol,
          strategy_id: strategyConfig.id,
          strategy_name: strategyConfig.strategy_name,
          timeframe: strategyConfig.timeframe,
          signal_type: 'TREND_BUY',
          direction: 'BUY',
          entry_price: entry,
          tp1_price: tp1,
          tp2_price: tp2,
          sl_price: sl,
          tp1_pct: ((tp1 - entry) / entry) * 100,
          tp2_pct: ((tp2 - entry) / entry) * 100,
          sl_pct: slPct,
          atr_val: atr,
          atr_pct: atrPct,
          rr_ratio: 2.25,
          market_regime: 'BULLISH_TREND_BREAKOUT',
          side_rationale: `Hồi quy vùng mất cân bằng Fair Value Gap (+FVG $${f.Bottom.toFixed(4)} - $${f.Top.toFixed(4)}) thuận xu hướng EMA 21.`,
          entry_rationale: `Vào lệnh LONG tại vùng phản ứng 50% FVG ($${entry.toFixed(4)}).`,
          tp1_rationale: `Chốt 50% tại 1.5R ($${tp1.toFixed(4)}) & Kéo SL về Breakeven.`,
          tp2_rationale: `Chốt 50% còn lại tại 3.0R ($${tp2.toFixed(4)}).`,
          sl_rationale: `Cắt lỗ dưới chân FVG ($${sl.toFixed(4)}).`,
          features_json: { symbol: strategyConfig.symbol, cmo, ema21, atrPct },
          timestamp: cur.time,
          status_badge: '🟢 ACTIVE'
        };
      }
      // Bearish FVG Retest (Downtrend)
      else if (f.FVG === -1 && cur.close < ema21 && cur.high >= f.Bottom && cur.close <= f.Top && cmo <= -10) {
        const entry = cur.close;
        const sl = f.Top + (0.5 * atr);
        const tp1 = entry - (1.5 * (sl - entry));
        const tp2 = entry - (3.0 * (sl - entry));
        const slPct = Math.abs((sl - entry) / entry * 100);

        return {
          symbol: strategyConfig.symbol,
          strategy_id: strategyConfig.id,
          strategy_name: strategyConfig.strategy_name,
          timeframe: strategyConfig.timeframe,
          signal_type: 'TREND_SELL',
          direction: 'SELL',
          entry_price: entry,
          tp1_price: tp1,
          tp2_price: tp2,
          sl_price: sl,
          tp1_pct: ((entry - tp1) / entry) * 100,
          tp2_pct: ((entry - tp2) / entry) * 100,
          sl_pct: slPct,
          atr_val: atr,
          atr_pct: atrPct,
          rr_ratio: 2.25,
          market_regime: 'BEARISH_TREND_BREAKDOWN',
          side_rationale: `Hồi quy vùng mất cân bằng Bearish FVG ($${f.Bottom.toFixed(4)} - $${f.Top.toFixed(4)}) thuận xu hướng giảm.`,
          entry_rationale: `Vào lệnh SHORT tại vùng phản ứng FVG ($${entry.toFixed(4)}).`,
          tp1_rationale: `Chốt 50% tại 1.5R ($${tp1.toFixed(4)}) & Kéo SL về Breakeven.`,
          tp2_rationale: `Chốt 50% còn lại tại 3.0R ($${tp2.toFixed(4)}).`,
          sl_rationale: `Cắt lỗ trên đỉnh FVG ($${sl.toFixed(4)}).`,
          features_json: { symbol: strategyConfig.symbol, cmo, ema21, atrPct },
          timestamp: cur.time,
          status_badge: '🟢 ACTIVE'
        };
      }
    }

    return null;
  }
}

module.exports = new StrategyEngine();
