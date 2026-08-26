/**
 * Indicator: STAT2 Pro Box Strategy (Entry / TP1 / TP2 / SL / Status Card HUD)
 * 
 * Tích hợp toàn diện chuẩn SMC + ATRBot Dual Strategy:
 * 1. Hiển thị Box / Hộp thông tin thẻ lệnh chuyên nghiệp (HUD Trade Card) thay cho chữ Buy/Sell đơn giản:
 *    - 🏷️ Loại Lệnh: [ ▲ BUY TREND ] / [ ▼ SELL TREND ] / [ ⚡ FADE SHORT ] / [ ⚡ FADE LONG ]
 *    - 🔹 Mốc Entry: Mức giá vào lệnh chính xác (Market Open hoặc Limit Liq)
 *    - 🎯 Mốc TP1: Vùng FVG đối diện gần nhất (+% ROI)
 *    - 🏆 Mốc TP2: Vùng Liquidity Pool đối diện (+% ROI)
 *    - 🛑 Mốc SL: Đáy/Đỉnh Swing cấu trúc (-% Rủi ro) hoặc Hard SL 2.5%
 *    - 📊 Trạng Thái (Status): [ 🟢 ACTIVE ] / [ 🎯 TP1 HIT ] / [ 🏆 TP2 FULL WIN ] / [ 🛑 SL HIT ] / [ ⚡ BE HIT ]
 * 2. Kẻ các đường gióng trực quan (Guide Rays) từ Hộp tới các mốc Entry, TP1, TP2, SL trên biểu đồ.
 * 3. Tích hợp đầy đủ FVG Zones, Liquidity Lines (BSL/SSL), Ribbon Cloud và Dynamic Trailing Stop.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../smc.js'), require('./registry.js'));
  } else {
    const smc = root.SMC || root.SmartMoneyConcepts || (typeof window !== 'undefined' ? (window.SMC || window.SmartMoneyConcepts) : null);
    const reg = root.IndicatorRegistry || (typeof window !== 'undefined' ? window.IndicatorRegistry : null);
    root.Stat2BoxStrategyIndicator = factory(smc, reg);
  }
}(typeof self !== 'undefined' ? self : this, function (SMC, IndicatorRegistry) {
  'use strict';

  function hexToRgba(hex, alpha = 0.2) {
    if (!hex) return `rgba(168, 85, 247, ${alpha})`;
    if (hex.startsWith('rgba')) return hex;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  function buildLiqZones(liqList, confirmDelay = 10) {
    const zones = [];
    if (!liqList || !Array.isArray(liqList)) return zones;

    for (let i = 0; i < liqList.length; i++) {
      const item = liqList[i];
      if (!item || item.Liquidity === null || isNaN(item.Liquidity)) continue;
      if (item.Level === null || isNaN(item.Level)) continue;

      // Real-time causal visibility: swing confirmed after confirmDelay bars
      const activeStart = i + confirmDelay;

      zones.push({
        startIdx : activeStart,
        endIdx   : (item.End !== null && !isNaN(item.End)) ? item.End : 999999,
        sweptAt  : (item.Swept !== null && !isNaN(item.Swept) && item.Swept > 0) ? item.Swept : null,
        type     : item.Liquidity === 1 ? 'BSL' : 'SSL',
        level    : item.Level
      });
    }
    return zones;
  }

  function checkDangerLiq(barIdx, direction, entryPrice, zones, thresholdPct) {
    let nearestDist = Infinity;
    let dangerLevel = null;

    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (z.startIdx <= barIdx && barIdx <= z.endIdx) {
        if (z.sweptAt !== null && z.sweptAt <= barIdx) continue;

        let dist;
        if (direction === 'BUY' && z.type === 'BSL' && z.level > entryPrice) {
          dist = (z.level - entryPrice) / entryPrice * 100;
        } else if (direction === 'SELL' && z.type === 'SSL' && z.level < entryPrice) {
          dist = (entryPrice - z.level) / entryPrice * 100;
        } else {
          continue;
        }

        if (dist < nearestDist) {
          nearestDist = dist;
          dangerLevel = z.level;
        }
      }
    }

    return {
      isDangerous : nearestDist < thresholdPct,
      nearestDist : isFinite(nearestDist) ? nearestDist : null,
      dangerLevel : dangerLevel
    };
  }

  function checkCounterFvg(barIdx, direction, entryPrice, fvgList, thresholdPct) {
    // FVG at index i is only formed after bar i+1 closes, so at barIdx we inspect i <= barIdx - 1
    const maxConfirmedFvg = barIdx - 1;
    const startLook = Math.max(0, maxConfirmedFvg - 15);
    for (let i = maxConfirmedFvg; i >= startLook; i--) {
      const item = fvgList[i];
      if (!item || item.FVG === null) continue;
      if (item.MitigatedIndex !== null && item.MitigatedIndex > 0 && item.MitigatedIndex <= barIdx) continue;

      if (direction === 'BUY' && item.FVG === -1 && item.Bottom && item.Bottom > entryPrice) {
        const dist = (item.Bottom - entryPrice) / entryPrice * 100;
        if (dist < thresholdPct) return { hasCounterFvg: true, dist: dist };
      } else if (direction === 'SELL' && item.FVG === 1 && item.Top && item.Top < entryPrice) {
        const dist = (entryPrice - item.Top) / entryPrice * 100;
        if (dist < thresholdPct) return { hasCounterFvg: true, dist: dist };
      }
    }
    return { hasCounterFvg: false, dist: null };
  }

  function getSwingSL(barIdx, direction, entryPrice, swingsList, lookback = 30, confirmDelay = 10) {
    if (!swingsList || !Array.isArray(swingsList)) return null;
    const maxConfirmedSwing = barIdx - confirmDelay;
    const startLook = Math.max(0, maxConfirmedSwing - lookback);
    for (let i = maxConfirmedSwing; i >= startLook; i--) {
      const item = swingsList[i];
      if (!item || item.HighLow === null || item.Level === null) continue;
      if (direction === 'BUY' && item.HighLow === -1 && item.Level < entryPrice) {
        return item.Level * 0.9985;
      } else if (direction === 'SELL' && item.HighLow === 1 && item.Level > entryPrice) {
        return item.Level * 1.0015;
      }
    }
    return direction === 'BUY' ? entryPrice * 0.965 : entryPrice * 1.035;
  }

  function getOpposingTargets(barIdx, direction, entryPrice, fvgList, liqZones, lookback = 40) {
    let oppFvg = null;
    let minFvgDist = Infinity;
    const maxConfirmedFvg = barIdx - 1;
    const startLook = Math.max(0, maxConfirmedFvg - lookback);

    if (fvgList) {
      for (let i = maxConfirmedFvg; i >= startLook; i--) {
        const f = fvgList[i];
        if (!f || f.FVG === null) continue;
        if (f.MitigatedIndex !== null && f.MitigatedIndex > 0 && f.MitigatedIndex <= barIdx) continue;

        if (direction === 'BUY' && f.FVG === -1 && f.Bottom && f.Bottom > entryPrice) {
          const dist = (f.Bottom - entryPrice) / entryPrice * 100;
          if (dist >= 0.5 && dist < minFvgDist) {
            minFvgDist = dist;
            oppFvg = f.Bottom;
          }
        } else if (direction === 'SELL' && f.FVG === 1 && f.Top && f.Top < entryPrice) {
          const dist = (entryPrice - f.Top) / entryPrice * 100;
          if (dist >= 0.5 && dist < minFvgDist) {
            minFvgDist = dist;
            oppFvg = f.Top;
          }
        }
      }
    }

    let oppLiq = null;
    let minLiqDist = Infinity;
    if (liqZones) {
      for (let i = 0; i < liqZones.length; i++) {
        const z = liqZones[i];
        if (z.startIdx <= barIdx && barIdx <= z.endIdx) {
          if (z.sweptAt !== null && z.sweptAt <= barIdx) continue;
          if (direction === 'BUY' && z.type === 'BSL' && z.level > entryPrice) {
            const dist = (z.level - entryPrice) / entryPrice * 100;
            if (dist >= 1.0 && dist < minLiqDist) {
              minLiqDist = dist;
              oppLiq = z.level;
            }
          } else if (direction === 'SELL' && z.type === 'SSL' && z.level < entryPrice) {
            const dist = (entryPrice - z.level) / entryPrice * 100;
            if (dist >= 1.0 && dist < minLiqDist) {
              minLiqDist = dist;
              oppLiq = z.level;
            }
          }
        }
      }
    }

    const fallbackTp1 = direction === 'BUY' ? entryPrice * 1.018 : entryPrice * 0.982;
    const fallbackTp2 = direction === 'BUY' ? entryPrice * 1.032 : entryPrice * 0.968;

    return {
      tp1: oppFvg || fallbackTp1,
      tp2: oppLiq || fallbackTp2
    };
  }

  function evaluateTradeStatus(direction, entryPrice, entryBar, exitBar, slPrice, tp1Price, tp2Price, candles) {
    if (!candles || entryBar >= candles.length) return { status: 'PENDING', badge: '⏳ PENDING', pnlPct: 0.0 };

    let isTp1Hit = false;
    let isTp2Hit = false;
    let isSlHit = false;
    let curSl = slPrice;
    let maxRoe = 0.0;
    const endBar = Math.min(exitBar || candles.length - 1, candles.length - 1);

    for (let i = entryBar; i <= endBar; i++) {
      const c = candles[i];
      const h = c.high;
      const l = c.low;

      if (direction === 'BUY') {
        const curRoe = (h - entryPrice) / entryPrice * 100;
        maxRoe = Math.max(maxRoe, curRoe);

        if (l <= curSl) { isSlHit = true; break; }
        if (!isTp1Hit && h >= tp1Price) {
          isTp1Hit = true;
          curSl = entryPrice * 1.0005; // Move to Breakeven
        }
        if (isTp1Hit && h >= tp2Price) {
          isTp2Hit = true;
          break;
        }
      } else {
        const curRoe = (entryPrice - l) / entryPrice * 100;
        maxRoe = Math.max(maxRoe, curRoe);

        if (h >= curSl) { isSlHit = true; break; }
        if (!isTp1Hit && l <= tp1Price) {
          isTp1Hit = true;
          curSl = entryPrice * 0.9995; // Move to Breakeven
        }
        if (isTp1Hit && l <= tp2Price) {
          isTp2Hit = true;
          break;
        }
      }
    }

    if (isTp2Hit) return { status: 'TP2_HIT', badge: '🏆 TP2 FULL WIN', color: '#10b981', pnlPct: Math.abs((tp2Price - entryPrice) / entryPrice * 100) };
    if (isTp1Hit && isSlHit) return { status: 'BE_HIT', badge: '⚡ BE HIT (+1/2 TP1)', color: '#06b6d4', pnlPct: Math.abs((tp1Price - entryPrice) / entryPrice * 50) };
    if (isTp1Hit) return { status: 'TP1_HIT', badge: '🎯 TP1 HIT (SL BE)', color: '#38bdf8', pnlPct: Math.abs((tp1Price - entryPrice) / entryPrice * 100) };
    if (isSlHit) return { status: 'SL_HIT', badge: '🛑 SL HIT', color: '#f43f5e', pnlPct: -Math.abs((slPrice - entryPrice) / entryPrice * 100) };

    const lastC = candles[endBar];
    const livePnl = direction === 'BUY' ? (lastC.close - entryPrice) / entryPrice * 100 : (entryPrice - lastC.close) / entryPrice * 100;
    return { status: 'ACTIVE', badge: `🟢 ACTIVE (${livePnl >= 0 ? '+' : ''}${livePnl.toFixed(2)}%)`, color: livePnl >= 0 ? '#10b981' : '#f59e0b', pnlPct: livePnl };
  }

  // ══════════════════════════════════════════════════════════════════════
  // INDICATOR DEFINITION
  // ══════════════════════════════════════════════════════════════════════
  const Stat2BoxStrategyIndicator = {
    id: 'stat2_box_strategy',
    name: 'STAT2 Pro Box Strategy (Entry / TP / SL / Status Card)',
    shortName: 'STAT2 PRO BOX',
    description: 'Chiến lược SMC + ATRBot hiển thị Hộp thẻ lệnh chi tiết Entry, TP1, TP2, SL và Trạng thái lệnh thời gian thực.',

    defaultInputs: {
      strategyMode     : { type: 'select', label: 'Strategy Mode', value: 'dual', options: [
        { label: 'Dual Strategy (Trend + Fade Liq Trap)', value: 'dual' },
        { label: 'Trend Only (Filter Liq & Counter FVG)', value: 'filter' },
        { label: 'Raw ATRBot Baseline', value: 'raw' }
      ]},
      cmoLength        : { type: 'number', label: 'CMO Length (VIDYA)', value: 14, min: 2, max: 100 },
      maLength         : { type: 'number', label: 'MA Length (VIDYA)', value: 21, min: 2, max: 200 },
      atrLength        : { type: 'number', label: 'ATR Period', value: 14, min: 1, max: 100 },
      atrMult          : { type: 'number', label: 'ATR Multiplier', value: 2.0, min: 0.1, max: 10.0, step: 0.1 },
      minAtrPct        : { type: 'number', label: 'Min ATR % (Volatility Filter)', value: 0.35, min: 0.0, max: 5.0, step: 0.05 },
      liqThresholdPct  : { type: 'number', label: 'Liquidity Trap % (< X% to Liq)', value: 1.5, min: 0.1, max: 10.0, step: 0.1 },
      fvgThresholdPct  : { type: 'number', label: 'Counter FVG % (< X% to FVG)', value: 1.5, min: 0.1, max: 10.0, step: 0.1 },
      swingLookback    : { type: 'number', label: 'Swing SL Lookback Bars', value: 30, min: 5, max: 100 },
      maxCardsVisible  : { type: 'number', label: 'Max Cards Shown on Chart', value: 15, min: 1, max: 50 }
    },

    defaultStyle: {
      // 1. Box & Container Toggles
      showCards        : { type: 'checkbox', label: 'Show HUD Trade Cards', value: true },
      cardWidth        : { type: 'number', label: 'Card Width (px)', value: 210, min: 160, max: 320 },
      cardBackground   : { type: 'color', label: 'Card Background', value: '#0b1120' },
      cardOpacity      : { type: 'number', label: 'Card Opacity (0.1 - 1.0)', value: 0.94, min: 0.2, max: 1.0, step: 0.05 },
      showStem         : { type: 'checkbox', label: 'Show Stem Connection Line', value: true },

      // 2. Guide Rays & Extended Lines
      showGuideLines   : { type: 'checkbox', label: 'Show Extended Guide Rays', value: true },
      showEntryLine    : { type: 'checkbox', label: 'Show Entry Price Ray', value: true },
      showTp1Line      : { type: 'checkbox', label: 'Show TP1 Target Ray', value: true },
      showTp2Line      : { type: 'checkbox', label: 'Show TP2 Target Ray', value: true },
      showSlLine       : { type: 'checkbox', label: 'Show SL Stop Loss Ray', value: true },
      showLineBadges   : { type: 'checkbox', label: 'Show Price Badges at Line Tips', value: true },
      lineLength       : { type: 'number', label: 'Line Projection Length (px)', value: 280, min: 100, max: 600, step: 20 },
      lineThickness    : { type: 'number', label: 'Line Thickness', value: 2.0, min: 1.0, max: 4.0, step: 0.5 },

      // 3. SMC Structure Toggles
      showFVG          : { type: 'checkbox', label: 'Show FVG Zones (Fair Value Gaps)', value: true },
      fvgOpacity       : { type: 'number', label: 'FVG Box Opacity', value: 0.18, min: 0.05, max: 0.8, step: 0.05 },
      showLiquidity    : { type: 'checkbox', label: 'Show Liquidity Lines (BSL/SSL)', value: true },
      showRibbon       : { type: 'checkbox', label: 'Show ATRBot VIDYA Ribbon Cloud', value: true },
      showTrail2       : { type: 'checkbox', label: 'Show Dynamic Trailing Stop Line', value: true },

      // 4. Color Customizations
      buyColor         : { type: 'color', label: 'BUY Card Border Color', value: '#10b981' },
      sellColor        : { type: 'color', label: 'SELL Card Border Color', value: '#f43f5e' },
      fadeShortColor   : { type: 'color', label: 'FADE SHORT Card Color', value: '#f59e0b' },
      fadeLongColor    : { type: 'color', label: 'FADE LONG Card Color', value: '#06b6d4' },
      entryLineColor   : { type: 'color', label: 'Entry Line Ray Color', value: '#0284c7' },
      tp1LineColor     : { type: 'color', label: 'TP1 Line Ray Color', value: '#10b981' },
      tp2LineColor     : { type: 'color', label: 'TP2 Line Ray Color', value: '#06b6d4' },
      slLineColor      : { type: 'color', label: 'SL Line Ray Color', value: '#f43f5e' },
      fvgBullColor     : { type: 'color', label: 'Bullish FVG Box Color', value: '#10b981' },
      fvgBearColor     : { type: 'color', label: 'Bearish FVG Box Color', value: '#f43f5e' },
      liqBslColor      : { type: 'color', label: 'BSL Liquidity Ray Color', value: '#ec4899' },
      liqSslColor      : { type: 'color', label: 'SSL Liquidity Ray Color', value: '#8b5cf6' },
      bullCloudColor   : { type: 'color', label: 'Bullish Ribbon Color', value: '#10b981' },
      bearCloudColor   : { type: 'color', label: 'Bearish Ribbon Color', value: '#f43f5e' },
      stopColor        : { type: 'color', label: 'Trailing Stop Line Color', value: '#a855f7' },

      // 5. Font Size Customizations
      titleFontSize    : { type: 'number', label: 'Card Title Font Size (px)', value: 11.5, min: 8, max: 20, step: 0.5 },
      badgeFontSize    : { type: 'number', label: 'Card Status Badge Font Size (px)', value: 9.5, min: 7, max: 16, step: 0.5 },
      priceFontSize    : { type: 'number', label: 'Card Price Values Font Size (px)', value: 11, min: 8, max: 18, step: 0.5 },
      labelFontSize    : { type: 'number', label: 'Card Row Labels Font Size (px)', value: 10, min: 8, max: 16, step: 0.5 },
      lineBadgeFontSize: { type: 'number', label: 'Ray Tip Badge Font Size (px)', value: 10, min: 8, max: 16, step: 0.5 },
      fvgFontSize      : { type: 'number', label: 'FVG Text Font Size (px)', value: 10, min: 8, max: 16, step: 0.5 },
      liqFontSize      : { type: 'number', label: 'Liquidity Text Font Size (px)', value: 11, min: 8, max: 16, step: 0.5 }
    },

    // ── CALCULATION ENGINE ──
    calculate: function (candles, inputs) {
      if (!candles || candles.length < 30) return null;

      const cmoLen     = Number(inputs.cmoLength) || 14;
      const maLen      = Number(inputs.maLength) || 21;
      const atrLen     = Number(inputs.atrLength) || 14;
      const atrMult    = Number(inputs.atrMult) || 2.0;
      const minAtrPct  = Number(inputs.minAtrPct) || 0.35;
      const liqThresh  = Number(inputs.liqThresholdPct) || 1.5;
      const fvgThresh  = Number(inputs.fvgThresholdPct) || 1.5;
      const swingLb    = Number(inputs.swingLookback) || 30;
      const mode       = inputs.strategyMode || 'dual';

      // 1. SMC Calculations
      const smcEngine = SMC || (typeof window !== 'undefined' ? (window.SMC || window.SmartMoneyConcepts) : null) || (typeof globalThis !== 'undefined' ? (globalThis.SMC || globalThis.SmartMoneyConcepts) : null);
      if (!smcEngine || typeof smcEngine.swingHighsLows !== 'function') {
        console.warn('SMC engine is not ready, skipping SMC calculations.');
        return { cards: [], fvgList: [], liqList: [], atrData: [], swings: [] };
      }

      const swingLen= 20;
      const swings  = smcEngine.swingHighsLows(candles, swingLen);
      const liqList = smcEngine.liquidity(candles, swings, 0.01) || [];
      const fvgList = smcEngine.fvg(candles, false) || [];
      const liqZones= buildLiqZones(liqList, swingLen);

      // 2. ATRBot Calculation via smcEngine.atrBot
      const rawAtrData = smcEngine.atrBot(candles, {
        maType    : 'VIDYA',
        source    : 'close',
        cmoLength : cmoLen,
        maLength  : maLen,
        atrLength : atrLen,
        atrMult   : atrMult
      }) || [];

      // 3. Trade Cards & Structural Target Resolution
      const cards = [];
      const atrData = [];

      for (let i = 0; i < rawAtrData.length; i++) {
        const item = rawAtrData[i];
        const c = candles[i];
        if (!item || !c) continue;

        let signalType = null;
        let isDanger = false;
        let nearestDist = null;
        let dangerLevel = null;
        let skipReason = null;
        let cardData = null;

        if (item.isBuy || item.isSell) {
          const origDir = item.isBuy ? 'BUY' : 'SELL';
          const atrVal  = item.atr || 0;
          const atrPct  = c.close > 0 ? (atrVal / c.close * 100) : 0;
          const isLowVol= atrPct < minAtrPct;

          const liqCheck = checkDangerLiq(i, origDir, c.close, liqZones, liqThresh);
          isDanger = liqCheck.isDangerous;
          nearestDist = liqCheck.nearestDist;
          dangerLevel = liqCheck.dangerLevel;

          const fvgCheck = checkCounterFvg(i, origDir, c.close, fvgList, fvgThresh);

          let tradeDir = origDir;
          let entryPrice = (i < candles.length - 1) ? candles[i + 1].open : c.close;
          let slPrice = null;

          if (isDanger) {
            if (mode === 'dual') {
              signalType = item.isBuy ? 'FADE_SHORT' : 'FADE_LONG';
              tradeDir = item.isBuy ? 'SELL' : 'BUY';
              entryPrice = dangerLevel || entryPrice;
              slPrice = tradeDir === 'BUY' ? entryPrice * 0.975 : entryPrice * 1.025; // 2.5% Hard SL
            } else if (mode === 'filter') {
              signalType = item.isBuy ? 'SKIPPED_BUY' : 'SKIPPED_SELL';
              skipReason = 'Liq Trap';
            } else {
              signalType = item.isBuy ? 'TREND_BUY' : 'TREND_SELL';
              slPrice = getSwingSL(i, origDir, entryPrice, swings, swingLb, swingLen);
            }
          } else {
            if (isLowVol) {
              signalType = item.isBuy ? 'SKIPPED_BUY' : 'SKIPPED_SELL';
              skipReason = 'Low ATR';
            } else if (fvgCheck.hasCounterFvg) {
              signalType = item.isBuy ? 'SKIPPED_BUY' : 'SKIPPED_SELL';
              skipReason = 'Counter FVG';
            } else {
              signalType = item.isBuy ? 'TREND_BUY' : 'TREND_SELL';
              slPrice = getSwingSL(i, origDir, entryPrice, swings, swingLb, swingLen);
            }
          }

          if (signalType && !signalType.startsWith('SKIPPED')) {
            const targets = getOpposingTargets(i, tradeDir, entryPrice, fvgList, liqZones, 40);
            const entryBar = i + 1;
            const exitBar = (i + 40 < candles.length) ? i + 40 : candles.length - 1;
            const evalRes = evaluateTradeStatus(tradeDir, entryPrice, entryBar, exitBar, slPrice, targets.tp1, targets.tp2, candles);

            const slPct = Math.abs((slPrice - entryPrice) / entryPrice * 100);
            const tp1Pct = Math.abs((targets.tp1 - entryPrice) / entryPrice * 100);
            const tp2Pct = Math.abs((targets.tp2 - entryPrice) / entryPrice * 100);
            const avgTpPct = tp1Pct * 0.5 + tp2Pct * 0.5;
            const rrRatio = slPct > 0 ? (avgTpPct / slPct) : 0;

            // Rationale logic
            let sideRationale = '';
            let entryRationale = '';
            let slRationale = '';

            if (signalType === 'TREND_BUY') {
              sideRationale = `Nến [${i}] đóng cửa xác nhận xu hướng TĂNG bền vững (VIDYA Cloud Bullish). Bộ lọc định lượng xác nhận: Động cơ biến động ATR đạt ${atrPct.toFixed(2)}% (>= 0.35%), không có bẫy thanh khoản BSL trong vòng ${nearestDist ? nearestDist.toFixed(1) + '%' : '>1.5%'} và không có Bearish FVG cản đường.`;
              entryRationale = `Vào lệnh Market 100% tại giá Open của nến [${i+1}] ngay sau khi nến tín hiệu đóng cửa hoàn toàn. Đảm bảo 100% không có Look-ahead Bias.`;
              slRationale = `Cài Stop-Loss dưới Swing Low gần nhất kèm biên độ đệm 0.15% (${slPrice.toFixed(2)}), bảo vệ vị thế khỏi các cú giật râu quét thanh khoản cục bộ.`;
            } else if (signalType === 'TREND_SELL') {
              sideRationale = `Nến [${i}] đóng cửa xác nhận xu hướng GIẢM bền vững (VIDYA Cloud Bearish). Bộ lọc định lượng xác nhận: Động cơ biến động ATR đạt ${atrPct.toFixed(2)}% (>= 0.35%), không có bẫy thanh khoản SSL trong vòng ${nearestDist ? nearestDist.toFixed(1) + '%' : '>1.5%'} và không có Bullish FVG cản đường.`;
              entryRationale = `Vào lệnh Market 100% tại giá Open của nến [${i+1}] ngay sau khi nến tín hiệu đóng cửa hoàn toàn. Đảm bảo 100% không có Look-ahead Bias.`;
              slRationale = `Cài Stop-Loss trên Swing High gần nhất kèm biên độ đệm 0.15% (${slPrice.toFixed(2)}), bảo vệ vị thế khỏi các cú giật râu quét thanh khoản cục bộ.`;
            } else if (signalType === 'FADE_SHORT') {
              sideRationale = `Phát hiện BẪY THANH KHOẢN (Liquidity Trap): Tín hiệu Buy xuất hiện nhưng ngay sát phía trên (${nearestDist ? nearestDist.toFixed(2) + '%' : '<1.5%'}) là vùng thanh khoản lớn BSL ${dangerLevel ? dangerLevel.toFixed(2) : ''}. Đám đông chuẩn bị bị úp sọt xả hàng ➔ Hệ thống kích hoạt chiến lược FADE ĐẢO CHIỀU, đánh chặn lệnh SHORT tại vùng bẫy.`;
              entryRationale = `Đặt lệnh Limit Order tại chính mức giá đỉnh Liquidity (${entryPrice.toFixed(2)}) để đón đầu pha quét râu thanh khoản (Swept High) của cá mập.`;
              slRationale = `Cài Hard Stop-Loss 2.50% (${slPrice.toFixed(2)}) ngoài vùng thanh khoản để bảo vệ an toàn vốn tuyệt đối nếu thị trường có cú bứt phá tăng dốc đột biến (Runaway Breakout).`;
            } else if (signalType === 'FADE_LONG') {
              sideRationale = `Phát hiện BẪY THANH KHOẢN (Liquidity Trap): Tín hiệu Sell xuất hiện nhưng ngay sát phía dưới (${nearestDist ? nearestDist.toFixed(2) + '%' : '<1.5%'}) là vùng thanh khoản lớn SSL ${dangerLevel ? dangerLevel.toFixed(2) : ''}. Đám đông chuẩn bị bị xả cạn hàng ➔ Hệ thống kích hoạt chiến lược FADE ĐẢO CHIỀU, gom lệnh LONG Limit tại vùng bẫy.`;
              entryRationale = `Đặt lệnh Limit Order tại chính mức giá đáy Liquidity (${entryPrice.toFixed(2)}) để đón đầu pha quét râu thanh khoản (Swept Low) của cá mập.`;
              slRationale = `Cài Hard Stop-Loss 2.50% (${slPrice.toFixed(2)}) ngoài vùng thanh khoản để bảo vệ an toàn vốn tuyệt đối nếu thị trường có cú bứt phá sập dốc đột biến.`;
            }

            const tp1Rationale = `Chốt lời 50% khối lượng tại vùng FVG đối diện chưa lấp gần nhất (${targets.tp1.toFixed(2)} - +${tp1Pct.toFixed(1)}%). ĐẶC BIỆT: Khi giá chạm TP1, hệ thống TỰ ĐỘNG KÉO STOP-LOSS VỀ HÒA VỐN (Breakeven +0.05%) để triệt tiêu 100% rủi ro cho phần vị thế còn lại.`;
            const tp2Rationale = `Chốt lời 50% khối lượng còn lại tại cụm Liquidity Pool đối diện (${targets.tp2.toFixed(2)} - +${tp2Pct.toFixed(1)}%). Giúp tối đa hóa lợi nhuận khi giá hoàn tất con sóng quét thanh khoản toàn diện.`;

            cardData = {
              barIndex        : i,
              time            : item.time,
              datetimeStr     : c.datetime || new Date(item.time * 1000).toISOString().replace('T', ' ').slice(0, 19),
              signalType      : signalType,
              tradeDir        : tradeDir,
              entryPrice      : entryPrice,
              slPrice         : slPrice,
              tp1Price        : targets.tp1,
              tp2Price        : targets.tp2,
              slPct           : slPct,
              tp1Pct          : tp1Pct,
              tp2Pct          : tp2Pct,
              rrRatio         : rrRatio,
              atrPct          : atrPct,
              nearestDist     : nearestDist,
              dangerLevel     : dangerLevel,
              sideRationale   : sideRationale,
              entryRationale  : entryRationale,
              tp1Rationale    : tp1Rationale,
              tp2Rationale    : tp2Rationale,
              slRationale     : slRationale,
              status          : evalRes.status,
              statusBadge     : evalRes.badge,
              statusColor     : evalRes.color,
              pnlPct          : evalRes.pnlPct,
              trail2          : item.trail2
            };
            cards.push(cardData);
          }
        }

        atrData.push({
          time        : item.time,
          trail1      : item.trail1,
          trail2      : item.trail2,
          trend       : item.trend,
          isBuy       : item.isBuy,
          isSell      : item.isSell,
          signalType  : signalType,
          skipReason  : skipReason
        });
      }

      return {
        atrData,
        liqList,
        fvgList,
        cards
      };
    },

    // Global registry of clickable bounding boxes on canvas
    renderedBoxes: [],

    findCardAt: function (mouseX, mouseY) {
      if (!this.renderedBoxes || this.renderedBoxes.length === 0) return null;
      for (let i = this.renderedBoxes.length - 1; i >= 0; i--) {
        const b = this.renderedBoxes[i];
        if (mouseX >= b.x && mouseX <= b.x + b.w && mouseY >= b.y && mouseY <= b.y + b.h) {
          return b.card;
        }
      }
      return null;
    },

    // ── CANVAS RENDERING ──
    renderCanvas: function (ctx, result, style, helpers) {
      if (!result) return;
      this.renderedBoxes = [];
      const { getX, getY, fromTime, toTime, rightViewportX, candles, formatPrice } = helpers;
      const { atrData, liqList, fvgList, cards } = result;

      ctx.save();

      // ─────────────────────────────────────────────────────────────
      // 1. RENDER FVG ZONES
      // ─────────────────────────────────────────────────────────────
      if (style.showFVG !== false && fvgList && fvgList.length > 0) {
        const latestTime = candles.length > 0 ? candles[candles.length - 1].time : toTime;
        const fvgBullCol = style.fvgBullColor || '#10b981';
        const fvgBearCol = style.fvgBearColor || '#f43f5e';
        const fvgAlpha = style.fvgOpacity !== undefined ? Number(style.fvgOpacity) : 0.18;
        const fvgFont = Number(style.fvgFontSize) || 10;

        for (let i = 0; i < fvgList.length; i++) {
          const item = fvgList[i];
          if (!item || item.FVG === null) continue;

          const isBull = item.FVG === 1;
          const isMit  = item.MitigatedIndex !== null && item.MitigatedIndex > 0;
          const mitTime= (isMit && item.MitigatedIndex < candles.length) ? candles[item.MitigatedIndex].time : latestTime;
          if (mitTime < fromTime || candles[i].time > toTime) continue;

          const x1 = getX(candles[i].time);
          const x2 = isMit ? getX(mitTime) : rightViewportX;
          if (x1 === null && x2 === null) continue;
          const startX = x1 !== null ? x1 : -100;
          const endX   = x2 !== null ? x2 : rightViewportX;
          const boxW   = Math.max(endX - startX, 4);

          const yTop = getY(item.Top);
          const yBot = getY(item.Bottom);
          if (yTop === null || yBot === null) continue;

          const boxY = Math.min(yTop, yBot);
          const boxH = Math.max(Math.abs(yBot - yTop), 2);
          const fvgColor = isBull ? fvgBullCol : fvgBearCol;

          ctx.fillStyle = hexToRgba(fvgColor, isMit ? fvgAlpha * 0.4 : fvgAlpha);
          ctx.fillRect(startX, boxY, boxW, boxH);

          ctx.strokeStyle = fvgColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(startX, boxY, boxW, boxH);

          if (boxW > 35 && endX > 20) {
            ctx.font = `bold ${fvgFont}px "JetBrains Mono", monospace`;
            ctx.fillStyle = fvgColor;
            ctx.fillText(isBull ? 'FVG +' : 'FVG -', Math.max(startX + 4, 8), boxY + 12);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // 2. RENDER LIQUIDITY LINES (BSL / SSL)
      // ─────────────────────────────────────────────────────────────
      if (style.showLiquidity !== false && liqList && liqList.length > 0) {
        const liqBslCol = style.liqBslColor || '#ec4899';
        const liqSslCol = style.liqSslColor || '#8b5cf6';
        const liqFont = Number(style.liqFontSize) || 11;

        for (let i = 0; i < liqList.length; i++) {
          const item = liqList[i];
          if (!item || item.Liquidity === null) continue;

          const sweptTime = (item.Swept > 0 && item.Swept < candles.length) ? candles[item.Swept].time : null;
          const endTime   = sweptTime || (item.End < candles.length ? candles[item.End].time : toTime);
          if (endTime < fromTime || candles[i].time > toTime) continue;

          const x1 = getX(candles[i].time);
          const x2 = sweptTime ? getX(sweptTime) : rightViewportX;
          const y  = getY(item.Level);
          if (y === null) continue;

          const startX = x1 !== null ? x1 : -100;
          const endX   = x2 !== null ? x2 : rightViewportX;
          const isBSL  = item.Liquidity === 1;
          const baseColor = isBSL ? liqBslCol : liqSslCol;

          // Solid line for liquidity
          ctx.beginPath();
          ctx.strokeStyle = hexToRgba(baseColor, sweptTime ? 0.4 : 0.85);
          ctx.lineWidth = 1.6;
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
          ctx.stroke();

          const pText = formatPrice ? formatPrice(item.Level) : item.Level.toFixed(2);
          const label = isBSL ? `💧 BSL ${pText}` : `💧 SSL ${pText}`;
          ctx.font = `bold ${liqFont}px "JetBrains Mono", monospace`;
          const textW  = ctx.measureText(label).width;
          const badgeW = textW + 12;
          const badgeX = Math.max(endX - badgeW - 4, 8);

          ctx.fillStyle = hexToRgba(baseColor, sweptTime ? 0.4 : 0.92);
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(badgeX, y - 9, badgeW, 18, 4);
            ctx.fill();
          } else {
            ctx.fillRect(badgeX, y - 9, badgeW, 18);
          }

          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, badgeX + 6, y);
        }
      }

      // ─────────────────────────────────────────────────────────────
      // 3. RENDER ATRBOT CLOUD & TRAILING STOP
      // ─────────────────────────────────────────────────────────────
      if (atrData && atrData.length >= 2) {
        const n = atrData.length;

        // Cloud
        if (style.showRibbon !== false) {
          const bullCol = style.bullCloudColor || '#10b981';
          const bearCol = style.bearCloudColor || '#f43f5e';

          for (let i = 1; i < n; i++) {
            const p1 = atrData[i - 1];
            const p2 = atrData[i];
            if (p2.time < fromTime && i < n - 1 && atrData[i + 1].time < fromTime) continue;
            if (p1.time > toTime && i > 1 && atrData[i - 2].time > toTime) continue;

            const x1 = getX(p1.time);
            const x2 = getX(p2.time);
            const y1_t1 = getY(p1.trail1);
            const y1_t2 = getY(p1.trail2);
            const y2_t1 = getY(p2.trail1);
            const y2_t2 = getY(p2.trail2);

            if (x1 === null || x2 === null || y1_t1 === null || y1_t2 === null || y2_t1 === null || y2_t2 === null) continue;

            const isBull = p2.trail1 >= p2.trail2;
            ctx.fillStyle = isBull ? hexToRgba(bullCol, 0.14) : hexToRgba(bearCol, 0.14);
            ctx.beginPath();
            ctx.moveTo(x1, y1_t1);
            ctx.lineTo(x2, y2_t1);
            ctx.lineTo(x2, y2_t2);
            ctx.lineTo(x1, y1_t2);
            ctx.closePath();
            ctx.fill();
          }
        }

        // Trail2 Stop Line (Solid Line)
        if (style.showTrail2 !== false) {
          ctx.lineWidth   = 1.8;
          ctx.strokeStyle = style.stopColor || '#a855f7';
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < n; i++) {
            const item = atrData[i];
            if (item.time < fromTime && i < n - 1 && atrData[i + 1].time < fromTime) continue;
            if (item.time > toTime && i > 0 && atrData[i - 1].time > toTime) continue;
            const x = getX(item.time);
            const y = getY(item.trail2);
            if (x === null || y === null) continue;
            if (!started) { ctx.moveTo(x, y); started = true; }
            else          { ctx.lineTo(x, y); }
          }
          if (started) ctx.stroke();
        }
      }

      // ─────────────────────────────────────────────────────────────
      // 4. RENDER STAT2 PRO TRADE CARDS (BOXES) & SOLID LONG RAYS
      // ─────────────────────────────────────────────────────────────
      if (style.showCards !== false && cards && cards.length > 0) {
        const visibleCards = cards.filter(c => c.time >= fromTime && c.time <= toTime);
        const cardW = Math.max(Number(style.cardWidth) || 230, 180);
        const cardH = 138;
        const cardBg = style.cardBackground || '#0b1120';
        const cardAlpha = style.cardOpacity !== undefined ? Number(style.cardOpacity) : 0.94;
        const rayLen = Number(style.lineLength) || 280;
        const lineThick = Number(style.lineThickness) || 2.0;

        // Custom Font Sizes
        const titleFontSz = Number(style.titleFontSize) || 11.5;
        const badgeFontSz = Number(style.badgeFontSize) || 9.5;
        const priceFontSz = Number(style.priceFontSize) || 11;
        const labelFontSz = Number(style.labelFontSize) || 10;
        const lineBadgeFontSz = Number(style.lineBadgeFontSize) || 10;

        let prevCardX = -9999;

        for (let idx = 0; idx < visibleCards.length; idx++) {
          const card = visibleCards[idx];
          const x = getX(card.time);
          const yTrail = getY(card.trail2);
          if (x === null || yTrail === null) continue;

          const isLong = card.tradeDir === 'BUY';
          let borderCol = isLong ? (style.buyColor || '#10b981') : (style.sellColor || '#f43f5e');
          let title = isLong ? '▲ BUY TREND' : '▼ SELL TREND';

          if (card.signalType === 'FADE_SHORT') {
            borderCol = style.fadeShortColor || '#f59e0b';
            title = '⚡ FADE SHORT';
          } else if (card.signalType === 'FADE_LONG') {
            borderCol = style.fadeLongColor || '#06b6d4';
            title = '⚡ FADE LONG';
          }

          // Anti-collision smart stacking
          const cardX = x - cardW / 2;
          let offsetStagger = 0;
          if (Math.abs(cardX - prevCardX) < cardW + 10) {
            offsetStagger = 35;
          }
          prevCardX = cardX;

          const cardY = isLong ? (yTrail + 26 + offsetStagger) : (yTrail - cardH - 26 - offsetStagger);

          // 1. Connecting stem from candle to card
          if (style.showStem !== false) {
            ctx.beginPath();
            ctx.strokeStyle = hexToRgba(borderCol, 0.7);
            ctx.lineWidth = 1.6;
            ctx.moveTo(x, yTrail);
            ctx.lineTo(x, isLong ? cardY : cardY + cardH);
            ctx.stroke();
          }

          // 2. Card Container (Rounded Glassmorphic Card)
          ctx.shadowColor = hexToRgba(borderCol, 0.45);
          ctx.shadowBlur  = 12;
          ctx.fillStyle   = hexToRgba(cardBg, cardAlpha);
          ctx.strokeStyle = borderCol;
          ctx.lineWidth   = 2.0;

          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(cardX, cardY, cardW, cardH, 8);
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillRect(cardX, cardY, cardW, cardH);
            ctx.strokeRect(cardX, cardY, cardW, cardH);
          }
          ctx.shadowBlur = 0;

          // Record clickable box bounds
          this.renderedBoxes.push({ card: card, x: cardX, y: cardY, w: cardW, h: cardH });

          // 3. Card Header Bar
          ctx.fillStyle = hexToRgba(borderCol, 0.2);
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(cardX + 1, cardY + 1, cardW - 2, 28, [7, 7, 0, 0]);
            ctx.fill();
          } else {
            ctx.fillRect(cardX + 1, cardY + 1, cardW - 2, 28);
          }

          // Header Divider Line
          ctx.beginPath();
          ctx.strokeStyle = hexToRgba(borderCol, 0.4);
          ctx.lineWidth = 1.0;
          ctx.moveTo(cardX + 1, cardY + 29);
          ctx.lineTo(cardX + cardW - 1, cardY + 29);
          ctx.stroke();

          // Header Title
          ctx.font = `bold ${titleFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = borderCol;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(title, cardX + 10, cardY + 14);

          // Compact Status Pill on Header Right
          let shortBadge = card.statusBadge;
          if (shortBadge.includes('TP2')) shortBadge = '🏆 TP2 WIN';
          else if (shortBadge.includes('TP1')) shortBadge = '🎯 TP1 HIT';
          else if (shortBadge.includes('BE')) shortBadge = '⚡ BE HIT';
          else if (shortBadge.includes('SL')) shortBadge = '🛑 SL HIT';
          else if (shortBadge.includes('ACTIVE')) shortBadge = '🟢 ACTIVE';

          ctx.font = `bold ${badgeFontSz}px "JetBrains Mono", monospace`;
          const badgeTextW = ctx.measureText(shortBadge).width;
          const badgePillW = badgeTextW + 10;
          const badgePillX = cardX + cardW - badgePillW - 8;

          ctx.fillStyle = hexToRgba(card.statusColor || borderCol, 0.35);
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(badgePillX, cardY + 5, badgePillW, 18, 4);
            ctx.fill();
          } else {
            ctx.fillRect(badgePillX, cardY + 5, badgePillW, 18);
          }

          ctx.fillStyle = card.statusColor || '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(shortBadge, badgePillX + badgePillW / 2, cardY + 14);

          // 4. Formatted Price Numbers
          const pEntry = formatPrice ? formatPrice(card.entryPrice) : card.entryPrice.toFixed(2);
          const pTp1   = formatPrice ? formatPrice(card.tp1Price) : card.tp1Price.toFixed(2);
          const pTp2   = formatPrice ? formatPrice(card.tp2Price) : card.tp2Price.toFixed(2);
          const pSl    = formatPrice ? formatPrice(card.slPrice) : card.slPrice.toFixed(2);

          // 5. Clean Grid Rows (Fixed Column Coordinates, Zero Overlap)
          const col1X = cardX + 12;
          const col2X = cardX + 64;
          const col3X = cardX + cardW - 12;

          const r1Y = cardY + 45;
          const r2Y = cardY + 67;
          const r3Y = cardY + 89;
          const r4Y = cardY + 111;
          const r5Y = cardY + 127;

          ctx.textBaseline = 'middle';

          // --- Row 1: Entry ---
          ctx.textAlign = 'left';
          ctx.font = `bold ${labelFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = '#94a3b8';
          ctx.fillText('ENTRY', col1X, r1Y);

          ctx.font = `bold ${priceFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(pEntry, col2X, r1Y);

          ctx.textAlign = 'right';
          ctx.font = '9px "JetBrains Mono", monospace';
          ctx.fillStyle = '#64748b';
          ctx.fillText(card.signalType.startsWith('FADE') ? 'Limit' : 'Market', col3X, r1Y);

          // --- Row 2: TP1 (FVG Target) ---
          ctx.textAlign = 'left';
          ctx.font = `bold ${labelFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = style.tp1LineColor || '#10b981';
          ctx.fillText('TP1', col1X, r2Y);

          ctx.font = `bold ${priceFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = '#f1f5f9';
          ctx.fillText(pTp1, col2X, r2Y);

          ctx.textAlign = 'right';
          ctx.font = `bold ${labelFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = style.tp1LineColor || '#10b981';
          ctx.fillText(`+${card.tp1Pct.toFixed(1)}%`, col3X, r2Y);

          // --- Row 3: TP2 (Liq Target) ---
          ctx.textAlign = 'left';
          ctx.font = `bold ${labelFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = style.tp2LineColor || '#06b6d4';
          ctx.fillText('TP2', col1X, r3Y);

          ctx.font = `bold ${priceFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = '#f1f5f9';
          ctx.fillText(pTp2, col2X, r3Y);

          ctx.textAlign = 'right';
          ctx.font = `bold ${labelFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = style.tp2LineColor || '#06b6d4';
          ctx.fillText(`+${card.tp2Pct.toFixed(1)}%`, col3X, r3Y);

          // --- Row 4: SL (Stop Loss) ---
          ctx.textAlign = 'left';
          ctx.font = `bold ${labelFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = style.slLineColor || '#f43f5e';
          ctx.fillText('SL', col1X, r4Y);

          ctx.font = `bold ${priceFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = '#f1f5f9';
          ctx.fillText(pSl, col2X, r4Y);

          ctx.textAlign = 'right';
          ctx.font = `bold ${labelFontSz}px "JetBrains Mono", monospace`;
          ctx.fillStyle = style.slLineColor || '#f43f5e';
          ctx.fillText(`-${card.slPct.toFixed(1)}%`, col3X, r4Y);

          // --- Footer Hint ---
          ctx.textAlign = 'center';
          ctx.font = '8px "JetBrains Mono", monospace';
          ctx.fillStyle = '#475569';
          ctx.fillText('🔍 Click card for details', cardX + cardW / 2, r5Y);

          // ─────────────────────────────────────────────────────────
          // 6. RENDER SOLID EXTENDED LINES (ENTRY, TP1, TP2, SL)
          // ─────────────────────────────────────────────────────────
          if (style.showGuideLines !== false) {
            const rayStartX = x;
            const rayEndX   = Math.min(x + rayLen, ctx.canvas.width - 10);
            const showBadges = style.showLineBadges !== false;

            const drawSolidPriceLine = (yCoord, color, badgePrefix, priceStr, extraText = '') => {
              if (yCoord === null) return;

              // Solid line
              ctx.beginPath();
              ctx.strokeStyle = color;
              ctx.lineWidth   = lineThick;
              ctx.moveTo(rayStartX, yCoord);
              ctx.lineTo(rayEndX, yCoord);
              ctx.stroke();

              // Tip badge
              if (showBadges) {
                const badgeText = `${badgePrefix} ${priceStr} ${extraText}`.trim();
                ctx.font = `bold ${lineBadgeFontSz}px "JetBrains Mono", monospace`;
                const bWidth = ctx.measureText(badgeText).width + 12;
                const bHeight = 18;
                const bX = Math.max(rayEndX - bWidth, rayStartX + 20);
                const bY = yCoord - bHeight / 2;

                ctx.fillStyle = color;
                if (ctx.roundRect) {
                  ctx.beginPath();
                  ctx.roundRect(bX, bY, bWidth, bHeight, 4);
                  ctx.fill();
                } else {
                  ctx.fillRect(bX, bY, bWidth, bHeight);
                }

                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(badgeText, bX + 6, yCoord);
              }
            };

            // 1. ENTRY Solid Line
            if (style.showEntryLine !== false) {
              const yEntry = getY(card.entryPrice);
              drawSolidPriceLine(yEntry, style.entryLineColor || '#0284c7', '🔹 ENTRY', pEntry);
            }

            // 2. TP1 Solid Line
            if (style.showTp1Line !== false) {
              const yTp1 = getY(card.tp1Price);
              drawSolidPriceLine(yTp1, style.tp1LineColor || '#10b981', '🎯 TP1', pTp1, `(+${card.tp1Pct.toFixed(1)}%)`);
            }

            // 3. TP2 Solid Line
            if (style.showTp2Line !== false) {
              const yTp2 = getY(card.tp2Price);
              drawSolidPriceLine(yTp2, style.tp2LineColor || '#06b6d4', '🏆 TP2', pTp2, `(+${card.tp2Pct.toFixed(1)}%)`);
            }

            // 4. SL Solid Line
            if (style.showSlLine !== false) {
              const ySl = getY(card.slPrice);
              drawSolidPriceLine(ySl, style.slLineColor || '#f43f5e', '🛑 SL', pSl, `(-${card.slPct.toFixed(1)}%)`);
            }
          }
        }
      }

      ctx.restore();
    }
  };

  // Register in IndicatorRegistry
  if (IndicatorRegistry && typeof IndicatorRegistry.register === 'function') {
    IndicatorRegistry.register(Stat2BoxStrategyIndicator);
  }

  return Stat2BoxStrategyIndicator;
}));
