/**
 * Indicator: ATRBot (VIDYA & Dynamic Trailing Stop)
 * High Precision, Continuous Edge Rendering
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../smc.js'), require('./registry.js'));
  } else {
    factory(root.SMC, root.IndicatorRegistry);
  }
}(typeof self !== 'undefined' ? self : this, function (SMC, IndicatorRegistry) {
  'use strict';

  const ATRBotIndicator = {
    id: 'atrbot',
    name: 'ATRBot (VIDYA & Dynamic Trailing Stop)',
    shortName: 'ATRBot',
    category: 'Trend & Volatility',
    tag: 'VIDYA · ATR Trailing · Signals',
    desc: 'Adaptive Chande Momentum Oscillator (CMO) VIDYA moving average with dynamic volatility-based trailing stop, ribbon cloud, and Buy/Sell signals.',
    color: '#06b6d4',

    defaultInputs: {
      maType: { type: 'select', label: 'MA Calculation Method', value: 'VIDYA', options: ['VIDYA', 'EMA', 'SMA', 'VWMA', 'HMA', 'WMA', 'TEMA', 'KAMA'] },
      source: { type: 'select', label: 'Price Source', value: 'close', options: ['close', 'hl2', 'hlc3', 'ohlc4', 'open'] },
      cmoLength: { type: 'number', label: 'Chande Momentum (CMO) Length', value: 14, min: 1, max: 200, step: 1 },
      maLength: { type: 'number', label: 'MA Smoothing Period', value: 21, min: 1, max: 500, step: 1 },
      atrLength: { type: 'number', label: 'ATR Volatility Period', value: 14, min: 1, max: 200, step: 1 },
      atrMult: { type: 'number', label: 'ATR Multiplier', value: 2.0, min: 0.1, max: 20.0, step: 0.1 }
    },

    defaultStyle: {
      showRibbon: { type: 'checkbox', label: 'Display Ribbon Cloud Fill', value: true },
      bullCloudColor: { type: 'color', label: 'Bullish Cloud Color', value: '#10b981' },
      bearCloudColor: { type: 'color', label: 'Bearish Cloud Color', value: '#f43f5e' },
      showVidyaLine: { type: 'checkbox', label: 'Display VIDYA Baseline', value: true },
      vidyaColor: { type: 'color', label: 'VIDYA Baseline Color', value: '#06b6d4' },
      vidyaWidth: { type: 'number', label: 'VIDYA Baseline Width', value: 2, min: 1, max: 6, step: 1 },
      showStopLine: { type: 'checkbox', label: 'Display Trailing Stop Line', value: true },
      stopColor: { type: 'color', label: 'Trailing Stop Line Color', value: '#f59e0b' },
      stopWidth: { type: 'number', label: 'Trailing Stop Width', value: 2, min: 1, max: 6, step: 1 },
      showSignals: { type: 'checkbox', label: 'Display Buy / Sell Signals', value: true }
    },

    calculate: function (candles, inputs) {
      const smcEngine = SMC || (typeof window !== 'undefined' ? (window.SMC || window.SmartMoneyConcepts) : null) || (typeof globalThis !== 'undefined' ? (globalThis.SMC || globalThis.SmartMoneyConcepts) : null);
      if (!smcEngine || typeof smcEngine.atrBot !== 'function') return [];
      return smcEngine.atrBot(candles, {
        maType: inputs.maType || 'VIDYA',
        source: inputs.source || 'close',
        cmoLength: inputs.cmoLength || 14,
        maLength: inputs.maLength || 21,
        atrLength: inputs.atrLength || 14,
        atrMult: inputs.atrMult || 2.0
      });
    },

    renderCanvas: function (ctx, data, style, helpers) {
      if (!data || data.length < 2) return;
      const { getX, getY, fromTime, toTime } = helpers;
      const n = data.length;

      ctx.save();

      // 1. Ribbon Cloud Fill
      if (style.showRibbon !== false) {
        for (let i = 1; i < n; i++) {
          const p1 = data[i - 1];
          const p2 = data[i];
          if (p2.time < fromTime && i < n - 1 && data[i + 1].time < fromTime) continue;
          if (p1.time > toTime && i > 1 && data[i - 2].time > toTime) continue;

          const x1 = getX(p1.time);
          const x2 = getX(p2.time);
          const y1_t1 = getY(p1.trail1);
          const y1_t2 = getY(p1.trail2);
          const y2_t1 = getY(p2.trail1);
          const y2_t2 = getY(p2.trail2);

          if (x1 === null || x2 === null || y1_t1 === null || y1_t2 === null || y2_t1 === null || y2_t2 === null) continue;

          const isBull = p2.trail1 >= p2.trail2;
          ctx.fillStyle = isBull ? (style.bullCloudColor ? hexToRgba(style.bullCloudColor, 0.16) : 'rgba(16, 185, 129, 0.16)')
                                 : (style.bearCloudColor ? hexToRgba(style.bearCloudColor, 0.16) : 'rgba(244, 63, 94, 0.16)');
          ctx.beginPath();
          ctx.moveTo(x1, y1_t1);
          ctx.lineTo(x2, y2_t1);
          ctx.lineTo(x2, y2_t2);
          ctx.lineTo(x1, y1_t2);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 2. VIDYA Trail 1 Line
      if (style.showVidyaLine !== false) {
        ctx.lineWidth = style.vidyaWidth || 1.8;
        ctx.strokeStyle = style.vidyaColor || '#06b6d4';
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
          const item = data[i];
          if (item.time < fromTime && i < n - 1 && data[i + 1].time < fromTime) continue;
          if (item.time > toTime && i > 0 && data[i - 1].time > toTime) continue;
          const x = getX(item.time);
          const y = getY(item.trail1);
          if (x === null || y === null) continue;
          if (!started) { ctx.moveTo(x, y); started = true; }
          else { ctx.lineTo(x, y); }
        }
        if (started) ctx.stroke();
      }

      // 3. Dynamic Stop Trail 2 Line
      if (style.showStopLine !== false) {
        ctx.lineWidth = style.stopWidth || 1.8;
        ctx.strokeStyle = style.stopColor || '#f59e0b';
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
          const item = data[i];
          if (item.time < fromTime && i < n - 1 && data[i + 1].time < fromTime) continue;
          if (item.time > toTime && i > 0 && data[i - 1].time > toTime) continue;
          const x = getX(item.time);
          const y = getY(item.trail2);
          if (x === null || y === null) continue;
          if (!started) { ctx.moveTo(x, y); started = true; }
          else { ctx.lineTo(x, y); }
        }
        if (started) ctx.stroke();
      }

      // 4. Buy / Sell Signals
      if (style.showSignals !== false) {
        for (let i = 0; i < n; i++) {
          const item = data[i];
          if (!item.isBuy && !item.isSell) continue;
          if (item.time < fromTime || item.time > toTime) continue;

          const x = getX(item.time);
          const y = getY(item.trail2);
          if (x === null || y === null) continue;

          const isBuy = item.isBuy;
          const label = isBuy ? 'BUY ▲' : 'SELL ▼';
          const pillY = isBuy ? y + 18 : y - 18;

          ctx.font = 'bold 9px "JetBrains Mono", monospace';
          const textW = ctx.measureText(label).width;
          const badgeW = textW + 8;
          const badgeH = 15;

          ctx.fillStyle = isBuy ? 'rgba(16, 185, 129, 0.95)' : 'rgba(244, 63, 94, 0.95)';
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(x - badgeW / 2, pillY - badgeH / 2, badgeW, badgeH, 4);
            ctx.fill();
          } else {
            ctx.fillRect(x - badgeW / 2, pillY - badgeH / 2, badgeW, badgeH);
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

  function hexToRgba(hex, alpha = 0.2) {
    if (!hex) return `rgba(56, 189, 248, ${alpha})`;
    if (hex.startsWith('rgba')) return hex;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  if (IndicatorRegistry) {
    IndicatorRegistry.register(ATRBotIndicator);
  }

  return ATRBotIndicator;
}));
