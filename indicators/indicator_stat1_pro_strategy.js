/**
 * Indicator: STAT1 Pro Strategy (ATRBot + Liquidity + FVG Suite)
 * 
 * Tích hợp toàn diện:
 * 1. ATRBot VIDYA & Dynamic Trailing Stop
 * 2. SMC Liquidity Lines (BSL/SSL) với phát hiện bẫy thanh khoản (<1.5%)
 * 3. SMC Fair Value Gaps (FVG Zones) với theo dõi mitigation
 * 4. BỘ QUY TẮC NÂNG CAO (Actionable Enhanced Rules):
 *    - Lọc Volatility (ATR >= 0.35%)
 *    - Lọc FVG đối kháng cản đường
 *    - Vẽ mức Stop-Loss cấu trúc Swing High/Low
 *    - Tín hiệu kép:
 *      * Thuận Trend: ▲ BUY / ▼ SELL
 *      * Đảo chiều bẫy Liq: ⚡ FADE SHORT / ⚡ FADE LONG (Limit tại Liq Level)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../smc.js'), require('./registry.js'));
  } else {
    factory(root.SMC, root.IndicatorRegistry);
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

  function buildLiqZones(liqList) {
    const zones = [];
    if (!liqList || !Array.isArray(liqList)) return zones;

    for (let i = 0; i < liqList.length; i++) {
      const item = liqList[i];
      if (!item || item.Liquidity === null || isNaN(item.Liquidity)) continue;
      if (item.Level === null || isNaN(item.Level)) continue;

      zones.push({
        startIdx : i,
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
    const startLook = Math.max(0, barIdx - 15);
    for (let i = barIdx; i >= startLook; i--) {
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

  function getSwingSL(barIdx, direction, entryPrice, swings) {
    const startLook = Math.max(0, barIdx - 30);
    for (let i = barIdx; i >= startLook; i--) {
      const item = swings[i];
      if (!item || item.HighLow === null || !item.Level) continue;
      if (direction === 'BUY' && item.HighLow === -1 && item.Level < entryPrice) {
        return item.Level * (1 - 0.0015);
      } else if (direction === 'SELL' && item.HighLow === 1 && item.Level > entryPrice) {
        return item.Level * (1 + 0.0015);
      }
    }
    return null;
  }

  const Stat1ProStrategy = {
    id        : 'stat1_pro_strategy',
    name      : 'STAT1 Pro Strategy (ATRBot + Liq + FVG)',
    shortName : 'STAT1 Pro',
    category  : 'Strategy Signals',
    tag       : 'ATRBot · Liq Traps · FVG Zones · Enhanced Rules',
    desc      : 'Chiến lược toàn diện: Tín hiệu ATRBot kết hợp bộ lọc Liquidity Zone (<1.5%), lọc Volatility (ATR>=0.35%), lọc FVG cản đường, và tính toán Stop-Loss theo cấu trúc Swing High/Low.',
    color     : '#38bdf8',

    // ── INPUTS TAB ──
    defaultInputs: {
      strategyMode : {
        type: 'select',
        label: 'Chế Độ Chiến Lược',
        value: 'dual',
        options: [
          { value: 'dual',    label: '⚡ Dual Strategy (Thuận Xu Hướng + Đánh Fade Bẫy Liq)' },
          { value: 'filter',  label: '🛡️ Filter Only (Chỉ vào lệnh thuận, bỏ qua bẫy Liq)' },
          { value: 'raw',     label: '📊 Raw Signals (Hiển thị mọi tín hiệu ATRBot)' }
        ]
      },
      // Filters
      liqFilterPct   : { type: 'number', label: 'Ngưỡng Bẫy Liquidity (%)',     value: 1.5, min: 0.1, max: 10.0, step: 0.1 },
      enableAtrFilt  : { type: 'checkbox', label: 'Bật Lọc Volatility (ATR%)',  value: true },
      minAtrPct      : { type: 'number', label: 'Mức ATR% Tối Thiểu',          value: 0.35, min: 0.05, max: 2.0, step: 0.05 },
      enableFvgFilt  : { type: 'checkbox', label: 'Bật Lọc FVG Ngược Chiều',   value: true },
      fvgFilterPct   : { type: 'number', label: 'Khoảng Cách FVG Cản (%)',     value: 1.5, min: 0.1, max: 10.0, step: 0.1 },
      // ATRBot
      cmoLength      : { type: 'number', label: 'ATRBot CMO Length',            value: 14,  min: 1,   max: 200,  step: 1   },
      maLength       : { type: 'number', label: 'ATRBot MA Period',             value: 21,  min: 1,   max: 500,  step: 1   },
      atrLength      : { type: 'number', label: 'ATRBot ATR Length',            value: 14,  min: 1,   max: 200,  step: 1   },
      atrMult        : { type: 'number', label: 'ATRBot ATR Multiplier',        value: 2.0, min: 0.1, max: 20.0, step: 0.1 },
      // SMC
      swingLength    : { type: 'number', label: 'SMC Swing Length',             value: 20,  min: 2,   max: 200,  step: 1   },
      rangePercent   : { type: 'number', label: 'Liquidity Range (%)',          value: 1.0, min: 0.1, max: 10.0, step: 0.1 },
      unmitOnly      : { type: 'checkbox', label: 'Chỉ hiện FVG chưa Mitigate', value: false }
    },

    // ── STYLE TAB ──
    defaultStyle: {
      // Signals
      showSignals     : { type: 'checkbox', label: 'Hiển thị Tín Hiệu Vào Lệnh',     value: true },
      buyColor        : { type: 'color',    label: 'Màu Lệnh BUY Thuận',             value: '#10b981' },
      sellColor       : { type: 'color',    label: 'Màu Lệnh SELL Thuận',            value: '#f43f5e' },
      fadeShortColor  : { type: 'color',    label: 'Màu Lệnh FADE SHORT (Bẫy BSL)',    value: '#f59e0b' },
      fadeLongColor   : { type: 'color',    label: 'Màu Lệnh FADE LONG (Bẫy SSL)',     value: '#06b6d4' },
      filteredColor   : { type: 'color',    label: 'Màu Lệnh Bị Bỏ Qua (Skip)',      value: '#6b7280' },
      showSwingSl     : { type: 'checkbox', label: 'Hiển thị Đường Stop-Loss Swing', value: true },
      // ATRBot Lines
      showRibbon      : { type: 'checkbox', label: 'Hiển thị Mây Ribbon ATRBot',     value: true },
      bullCloudColor  : { type: 'color',    label: 'Màu Mây Tăng',                   value: '#10b981' },
      bearCloudColor  : { type: 'color',    label: 'Màu Mây Giảm',                   value: '#f43f5e' },
      showTrail2      : { type: 'checkbox', label: 'Hiển thị Đường Trailing Stop',   value: true },
      stopColor       : { type: 'color',    label: 'Màu Đường Stop Trail',           value: '#a855f7' },
      // Liquidity Lines
      showLiquidity   : { type: 'checkbox', label: 'Hiển thị Đường Liquidity',       value: true },
      bslColor        : { type: 'color',    label: 'Màu Buy-Side Liq (BSL)',         value: '#ec4899' },
      sslColor        : { type: 'color',    label: 'Màu Sell-Side Liq (SSL)',        value: '#8b5cf6' },
      showDangerLine  : { type: 'checkbox', label: 'Vẽ Đường Cảnh Báo Bẫy Liq',     value: true },
      // FVG Zones
      showFVG         : { type: 'checkbox', label: 'Hiển thị Vùng FVG',              value: true },
      bullFVGColor    : { type: 'color',    label: 'Màu Bullish FVG (+)',            value: '#10b981' },
      bearFVGColor    : { type: 'color',    label: 'Màu Bearish FVG (-)',            value: '#f43f5e' }
    },

    // ── CALCULATION ──
    calculate: function (candles, inputs) {
      const smcEngine = SMC || (typeof window !== 'undefined' ? (window.SMC || window.SmartMoneyConcepts) : null) || (typeof globalThis !== 'undefined' ? (globalThis.SMC || globalThis.SmartMoneyConcepts) : null);
      if (!smcEngine || typeof smcEngine.atrBot !== 'function' || typeof smcEngine.swingHighsLows !== 'function' || typeof smcEngine.liquidity !== 'function') {
        return { atrData: [], liqList: [], fvgList: [] };
      }

      const n = candles.length;
      if (n < 30) return { atrData: [], liqList: [], fvgList: [] };

      const mode          = inputs.strategyMode || 'dual';
      const thresholdPct  = parseFloat(inputs.liqFilterPct) || 1.5;
      const enableAtrFilt = inputs.enableAtrFilt !== false && inputs.enableAtrFilt !== 'false';
      const minAtrPct     = parseFloat(inputs.minAtrPct) || 0.35;
      const enableFvgFilt = inputs.enableFvgFilt !== false && inputs.enableFvgFilt !== 'false';
      const fvgFilterPct  = parseFloat(inputs.fvgFilterPct) || 1.5;
      const rangePct      = (parseFloat(inputs.rangePercent) || 1.0) / 100.0;
      const unmitOnly     = inputs.unmitOnly === true || inputs.unmitOnly === 'true';

      // 1. Calculate ATRBot
      const rawAtrData = smcEngine.atrBot(candles, {
        maType    : 'VIDYA',
        source    : 'close',
        cmoLength : inputs.cmoLength || 14,
        maLength  : inputs.maLength  || 21,
        atrLength : inputs.atrLength || 14,
        atrMult   : inputs.atrMult   || 2.0
      }) || [];

      // 2. Calculate SMC Swings, Liquidity, FVG
      const swings  = smcEngine.swingHighsLows(candles, parseInt(inputs.swingLength, 10) || 20);
      const liqList = smcEngine.liquidity(candles, swings, rangePct) || [];
      const fvgList = smcEngine.fvg(candles, unmitOnly) || [];

      const liqZones = buildLiqZones(liqList);

      // 3. Process Signals with Enhanced Rules
      const atrData = [];
      for (let i = 0; i < rawAtrData.length; i++) {
        const item = rawAtrData[i];
        const c    = candles[i];
        if (!item || !c) continue;

        let signalType = null;
        let isDanger   = false;
        let nearestDist= null;
        let dangerLevel= null;
        let swingSl    = null;
        let skipReason = null;

        if (item.isBuy || item.isSell) {
          const origDir = item.isBuy ? 'BUY' : 'SELL';
          const atrVal  = item.atr || (c.high - c.low);
          const atrPct  = (atrVal / c.close * 100.0);

          // Check Liq Trap
          const check   = checkDangerLiq(i, origDir, c.close, liqZones, thresholdPct);
          isDanger      = check.isDangerous;
          nearestDist   = check.nearestDist;
          dangerLevel   = check.dangerLevel;

          // Check Volatility Filter
          const isLowVol = enableAtrFilt && (atrPct < minAtrPct);

          // Check Counter FVG Filter
          const fvgCheck = enableFvgFilt ? checkCounterFvg(i, origDir, c.close, fvgList, fvgFilterPct) : { hasCounterFvg: false };

          // Calculate Swing SL
          swingSl = getSwingSL(i, origDir, c.close, swings);

          if (isDanger) {
            // Liq Trap branch
            if (mode === 'dual') {
              signalType = item.isBuy ? 'FADE_SHORT' : 'FADE_LONG';
            } else if (mode === 'filter') {
              signalType = item.isBuy ? 'SKIPPED_BUY' : 'SKIPPED_SELL';
              skipReason = 'Liq Trap';
            } else {
              signalType = item.isBuy ? 'TREND_BUY' : 'TREND_SELL';
            }
          } else {
            // Normal Trend branch
            if (isLowVol) {
              signalType = item.isBuy ? 'SKIPPED_BUY' : 'SKIPPED_SELL';
              skipReason = 'Low ATR';
            } else if (fvgCheck.hasCounterFvg) {
              signalType = item.isBuy ? 'SKIPPED_BUY' : 'SKIPPED_SELL';
              skipReason = 'Counter FVG';
            } else {
              signalType = item.isBuy ? 'TREND_BUY' : 'TREND_SELL';
            }
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
          isDanger    : isDanger,
          nearestDist : nearestDist,
          dangerLevel : dangerLevel,
          swingSl     : swingSl,
          skipReason  : skipReason
        });
      }

      return {
        atrData,
        liqList,
        fvgList
      };
    },

    // ── RENDER CANVAS ──
    renderCanvas: function (ctx, result, style, helpers) {
      if (!result) return;
      const { getX, getY, fromTime, toTime, rightViewportX, candles } = helpers;
      const { atrData, liqList, fvgList } = result;

      ctx.save();

      // ─────────────────────────────────────────────────────────────
      // 1. RENDER FVG ZONES
      // ─────────────────────────────────────────────────────────────
      if (style.showFVG !== false && fvgList && fvgList.length > 0) {
        const latestTime = candles.length > 0 ? candles[candles.length - 1].time : toTime;
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

          const fvgColor = isBull ? (style.bullFVGColor || '#10b981') : (style.bearFVGColor || '#f43f5e');
          ctx.fillStyle = hexToRgba(fvgColor, isMit ? 0.08 : 0.20);
          ctx.fillRect(startX, boxY, boxW, boxH);

          ctx.strokeStyle = fvgColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(startX, boxY, boxW, boxH);

          if (boxW > 35 && endX > 20) {
            ctx.font = 'bold 9px "JetBrains Mono", monospace';
            ctx.fillStyle = fvgColor;
            const textX = Math.max(startX + 4, 8);
            ctx.fillText(isBull ? 'FVG +' : 'FVG -', textX, boxY + 11);
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // 2. RENDER LIQUIDITY LINES (BSL & SSL)
      // ─────────────────────────────────────────────────────────────
      if (style.showLiquidity !== false && liqList && liqList.length > 0) {
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

          const isBSL     = item.Liquidity === 1;
          const baseColor = isBSL ? (style.bslColor || '#ec4899') : (style.sslColor || '#8b5cf6');

          ctx.beginPath();
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 1.4;
          ctx.setLineDash([5, 4]);
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
          ctx.stroke();
          ctx.setLineDash([]);

          const formattedLvl = helpers.formatPrice ? helpers.formatPrice(item.Level) : item.Level.toFixed(2);
          const label = isBSL ? `💧 BSL ${formattedLvl}` : `💧 SSL ${formattedLvl}`;
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          const textW  = ctx.measureText(label).width;
          const badgeW = textW + 10;
          const badgeH = 16;
          const badgeX = Math.max(endX - badgeW - 4, 8);
          const badgeY = y - badgeH / 2;

          ctx.fillStyle = hexToRgba(baseColor, sweptTime ? 0.4 : 0.9);
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
            ctx.fill();
          } else {
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
          }

          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, badgeX + 5, y);
        }
      }

      // ─────────────────────────────────────────────────────────────
      // 3. RENDER ATRBOT RIBBON CLOUD & TRAIL LINE
      // ─────────────────────────────────────────────────────────────
      if (atrData && atrData.length >= 2) {
        const n = atrData.length;

        // Cloud
        if (style.showRibbon !== false) {
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
            ctx.fillStyle = isBull ? (style.bullCloudColor ? hexToRgba(style.bullCloudColor, 0.14) : 'rgba(16, 185, 129, 0.14)')
                                   : (style.bearCloudColor ? hexToRgba(style.bearCloudColor, 0.14) : 'rgba(244, 63, 94, 0.14)');
            ctx.beginPath();
            ctx.moveTo(x1, y1_t1);
            ctx.lineTo(x2, y2_t1);
            ctx.lineTo(x2, y2_t2);
            ctx.lineTo(x1, y1_t2);
            ctx.closePath();
            ctx.fill();
          }
        }

        // Trail2 Stop Line
        if (style.showTrail2 !== false) {
          ctx.lineWidth   = 1.6;
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
      // 4. RENDER DANGER LIQ & SWING SL LINES
      // ─────────────────────────────────────────────────────────────
      if (atrData) {
        for (let i = 0; i < atrData.length; i++) {
          const item = atrData[i];
          if (item.time < fromTime || item.time > toTime) continue;
          const x = getX(item.time);
          if (x === null) continue;

          // Danger Liq
          if (style.showDangerLine !== false && item.isDanger && item.dangerLevel) {
            const y = getY(item.dangerLevel);
            if (y !== null) {
              ctx.strokeStyle = '#f59e0b';
              ctx.lineWidth   = 1.2;
              ctx.setLineDash([3, 3]);
              const xEnd = Math.min(x + 70, ctx.canvas.width);
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(xEnd, y);
              ctx.stroke();
              ctx.setLineDash([]);

              ctx.font = 'bold 9px "JetBrains Mono", monospace';
              ctx.fillStyle = '#f59e0b';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'bottom';
              ctx.fillText(`⚠ TRAP (${item.nearestDist ? item.nearestDist.toFixed(1) : ''}%)`, xEnd + 2, y - 1);
            }
          }

          // Swing SL Line
          if (style.showSwingSl !== false && item.swingSl && (item.signalType === 'TREND_BUY' || item.signalType === 'TREND_SELL')) {
            const ySl = getY(item.swingSl);
            if (ySl !== null) {
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth   = 1.0;
              ctx.setLineDash([2, 2]);
              const xEnd = Math.min(x + 50, ctx.canvas.width);
              ctx.beginPath();
              ctx.moveTo(x, ySl);
              ctx.lineTo(xEnd, ySl);
              ctx.stroke();
              ctx.setLineDash([]);

              ctx.font = '8px "JetBrains Mono", monospace';
              ctx.fillStyle = '#ef4444';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.fillText('SL', xEnd + 2, ySl);
            }
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // 5. RENDER BUY / SELL / FADE BADGES
      // ─────────────────────────────────────────────────────────────
      if (style.showSignals !== false && atrData) {
        const buyCol   = style.buyColor       || '#10b981';
        const sellCol  = style.sellColor      || '#f43f5e';
        const fadeSCol = style.fadeShortColor || '#f59e0b';
        const fadeLCol = style.fadeLongColor  || '#06b6d4';
        const skipCol  = style.filteredColor  || '#6b7280';

        for (let i = 0; i < atrData.length; i++) {
          const item = atrData[i];
          if (!item.signalType) continue;
          if (item.time < fromTime || item.time > toTime) continue;

          const x = getX(item.time);
          const y = getY(item.trail2);
          if (x === null || y === null) continue;

          let label, color, isTop, isDashed = false;

          switch (item.signalType) {
            case 'TREND_BUY':
              label = '▲ BUY';
              color = buyCol;
              isTop = false;
              break;
            case 'TREND_SELL':
              label = '▼ SELL';
              color = sellCol;
              isTop = true;
              break;
            case 'FADE_SHORT':
              label = '⚡ FADE SHORT';
              color = fadeSCol;
              isTop = true;
              break;
            case 'FADE_LONG':
              label = '⚡ FADE LONG';
              color = fadeLCol;
              isTop = false;
              break;
            case 'SKIPPED_BUY':
              label = item.skipReason ? `✗ BUY (${item.skipReason})` : '✗ BUY';
              color = skipCol;
              isTop = false;
              isDashed = true;
              break;
            case 'SKIPPED_SELL':
              label = item.skipReason ? `✗ SELL (${item.skipReason})` : '✗ SELL';
              color = skipCol;
              isTop = true;
              isDashed = true;
              break;
            default:
              continue;
          }

          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          const textW  = ctx.measureText(label).width;
          const badgeW = textW + 12;
          const badgeH = 17;
          const offset = 18;
          const pillY  = isTop ? y - offset : y + offset;

          ctx.fillStyle = isDashed ? hexToRgba(color, 0.45) : hexToRgba(color, 0.95);
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(x - badgeW / 2, pillY - badgeH / 2, badgeW, badgeH, 4);
            ctx.fill();
          } else {
            ctx.fillRect(x - badgeW / 2, pillY - badgeH / 2, badgeW, badgeH);
          }

          if (isDashed) {
            ctx.strokeStyle = hexToRgba(color, 0.8);
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            if (ctx.roundRect) {
              ctx.beginPath();
              ctx.roundRect(x - badgeW / 2, pillY - badgeH / 2, badgeW, badgeH, 4);
              ctx.stroke();
            } else {
              ctx.strokeRect(x - badgeW / 2, pillY - badgeH / 2, badgeW, badgeH);
            }
            ctx.setLineDash([]);
          }

          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, x, pillY);
        }
      }

      ctx.restore();
    }
  };

  if (IndicatorRegistry) {
    IndicatorRegistry.register(Stat1ProStrategy);
  }

  return Stat1ProStrategy;
}));
