/**
 * Indicator: Volume Spike Reversal (VSR Zones)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../smc.js'), require('./registry.js'));
  } else {
    factory(root.SMC, root.IndicatorRegistry);
  }
}(typeof self !== 'undefined' ? self : this, function (SMC, IndicatorRegistry) {
  'use strict';

  const VSRIndicator = {
    id: 'vsr',
    name: 'Volume Spike Reversal (VSR Zones)',
    shortName: 'VSR Zones',
    category: 'Volume & Exhaustion',
    tag: 'Volume StDev · Exhaustion Spikes',
    desc: 'Identifies institutional volume spikes based on rolling standard deviation thresholds and highlights key reversal zones.',
    color: '#a855f7',

    defaultInputs: {
      length: { type: 'number', label: 'Rolling Volume Period', value: 10, min: 2, max: 200, step: 1 },
      threshold: { type: 'number', label: 'Volume Spike Threshold (Multiplier)', value: 10.0, min: 1.0, max: 100.0, step: 0.5 }
    },

    defaultStyle: {
      showZones: { type: 'checkbox', label: 'Display Reversal Zones', value: true },
      zoneColor: { type: 'color', label: 'Zone Highlight Color', value: '#a855f7' },
      borderDash: { type: 'select', label: 'Border Line Style', value: 'dashed', options: [{ value: 'solid', label: 'Solid Line' }, { value: 'dashed', label: 'Dashed Line' }] },
      showLabels: { type: 'checkbox', label: 'Display Zone Labels', value: true }
    },

    calculate: function (candles, inputs) {
      if (!SMC || !SMC.vsr) return [];
      return SMC.vsr(candles, {
        length: parseInt(inputs.length, 10) || 10,
        threshold: parseFloat(inputs.threshold) || 10.0
      });
    },

    renderCanvas: function (ctx, list, style, helpers) {
      if (!list || list.length === 0 || style.showZones === false) return;
      const { getX, getY, fromTime, toTime, rightViewportX } = helpers;

      ctx.save();

      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (!item.isSpike) continue;
        if (item.time < fromTime || item.time > toTime) continue;

        const x = getX(item.time);
        const yUpper = getY(item.upper);
        const yLower = getY(item.lower);
        if (x === null || yUpper === null || yLower === null) continue;

        const boxY = Math.min(yUpper, yLower);
        const boxH = Math.max(Math.abs(yLower - yUpper), 2);
        const boxW = Math.max(rightViewportX - x, 10);

        const color = style.zoneColor || '#a855f7';

        // Shaded zone
        ctx.fillStyle = hexToRgba(color, 0.12);
        ctx.fillRect(x, boxY, boxW, boxH);

        ctx.strokeStyle = hexToRgba(color, 0.65);
        ctx.lineWidth = 1;
        ctx.setLineDash(style.borderDash === 'solid' ? [] : [3, 3]);
        ctx.strokeRect(x, boxY, boxW, boxH);
        ctx.setLineDash([]);

        // Label
        if (style.showLabels !== false) {
          ctx.font = 'bold 8px "JetBrains Mono", monospace';
          ctx.fillStyle = color;
          ctx.fillText('⚡ VSR ZONE', x + 4, boxY + 10);
        }
      }

      ctx.restore();
    }
  };

  function hexToRgba(hex, alpha = 0.2) {
    if (!hex) return `rgba(168, 85, 247, ${alpha})`;
    if (hex.startsWith('rgba')) return hex;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  if (IndicatorRegistry) {
    IndicatorRegistry.register(VSRIndicator);
  }

  return VSRIndicator;
}));
