/**
 * Indicator: Smart Money Concepts (SMC Suite)
 * High Precision, Zero Jitter Rendering
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../smc.js'), require('./registry.js'));
  } else {
    factory(root.SMC, root.IndicatorRegistry);
  }
}(typeof self !== 'undefined' ? self : this, function (SMC, IndicatorRegistry) {
  'use strict';

  const SMCIndicator = {
    id: 'smc',
    name: 'Smart Money Concepts (SMC Suite)',
    shortName: 'Smart Money Concepts',
    category: 'Market Structure',
    tag: 'FVG · OB · BOS · Liq · Swings',
    desc: 'Institutional market structure analysis: Fair Value Gaps (FVG), Order Blocks (OB), Break of Structure (BOS/CHoCH), Swing Highs/Lows, and Liquidity Sweeps.',
    color: '#38bdf8',

    defaultInputs: {
      swingLength: { type: 'number', label: 'Swing High/Low Length', value: 20, min: 2, max: 200, step: 1 },
      closeBreak: { type: 'select', label: 'BOS/CHoCH Break Trigger', value: 'true', options: [{ value: 'true', label: 'Full Candle Close' }, { value: 'false', label: 'Wick Break' }] },
      rangePercent: { type: 'number', label: 'Liquidity Range (%)', value: 1.0, min: 0.1, max: 10.0, step: 0.1 },
      unmitigatedOnly: { type: 'select', label: 'Filter Mitigation', value: 'false', options: [{ value: 'false', label: 'Show All (Mitigated + Active)' }, { value: 'true', label: 'Show Unmitigated Only' }] }
    },

    defaultStyle: {
      showOB: { type: 'checkbox', label: 'Display Order Blocks (OB)', value: true },
      bullOBColor: { type: 'color', label: 'Bullish OB Color', value: '#3b82f6' },
      bearOBColor: { type: 'color', label: 'Bearish OB Color', value: '#f59e0b' },
      showFVG: { type: 'checkbox', label: 'Display Fair Value Gaps (FVG)', value: true },
      bullFVGColor: { type: 'color', label: 'Bullish FVG Color', value: '#10b981' },
      bearFVGColor: { type: 'color', label: 'Bearish FVG Color', value: '#f43f5e' },
      showLiquidity: { type: 'checkbox', label: 'Display Liquidity Levels', value: true },
      bslColor: { type: 'color', label: 'Buy-Side Liquidity (BSL) Color', value: '#d946ef' },
      sslColor: { type: 'color', label: 'Sell-Side Liquidity (SSL) Color', value: '#6366f1' },
      showBOS: { type: 'checkbox', label: 'Display BOS & CHoCH Breaks', value: true },
      bosColor: { type: 'color', label: 'BOS Break Color', value: '#06b6d4' },
      chochColor: { type: 'color', label: 'CHoCH Break Color', value: '#ec4899' },
      showSwings: { type: 'checkbox', label: 'Display Swing Highs / Lows', value: true }
    },

    calculate: function (candles, inputs) {
      if (!SMC) return {};
      const swingLen = parseInt(inputs.swingLength, 10) || 20;
      const closeBreak = inputs.closeBreak === 'true' || inputs.closeBreak === true;
      const unmitOnly = inputs.unmitigatedOnly === 'true' || inputs.unmitigatedOnly === true;
      const rangePct = (parseFloat(inputs.rangePercent) || 1.0) / 100;

      const swings = SMC.swingHighsLows(candles, swingLen);
      const fvg = SMC.fvg(candles, unmitOnly);
      const bos = SMC.bosChoch(candles, swings, closeBreak);
      const ob = SMC.ob(candles, swings, unmitOnly);
      const liq = SMC.liquidity(candles, swings, rangePct);

      return { swings, fvg, bos, ob, liq };
    },

    renderCanvas: function (ctx, calcResult, style, helpers) {
      if (!calcResult) return;
      const { getX, getY, fromTime, toTime, rightViewportX, candles } = helpers;

      // 1. Order Blocks (OB)
      if (style.showOB !== false && calcResult.ob) {
        renderOB(ctx, calcResult.ob, style, getX, getY, fromTime, toTime, rightViewportX, candles);
      }

      // 2. Fair Value Gaps (FVG)
      if (style.showFVG !== false && calcResult.fvg) {
        renderFVG(ctx, calcResult.fvg, style, getX, getY, fromTime, toTime, rightViewportX, candles);
      }

      // 3. Liquidity
      if (style.showLiquidity !== false && calcResult.liq) {
        renderLiquidity(ctx, calcResult.liq, style, getX, getY, fromTime, toTime, rightViewportX, candles, helpers.formatPrice);
      }

      // 4. BOS & CHoCH
      if (style.showBOS !== false && calcResult.bos) {
        renderBOS(ctx, calcResult.bos, style, getX, getY, fromTime, toTime, candles);
      }

      // 5. Swings
      if (style.showSwings !== false && calcResult.swings) {
        renderSwings(ctx, calcResult.swings, style, getX, getY, fromTime, toTime, candles);
      }
    }
  };

  function hexToRgba(hex, alpha = 0.2) {
    if (!hex) return `rgba(56, 189, 248, ${alpha})`;
    if (hex.startsWith('rgba')) return hex;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  function renderOB(ctx, list, style, getX, getY, fromTime, toTime, rightViewportX, candles) {
    const latestTime = candles.length > 0 ? candles[candles.length - 1].time : toTime;
    ctx.save();

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.OB === null) continue;

      const isBull = item.OB === 1;
      const isMit = item.MitigatedIndex !== null && item.MitigatedIndex > 0;
      const mitTime = isMit && item.MitigatedIndex < candles.length ? candles[item.MitigatedIndex].time : latestTime;
      if (mitTime < fromTime || candles[i].time > toTime) continue;

      const x1 = getX(candles[i].time);
      const x2 = isMit ? getX(mitTime) : rightViewportX;
      if (x1 === null && x2 === null) continue;
      const startX = x1 !== null ? x1 : -100;
      const endX = x2 !== null ? x2 : rightViewportX;
      const boxW = Math.max(endX - startX, 4);

      const yTop = getY(item.Top);
      const yBottom = getY(item.Bottom);
      if (yTop === null || yBottom === null) continue;

      const boxY = Math.min(yTop, yBottom);
      const boxH = Math.max(Math.abs(yBottom - yTop), 3);

      const obColor = isBull ? (style.bullOBColor || '#3b82f6') : (style.bearOBColor || '#f59e0b');
      ctx.fillStyle = hexToRgba(obColor, isMit ? 0.10 : 0.22);
      ctx.fillRect(startX, boxY, boxW, boxH);

      ctx.strokeStyle = obColor;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(startX, boxY, boxW, boxH);

      if (boxW > 30 && endX > 20) {
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillStyle = obColor;
        const textX = Math.max(startX + 5, 8);
        ctx.fillText(isBull ? 'OB +' : 'OB -', textX, boxY + 12);
      }
    }
    ctx.restore();
  }

  function renderFVG(ctx, list, style, getX, getY, fromTime, toTime, rightViewportX, candles) {
    const latestTime = candles.length > 0 ? candles[candles.length - 1].time : toTime;
    ctx.save();

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.FVG === null) continue;

      const isBull = item.FVG === 1;
      const isMit = item.MitigatedIndex !== null && item.MitigatedIndex > 0;
      const mitTime = isMit && item.MitigatedIndex < candles.length ? candles[item.MitigatedIndex].time : latestTime;
      if (mitTime < fromTime || candles[i].time > toTime) continue;

      const x1 = getX(candles[i].time);
      const x2 = isMit ? getX(mitTime) : rightViewportX;
      if (x1 === null && x2 === null) continue;
      const startX = x1 !== null ? x1 : -100;
      const endX = x2 !== null ? x2 : rightViewportX;
      const boxW = Math.max(endX - startX, 4);

      const yTop = getY(item.Top);
      const yBottom = getY(item.Bottom);
      if (yTop === null || yBottom === null) continue;

      const boxY = Math.min(yTop, yBottom);
      const boxH = Math.max(Math.abs(yBottom - yTop), 2);

      const fvgColor = isBull ? (style.bullFVGColor || '#10b981') : (style.bearFVGColor || '#f43f5e');
      ctx.fillStyle = hexToRgba(fvgColor, isMit ? 0.08 : 0.22);
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
    ctx.restore();
  }

  function renderLiquidity(ctx, list, style, getX, getY, fromTime, toTime, rightViewportX, candles, formatPrice) {
    ctx.save();
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.Liquidity === null) continue;

      const sweptTime = item.Swept > 0 && item.Swept < candles.length ? candles[item.Swept].time : null;
      const endTime = sweptTime || (item.End < candles.length ? candles[item.End].time : toTime);
      if (endTime < fromTime || candles[i].time > toTime) continue;

      const x1 = getX(candles[i].time);
      const x2 = sweptTime ? getX(sweptTime) : rightViewportX;
      const y = getY(item.Level);
      if (y === null) continue;
      const startX = x1 !== null ? x1 : -100;
      const endX = x2 !== null ? x2 : rightViewportX;

      const isHigh = item.Liquidity === 1;
      const baseColor = isHigh ? (style.bslColor || '#d946ef') : (style.sslColor || '#6366f1');

      ctx.beginPath();
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const formattedLvl = formatPrice ? formatPrice(item.Level) : item.Level.toFixed(2);
      const label = isHigh ? `💧 BSL $$$ ${formattedLvl}` : `💧 SSL $$$ ${formattedLvl}`;
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      const textW = ctx.measureText(label).width;
      const badgeW = textW + 12;
      const badgeH = 18;
      const badgeX = Math.max(endX - badgeW - 6, 8);
      const badgeY = y - badgeH / 2;

      ctx.fillStyle = baseColor;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
        ctx.fill();
      } else {
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      }

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, badgeX + badgeW / 2, badgeY + badgeH / 2);
    }
    ctx.restore();
  }

  function renderBOS(ctx, list, style, getX, getY, fromTime, toTime, candles) {
    ctx.save();
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.BOS === null && item.CHOCH === null) continue;

      const isBOS = item.BOS !== null;
      const val = isBOS ? item.BOS : item.CHOCH;
      const isBull = val === 1;
      const brokenIndex = item.BrokenIndex;
      if (brokenIndex === null || brokenIndex >= candles.length) continue;

      const t1 = candles[i].time;
      const t2 = candles[brokenIndex].time;
      if (t2 < fromTime || t1 > toTime) continue;

      const x1 = getX(t1);
      const x2 = getX(t2);
      const y = getY(item.Level);
      if (x1 === null || x2 === null || y === null) continue;

      const tagText = isBOS ? (isBull ? 'BOS ▲' : 'BOS ▼') : (isBull ? 'CHoCH ▲' : 'CHoCH ▼');
      const color = isBOS ? (style.bosColor || '#06b6d4') : (style.chochColor || '#ec4899');

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const midX = (x1 + x2) / 2;
      ctx.fillText(tagText, midX, y - 8);
    }
    ctx.restore();
  }

  function renderSwings(ctx, list, style, getX, getY, fromTime, toTime, candles) {
    ctx.save();
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.HighLow === null) continue;
      const c = candles[i];
      if (c.time < fromTime || c.time > toTime) continue;

      const x = getX(c.time);
      const isHigh = item.HighLow === 1;
      const y = isHigh ? getY(c.high) : getY(c.low);
      if (x === null || y === null) continue;

      const color = isHigh ? '#10b981' : '#f43f5e';
      const label = isHigh ? 'H' : 'L';
      const tagY = isHigh ? y - 10 : y + 10;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, tagY);
    }
    ctx.restore();
  }

  if (IndicatorRegistry) {
    IndicatorRegistry.register(SMCIndicator);
  }

  return SMCIndicator;
}));
