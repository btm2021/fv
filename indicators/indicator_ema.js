/**
 * Indicator: Exponential Moving Average Ribbon (EMA Ribbon)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../smc.js'), require('./registry.js'));
  } else {
    factory(root.SMC, root.IndicatorRegistry);
  }
}(typeof self !== 'undefined' ? self : this, function (SMC, IndicatorRegistry) {
  'use strict';

  const EMARibbonIndicator = {
    id: 'ema',
    name: 'Moving Average Exponential (EMA Ribbon)',
    shortName: 'EMA Ribbon',
    category: 'Moving Averages',
    tag: 'EMA Ribbon · Fast / Mid / Slow',
    desc: 'Triple exponential moving average ribbon providing dynamic trend direction, momentum filtering, and support/resistance levels.',
    color: '#fbbf24',
    isSeries: true,

    defaultInputs: {
      period1: { type: 'number', label: 'EMA 1 Period (Fast)', value: 21, min: 1, max: 1000, step: 1 },
      period2: { type: 'number', label: 'EMA 2 Period (Medium)', value: 50, min: 1, max: 1000, step: 1 },
      period3: { type: 'number', label: 'EMA 3 Period (Slow)', value: 200, min: 1, max: 1000, step: 1 },
      source: { type: 'select', label: 'Price Source', value: 'close', options: ['close', 'hl2', 'hlc3', 'ohlc4', 'open'] }
    },

    defaultStyle: {
      showEma1: { type: 'checkbox', label: 'Display EMA 1', value: true },
      ema1Color: { type: 'color', label: 'EMA 1 Line Color', value: '#38bdf8' },
      ema1Width: { type: 'number', label: 'EMA 1 Line Width', value: 1.5, min: 1, max: 6, step: 0.5 },
      showEma2: { type: 'checkbox', label: 'Display EMA 2', value: true },
      ema2Color: { type: 'color', label: 'EMA 2 Line Color', value: '#a855f7' },
      ema2Width: { type: 'number', label: 'EMA 2 Line Width', value: 1.5, min: 1, max: 6, step: 0.5 },
      showEma3: { type: 'checkbox', label: 'Display EMA 3', value: true },
      ema3Color: { type: 'color', label: 'EMA 3 Line Color', value: '#f59e0b' },
      ema3Width: { type: 'number', label: 'EMA 3 Line Width', value: 2, min: 1, max: 6, step: 0.5 }
    },

    calculate: function (candles, inputs) {
      if (!SMC || !SMC.ema) return {};
      const src = inputs.source || 'close';
      return {
        ema1: SMC.ema(candles, parseInt(inputs.period1, 10) || 21, src),
        ema2: SMC.ema(candles, parseInt(inputs.period2, 10) || 50, src),
        ema3: SMC.ema(candles, parseInt(inputs.period3, 10) || 200, src)
      };
    },

    // Series management for Lightweight Charts
    syncSeries: function (chart, instance, seriesList = []) {
      if (seriesList.length === 0) {
        const s1 = chart.addLineSeries({ color: instance.style.ema1Color || '#38bdf8', lineWidth: instance.style.ema1Width || 1.5 });
        const s2 = chart.addLineSeries({ color: instance.style.ema2Color || '#a855f7', lineWidth: instance.style.ema2Width || 1.5 });
        const s3 = chart.addLineSeries({ color: instance.style.ema3Color || '#f59e0b', lineWidth: instance.style.ema3Width || 2 });
        return [s1, s2, s3];
      }
      return seriesList;
    },

    updateSeries: function (seriesList, calcResult, style, isVisible) {
      if (!seriesList || seriesList.length < 3) return;
      const [s1, s2, s3] = seriesList;

      if (!isVisible || !calcResult) {
        s1.applyOptions({ visible: false });
        s2.applyOptions({ visible: false });
        s3.applyOptions({ visible: false });
        return;
      }

      // EMA 1
      if (style.showEma1 !== false && calcResult.ema1 && calcResult.ema1.length > 0) {
        s1.setData(calcResult.ema1);
        s1.applyOptions({ visible: true, color: style.ema1Color || '#38bdf8', lineWidth: style.ema1Width || 1.5 });
      } else {
        s1.applyOptions({ visible: false });
      }

      // EMA 2
      if (style.showEma2 !== false && calcResult.ema2 && calcResult.ema2.length > 0) {
        s2.setData(calcResult.ema2);
        s2.applyOptions({ visible: true, color: style.ema2Color || '#a855f7', lineWidth: style.ema2Width || 1.5 });
      } else {
        s2.applyOptions({ visible: false });
      }

      // EMA 3
      if (style.showEma3 !== false && calcResult.ema3 && calcResult.ema3.length > 0) {
        s3.setData(calcResult.ema3);
        s3.applyOptions({ visible: true, color: style.ema3Color || '#f59e0b', lineWidth: style.ema3Width || 2 });
      } else {
        s3.applyOptions({ visible: false });
      }
    }
  };

  if (IndicatorRegistry) {
    IndicatorRegistry.register(EMARibbonIndicator);
  }

  return EMARibbonIndicator;
}));
