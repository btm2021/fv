/**
 * Indicator: ATRBot + Liquidity Zone Strategy
 *
 * BUY/SELL Signals dựa trên ATRBot trend flip,
 * được lọc bởi Liquidity Zone Rule:
 *   - BUY  signal: bỏ qua nếu có BSL (Buy Side Liq) trong vòng N% PHÍA TRÊN entry
 *   - SELL signal: bỏ qua nếu có SSL (Sell Side Liq) trong vòng N% PHÍA DƯỚI entry
 *
 * Options:
 *   ATRBot params: cmoLength, maLength, atrLength, atrMult
 *   SMC Liq params: swingLength, rangePercent
 *   Filter: liqFilterPct (khoảng cách tối thiểu đến liq zone)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../smc.js'), require('./registry.js'));
  } else {
    factory(root.SMC, root.IndicatorRegistry);
  }
}(typeof self !== 'undefined' ? self : this, function (SMC, IndicatorRegistry) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // Core helper: build active liquidity zone list from SMC liq output
  // SMC.liquidity() returns: object keyed by bar index → { Liquidity, Level, End, Swept }
  // Liquidity: 1 = BSL (above price), -1 = SSL (below price), null = none
  // ─────────────────────────────────────────────────────────────────────────
  function buildLiqZones(liqResult) {
    const zones = [];
    if (!liqResult) return zones;

    // liqResult is keyed by bar index (string keys)
    for (const key of Object.keys(liqResult)) {
      const row     = liqResult[key];
      if (!row || row.Liquidity === null || row.Liquidity === undefined) continue;

      const liqType = row.Liquidity;   // 1 = BSL, -1 = SSL
      const level   = row.Level;
      const endIdx  = row.End;
      const sweptAt = row.Swept;

      if (liqType === null || isNaN(liqType) || level === null || isNaN(level)) continue;

      const startIdx = parseInt(key, 10);
      zones.push({
        startIdx,
        endIdx  : (!endIdx  || isNaN(endIdx))  ? 999999 : endIdx,
        sweptAt : (!sweptAt || isNaN(sweptAt) || sweptAt === 0) ? null : sweptAt,
        type    : liqType > 0 ? 'BSL' : 'SSL',   // BSL = above price, SSL = below price
        level   : level
      });
    }
    return zones;
  }

  /**
   * Return list of active (unswept) liq zones at a given bar index.
   */
  function getActiveZonesAt(barIdx, zones) {
    const result = [];
    for (const z of zones) {
      if (z.startIdx <= barIdx && barIdx <= z.endIdx) {
        if (z.sweptAt === null || z.sweptAt > barIdx) {
          result.push(z);
        }
      }
    }
    return result;
  }

  /**
   * Check if a dangerous liq zone is within threshold% of entry price.
   *   BUY  → danger = BSL above entry
   *   SELL → danger = SSL below entry
   * Returns { isDangerous, nearestDist, dangerLevel }
   */
  function checkDangerLiq(barIdx, direction, entryPrice, zones, thresholdPct) {
    const active = getActiveZonesAt(barIdx, zones);

    let nearestDist = Infinity;
    let dangerLevel = null;

    for (const z of active) {
      let dist;
      if (direction === 'BUY' && z.type === 'BSL' && z.level > entryPrice) {
        // BSL above price — danger for BUY
        dist = (z.level - entryPrice) / entryPrice * 100;
      } else if (direction === 'SELL' && z.type === 'SSL' && z.level < entryPrice) {
        // SSL below price — danger for SELL
        dist = (entryPrice - z.level) / entryPrice * 100;
      } else {
        continue;
      }
      if (dist < nearestDist) {
        nearestDist = dist;
        dangerLevel = z.level;
      }
    }

    const isDangerous = nearestDist < thresholdPct;
    return {
      isDangerous,
      nearestDist : isFinite(nearestDist) ? nearestDist : null,
      dangerLevel
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Indicator Definition
  // ─────────────────────────────────────────────────────────────────────────
  const ATRBotLiqStrategy = {
    id       : 'atrbot_liq_strategy',
    name     : 'ATRBot + Liquidity Zone Strategy',
    shortName: 'ATRBot+Liq',
    category : 'Strategy Signals',
    tag      : 'ATRBot · Liq Filter · Buy/Sell',
    desc     : 'ATRBot trend-flip signals filtered by SMC Liquidity Zone proximity rule. Skips BUY when BSL within N% above, skips SELL when SSL within N% below entry.',
    color    : '#a78bfa',

    // ── Inputs Schema ──
    defaultInputs: {
      // ATRBot params
      cmoLength    : { type: 'number', label: 'ATRBot CMO Length',     value: 14,  min: 1,   max: 200, step: 1   },
      maLength     : { type: 'number', label: 'ATRBot MA Period',      value: 21,  min: 1,   max: 500, step: 1   },
      atrLength    : { type: 'number', label: 'ATRBot ATR Length',     value: 14,  min: 1,   max: 200, step: 1   },
      atrMult      : { type: 'number', label: 'ATRBot ATR Multiplier', value: 2.0, min: 0.1, max: 20,  step: 0.1 },
      // SMC Liq params
      swingLength  : { type: 'number', label: 'SMC Swing Length',      value: 20,  min: 2,   max: 200, step: 1   },
      rangePercent : { type: 'number', label: 'Liq Range (%)',         value: 1.0, min: 0.1, max: 10,  step: 0.1 },
      // Filter
      liqFilterPct : { type: 'number', label: 'Liq Danger Zone (%)',   value: 1.5, min: 0.1, max: 10,  step: 0.1 },
      enableFilter : { type: 'checkbox', label: 'Enable Liq Filter',   value: true  },
    },

    // ── Style Schema ──
    defaultStyle: {
      showBuySignal  : { type: 'checkbox', label: 'Show BUY Signals',          value: true  },
      showSellSignal : { type: 'checkbox', label: 'Show SELL Signals',          value: true  },
      showFiltered   : { type: 'checkbox', label: 'Show Filtered (skipped) signals', value: true },
      buyColor       : { type: 'color',    label: 'BUY Signal Color',           value: '#10b981' },
      sellColor      : { type: 'color',    label: 'SELL Signal Color',          value: '#f43f5e' },
      filteredColor  : { type: 'color',    label: 'Filtered Signal Color',      value: '#6b7280' },
      showDangerLine : { type: 'checkbox', label: 'Show Nearest Danger Liq Line', value: true },
      dangerLineColor: { type: 'color',    label: 'Danger Liq Line Color',      value: '#f59e0b' },
      showTrail      : { type: 'checkbox', label: 'Show ATRBot Trail Line',     value: true  },
      trailColor     : { type: 'color',    label: 'ATRBot Trail Color',         value: '#a78bfa' },
      signalSize     : { type: 'number',   label: 'Signal Badge Size',          value: 10, min: 7, max: 20, step: 1 },
    },

    // ── Calculate ──
    calculate: function (candles, inputs) {
      const smcEngine = SMC || (typeof window !== 'undefined' ? (window.SMC || window.SmartMoneyConcepts) : null) || (typeof globalThis !== 'undefined' ? (globalThis.SMC || globalThis.SmartMoneyConcepts) : null);
      if (!smcEngine || typeof smcEngine.atrBot !== 'function' || typeof smcEngine.swingHighsLows !== 'function' || typeof smcEngine.liquidity !== 'function') return [];

      const n = candles.length;
      if (n < 30) return [];

      const thresholdPct = parseFloat(inputs.liqFilterPct) || 1.5;
      const enableFilter = inputs.enableFilter !== false && inputs.enableFilter !== 'false';
      const rangePct     = (parseFloat(inputs.rangePercent) || 1.0) / 100;

      // 1. ATRBot calculation
      const atrData = smcEngine.atrBot(candles, {
        maType   : 'VIDYA',
        source   : 'close',
        cmoLength: inputs.cmoLength || 14,
        maLength : inputs.maLength  || 21,
        atrLength: inputs.atrLength || 14,
        atrMult  : inputs.atrMult   || 2.0
      });
      if (!atrData || atrData.length === 0) return [];

      // 2. SMC Liquidity calculation
      const swings    = smcEngine.swingHighsLows(candles, parseInt(inputs.swingLength, 10) || 20);
      const liqResult = smcEngine.liquidity(candles, swings, rangePct);
      const liqZones  = buildLiqZones(liqResult);

      // 3. Detect ATRBot signals + apply filter
      const results = [];

      for (let i = 0; i < atrData.length; i++) {
        const bar     = atrData[i];
        const candle  = candles[i];
        if (!bar || !candle) continue;

        const isSignal  = bar.isBuy || bar.isSell;
        const direction = bar.isBuy ? 'BUY' : (bar.isSell ? 'SELL' : null);

        let filtered    = false;
        let nearestDist = null;
        let dangerLevel = null;

        if (isSignal && enableFilter) {
          // Entry is the NEXT bar's open — approximate with current close
          const approxEntryPrice = candle.close;
          const check = checkDangerLiq(i, direction, approxEntryPrice, liqZones, thresholdPct);
          filtered    = check.isDangerous;
          nearestDist = check.nearestDist;
          dangerLevel = check.dangerLevel;
        }

        results.push({
          time       : bar.time,
          trail1     : bar.trail1,
          trail2     : bar.trail2,
          trend      : bar.trend,
          isBuy      : bar.isBuy,
          isSell     : bar.isSell,
          filtered,           // true = lệnh bị lọc bỏ vì có danger liq
          nearestDist,        // % khoảng cách tới liq zone gần nhất
          dangerLevel,        // price level của danger liq zone
          direction           // 'BUY' | 'SELL' | null
        });
      }

      return results;
    },

    // ── Render Canvas ──
    renderCanvas: function (ctx, data, style, helpers) {
      if (!data || data.length < 2) return;
      const { getX, getY, fromTime, toTime } = helpers;
      const n = data.length;

      ctx.save();

      // 1. ATRBot Trail Line (trail2 = dynamic stop)
      if (style.showTrail !== false) {
        ctx.lineWidth   = 1.5;
        ctx.strokeStyle = style.trailColor || '#a78bfa';
        ctx.setLineDash([]);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
          const d = data[i];
          if (d.time < fromTime && i < n - 1 && data[i + 1].time < fromTime) continue;
          if (d.time > toTime  && i > 0 && data[i - 1].time > toTime) continue;
          const x = getX(d.time);
          const y = getY(d.trail2);
          if (x === null || y === null) continue;
          if (!started) { ctx.moveTo(x, y); started = true; }
          else          { ctx.lineTo(x, y); }
        }
        if (started) ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2. Danger Liq Horizontal Line (dashed, only visible bars)
      if (style.showDangerLine !== false) {
        ctx.strokeStyle = style.dangerLineColor || '#f59e0b';
        ctx.lineWidth   = 1;
        ctx.setLineDash([4, 3]);

        // Collect unique danger levels visible on screen
        const drawnLevels = new Set();
        for (let i = 0; i < n; i++) {
          const d = data[i];
          if (!d.filtered || !d.dangerLevel) continue;
          if (d.time < fromTime || d.time > toTime) continue;
          const lvlKey = d.dangerLevel.toFixed(2);
          if (drawnLevels.has(lvlKey)) continue;
          drawnLevels.add(lvlKey);

          const x = getX(d.time);
          const y = getY(d.dangerLevel);
          if (x === null || y === null) continue;

          // Draw dashed line from this signal bar extending a bit
          const xEnd = Math.min(x + 80, ctx.canvas.width);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(xEnd, y);
          ctx.stroke();

          // Label
          ctx.font          = '9px "JetBrains Mono", monospace';
          ctx.fillStyle     = style.dangerLineColor || '#f59e0b';
          ctx.textAlign     = 'left';
          ctx.textBaseline  = 'bottom';
          ctx.fillText('⚠ LIQ', xEnd + 2, y - 1);
        }
        ctx.setLineDash([]);
      }

      // 3. Signal Badges
      const badgeFontSize = Math.max(7, Math.min(14, style.signalSize || 10));
      ctx.font = `bold ${badgeFontSize}px "JetBrains Mono", monospace`;

      const buyColor      = style.buyColor      || '#10b981';
      const sellColor     = style.sellColor     || '#f43f5e';
      const filteredColor = style.filteredColor || '#6b7280';

      for (let i = 0; i < n; i++) {
        const d = data[i];
        if (!d.isBuy && !d.isSell) continue;
        if (d.time < fromTime || d.time > toTime) continue;

        const direction = d.isBuy ? 'BUY' : 'SELL';
        const isFiltered = d.filtered;

        // Skip rendering per style flag
        if (isFiltered && style.showFiltered === false) continue;
        if (!isFiltered && d.isBuy  && style.showBuySignal  === false) continue;
        if (!isFiltered && d.isSell && style.showSellSignal === false) continue;

        const x = getX(d.time);
        const y = getY(d.trail2);
        if (x === null || y === null) continue;

        // Position: buy below trail, sell above
        const isBuy  = d.isBuy;
        const offset = badgeFontSize + 6;
        const pillY  = isBuy ? y + offset : y - offset;

        // Color
        let fillColor;
        if (isFiltered) {
          fillColor = filteredColor;
        } else {
          fillColor = isBuy ? buyColor : sellColor;
        }

        // Label
        let label;
        if (isFiltered) {
          label = isBuy ? '✗ BUY' : '✗ SELL';
        } else {
          label = isBuy ? '▲ BUY' : '▼ SELL';
        }

        // Draw badge
        ctx.font = `bold ${badgeFontSize}px "JetBrains Mono", monospace`;
        const tw = ctx.measureText(label).width;
        const bw = tw + 10;
        const bh = badgeFontSize + 6;

        // Badge background
        ctx.fillStyle = isFiltered
          ? hexToRgba(fillColor, 0.4)
          : hexToRgba(fillColor, 0.92);

        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x - bw / 2, pillY - bh / 2, bw, bh, 4);
          ctx.fill();
        } else {
          ctx.fillRect(x - bw / 2, pillY - bh / 2, bw, bh);
        }

        // Filtered: dashed border
        if (isFiltered) {
          ctx.strokeStyle = hexToRgba(fillColor, 0.7);
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(x - bw / 2, pillY - bh / 2, bw, bh, 4);
            ctx.stroke();
          } else {
            ctx.strokeRect(x - bw / 2, pillY - bh / 2, bw, bh);
          }
          ctx.setLineDash([]);
        }

        // Badge text
        ctx.fillStyle    = isFiltered ? hexToRgba('#ffffff', 0.5) : '#ffffff';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, pillY);

        // If filtered, draw small "danger dist" tooltip below/above
        if (isFiltered && d.nearestDist !== null) {
          const distLabel = `${d.nearestDist.toFixed(1)}%`;
          ctx.font        = `9px "JetBrains Mono", monospace`;
          ctx.fillStyle   = hexToRgba(style.dangerLineColor || '#f59e0b', 0.85);
          ctx.textAlign   = 'center';
          ctx.textBaseline = isBuy ? 'top' : 'bottom';
          const tipY = isBuy ? pillY + bh / 2 + 2 : pillY - bh / 2 - 2;
          ctx.fillText(distLabel, x, tipY);
        }
      }

      ctx.restore();
    }
  };

  // ── Utility ──
  function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(167,139,250,${alpha})`;
    if (hex.startsWith('rgba')) return hex;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`;
  }

  if (IndicatorRegistry) {
    IndicatorRegistry.register(ATRBotLiqStrategy);
  }

  return ATRBotLiqStrategy;
}));
