/**
 * Indicator: Volume Weighted Average Price (VWAP)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../smc.js'), require('./registry.js'));
  } else {
    factory(root.SMC, root.IndicatorRegistry);
  }
}(typeof self !== 'undefined' ? self : this, function (SMC, IndicatorRegistry) {
  'use strict';

  const VWAPIndicator = {
    id: 'vwap',
    name: 'Volume Weighted Average Price (VWAP)',
    shortName: 'VWAP',
    category: 'Volume & Benchmark',
    tag: 'VWAP · Standard Deviation Bands',
    desc: 'Institutional benchmark VWAP with standard deviation bands (±1σ, ±2σ, ±3σ) anchored to daily sessions or rolling windows.',
    color: '#f59e0b',
    isSeries: true,

    defaultInputs: {
      anchor: { type: 'select', label: 'Anchor Period', value: 'session', options: [{ value: 'session', label: 'Daily Session (00:00 UTC)' }, { value: 'rolling', label: 'Rolling Window' }] },
      rollingPeriod: { type: 'number', label: 'Rolling Window Bars', value: 200, min: 10, max: 2000, step: 10 },
      source: { type: 'select', label: 'Price Source', value: 'hlc3', options: ['hlc3', 'hl2', 'ohlc4', 'close', 'open'] },
      stdevMult1: { type: 'number', label: 'Band 1 Multiplier (±1σ)', value: 1.0, min: 0.1, max: 10.0, step: 0.1 },
      stdevMult2: { type: 'number', label: 'Band 2 Multiplier (±2σ)', value: 2.0, min: 0.1, max: 10.0, step: 0.1 },
      stdevMult3: { type: 'number', label: 'Band 3 Multiplier (±3σ)', value: 3.0, min: 0.1, max: 10.0, step: 0.1 }
    },

    defaultStyle: {
      showVwap: { type: 'checkbox', label: 'Display VWAP Baseline', value: true },
      vwapColor: { type: 'color', label: 'VWAP Line Color', value: '#fbbf24' },
      vwapWidth: { type: 'number', label: 'VWAP Line Width', value: 2, min: 1, max: 6, step: 0.5 },
      showBand1: { type: 'checkbox', label: 'Display ±1σ Bands', value: false },
      band1Color: { type: 'color', label: '±1σ Band Color', value: '#38bdf8' },
      showBand2: { type: 'checkbox', label: 'Display ±2σ Bands', value: false },
      band2Color: { type: 'color', label: '±2σ Band Color', value: '#a855f7' }
    },

    calculate: function (candles, inputs) {
      if (!SMC || !SMC.vwap) return [];
      return SMC.vwap(candles, {
        anchor: inputs.anchor || 'session',
        rollingPeriod: parseInt(inputs.rollingPeriod, 10) || 200,
        source: inputs.source || 'hlc3',
        stdevMult1: parseFloat(inputs.stdevMult1) || 1.0,
        stdevMult2: parseFloat(inputs.stdevMult2) || 2.0,
        stdevMult3: parseFloat(inputs.stdevMult3) || 3.0
      });
    },

    syncSeries: function (chart, instance, seriesList = []) {
      if (seriesList.length === 0) {
        const sVwap = chart.addLineSeries({ color: instance.style.vwapColor || '#fbbf24', lineWidth: instance.style.vwapWidth || 2 });
        return [sVwap];
      }
      return seriesList;
    },

    updateSeries: function (seriesList, calcResult, style, isVisible) {
      if (!seriesList || seriesList.length === 0) return;
      const s = seriesList[0];

      if (!isVisible || !calcResult || calcResult.length === 0 || style.showVwap === false) {
        s.applyOptions({ visible: false });
        return;
      }

      s.setData(calcResult.map(v => ({ time: v.time, value: v.vwap })));
      s.applyOptions({
        visible: true,
        color: style.vwapColor || '#fbbf24',
        lineWidth: style.vwapWidth || 2
      });
    }
  };

  if (IndicatorRegistry) {
    IndicatorRegistry.register(VWAPIndicator);
  }

  return VWAPIndicator;
}));
