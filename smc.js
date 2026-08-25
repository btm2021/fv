/**
 * SmartMoneyConcepts (SMC) - Universal JavaScript & Node.js Library
 * 
 * 1:1 Port and enhancement of 'joshyattridge/smart-money-concepts' + ATRBot + VSR
 * 
 * Indicators included:
 * 1. FVG (Fair Value Gaps)
 * 2. Swing Highs & Lows
 * 3. BOS & CHoCH (Break of Structure & Change of Character)
 * 4. OB (Order Blocks)
 * 5. Liquidity (Buyside & Sellside Liquidity)
 * 6. Previous High & Low (Multi-Timeframe Resampling: 1D, 4H, 1W, etc.)
 * 7. Sessions (Sydney, Tokyo, London, New York, Killzones, Custom)
 * 8. Retracements (Fibonacci / Swing Retracement %)
 * 9. ATRBot (VIDYA / Multi-MA + Dynamic ATR Trailing Stop + Signals)
 * 10. VSR (Volume Spike Reversal Zones)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SMC = factory();
    root.SmartMoneyConcepts = root.SMC;
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Helper: Normalize OHLCV Input ---
  function normalizeOHLCV(ohlc) {
    if (!ohlc) {
      throw new TypeError("SMC: Input OHLC data is required.");
    }

    if (!Array.isArray(ohlc) && typeof ohlc === 'object') {
      const openArr = ohlc.open || ohlc.Open || [];
      const highArr = ohlc.high || ohlc.High || [];
      const lowArr = ohlc.low || ohlc.Low || [];
      const closeArr = ohlc.close || ohlc.Close || [];
      const volArr = ohlc.volume || ohlc.Volume || [];
      const timeArr = ohlc.time || ohlc.Time || ohlc.timestamp || ohlc.datetime || [];
      const n = Math.max(openArr.length, highArr.length, lowArr.length, closeArr.length);
      const res = new Array(n);
      for (let i = 0; i < n; i++) {
        res[i] = {
          open: Number(openArr[i]),
          high: Number(highArr[i]),
          low: Number(lowArr[i]),
          close: Number(closeArr[i]),
          volume: volArr[i] !== undefined ? Number(volArr[i]) : 0,
          time: timeArr[i] !== undefined ? timeArr[i] : i
        };
      }
      return res;
    }

    if (!Array.isArray(ohlc)) {
      throw new TypeError("SMC: OHLC input must be an array of candle objects or an object of arrays.");
    }

    const n = ohlc.length;
    const res = new Array(n);
    for (let i = 0; i < n; i++) {
      const c = ohlc[i];
      if (Array.isArray(c)) {
        res[i] = {
          time: c[0],
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          volume: c[5] !== undefined ? Number(c[5]) : 0
        };
      } else {
        res[i] = {
          open: Number(c.open !== undefined ? c.open : c.Open),
          high: Number(c.high !== undefined ? c.high : c.High),
          low: Number(c.low !== undefined ? c.low : c.Low),
          close: Number(c.close !== undefined ? c.close : c.Close),
          volume: Number(c.volume !== undefined ? c.volume : (c.Volume !== undefined ? c.Volume : 0)),
          time: c.time !== undefined ? c.time : (c.Time !== undefined ? c.Time : (c.timestamp || c.datetime || i))
        };
      }
    }
    return res;
  }

  /**
   * 1. FVG - Fair Value Gap
   */
  function fvg(ohlc, joinConsecutive = false) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    const fvgArr = new Array(n).fill(null);
    const topArr = new Array(n).fill(null);
    const bottomArr = new Array(n).fill(null);
    const mitigatedIndexArr = new Array(n).fill(null);

    if (n < 3) {
      const emptyRes = new Array(n);
      for (let i = 0; i < n; i++) {
        emptyRes[i] = { FVG: null, Top: null, Bottom: null, MitigatedIndex: null };
      }
      return emptyRes;
    }

    for (let i = 1; i < n - 1; i++) {
      const prevHigh = data[i - 1].high;
      const prevLow = data[i - 1].low;
      const nextHigh = data[i + 1].high;
      const nextLow = data[i + 1].low;
      const curOpen = data[i].open;
      const curClose = data[i].close;

      if (prevHigh < nextLow && curClose > curOpen) {
        fvgArr[i] = 1;
        topArr[i] = nextLow;
        bottomArr[i] = prevHigh;
      } else if (prevLow > nextHigh && curClose < curOpen) {
        fvgArr[i] = -1;
        topArr[i] = prevLow;
        bottomArr[i] = nextHigh;
      }
    }

    if (joinConsecutive) {
      for (let i = 0; i < n - 1; i++) {
        if (fvgArr[i] !== null && fvgArr[i] === fvgArr[i + 1]) {
          topArr[i + 1] = Math.max(topArr[i], topArr[i + 1]);
          bottomArr[i + 1] = Math.min(bottomArr[i], bottomArr[i + 1]);
          fvgArr[i] = null;
          topArr[i] = null;
          bottomArr[i] = null;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (fvgArr[i] === null) continue;

      const isBull = fvgArr[i] === 1;
      const topVal = topArr[i];
      const btmVal = bottomArr[i];
      let mitIndex = 0;

      for (let j = i + 2; j < n; j++) {
        if (isBull) {
          if (data[j].low <= topVal) {
            mitIndex = j;
            break;
          }
        } else {
          if (data[j].high >= btmVal) {
            mitIndex = j;
            break;
          }
        }
      }

      mitigatedIndexArr[i] = mitIndex;
    }

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = {
        FVG: fvgArr[i],
        Top: topArr[i],
        Bottom: bottomArr[i],
        MitigatedIndex: fvgArr[i] !== null ? mitigatedIndexArr[i] : null
      };
    }
    return result;
  }

  /**
   * 2. Swing Highs and Lows
   * 
   * A swing high is when the current high is the highest high out of swingLength candles before and after.
   * A swing low is when the current low is the lowest low out of swingLength candles before and after.
   * 
   * @param {Array|Object} ohlc - Candles data
   * @param {number} [swingLength=50] - Lookback/lookforward window
   * @returns {Array<{HighLow: number|null, Level: number|null}>}
   */
  function swingHighsLows(ohlc, swingLength = 50) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;
    const sw = swingLength * 2;
    const halfSw = Math.floor(sw / 2);

    const swingHL = new Array(n).fill(null);

    // Matches Python pandas: ohlc["high"].shift(-(swing_length // 2)).rolling(swing_length).max()
    const startI = sw - 1;
    const endI = n - 1 - halfSw;

    for (let i = startI; i <= endI; i++) {
      let maxHigh = -Infinity;
      let minLow = Infinity;
      const winStart = i - halfSw + 1;
      const winEnd = i + halfSw;

      for (let k = winStart; k <= winEnd; k++) {
        if (data[k].high > maxHigh) maxHigh = data[k].high;
        if (data[k].low < minLow) minLow = data[k].low;
      }

      if (data[i].high === maxHigh) {
        swingHL[i] = 1;
      } else if (data[i].low === minLow) {
        swingHL[i] = -1;
      }
    }

    // Step 2: Clean consecutive same-direction swings
    while (true) {
      const positions = [];
      for (let i = 0; i < n; i++) {
        if (swingHL[i] !== null) positions.push(i);
      }

      if (positions.length < 2) break;

      const pLen = positions.length;
      const toRemove = new Array(pLen).fill(false);

      for (let i = 0; i < pLen - 1; i++) {
        const curIdx = positions[i];
        const nextIdx = positions[i + 1];
        const curType = swingHL[curIdx];
        const nextType = swingHL[nextIdx];

        const curHigh = data[curIdx].high;
        const nextHigh = data[nextIdx].high;
        const curLow = data[curIdx].low;
        const nextLow = data[nextIdx].low;

        if (curType === 1 && nextType === 1) {
          if (curHigh < nextHigh) toRemove[i] = true;
          if (curHigh >= nextHigh) toRemove[i + 1] = true;
        } else if (curType === -1 && nextType === -1) {
          if (curLow > nextLow) toRemove[i] = true;
          if (curLow <= nextLow) toRemove[i + 1] = true;
        }
      }

      let hasRemoval = false;
      for (let i = 0; i < pLen; i++) {
        if (toRemove[i]) {
          swingHL[positions[i]] = null;
          hasRemoval = true;
        }
      }

      if (!hasRemoval) break;
    }

    // Step 3: Edge alternating corrections (matching Python smc.py lines 197-205)
    const finalPositions = [];
    for (let i = 0; i < n; i++) {
      if (swingHL[i] !== null) finalPositions.push(i);
    }

    if (finalPositions.length > 0) {
      if (swingHL[finalPositions[0]] === 1) {
        swingHL[0] = -1;
      } else if (swingHL[finalPositions[0]] === -1) {
        swingHL[0] = 1;
      }

      if (swingHL[finalPositions[finalPositions.length - 1]] === -1) {
        swingHL[n - 1] = 1;
      } else if (swingHL[finalPositions[finalPositions.length - 1]] === 1) {
        swingHL[n - 1] = -1;
      }
    }

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      const hl = swingHL[i];
      let level = null;
      if (hl === 1) {
        level = data[i].high;
      } else if (hl === -1) {
        level = data[i].low;
      }
      result[i] = {
        HighLow: hl,
        Level: level
      };
    }
    return result;
  }

  /**
   * 3. BOS & CHoCH (Break of Structure & Change of Character)
   */
  function bosChoch(ohlc, swingHighsLowsData, closeBreak = true) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    const bos = new Array(n).fill(0);
    const choch = new Array(n).fill(0);
    const level = new Array(n).fill(0);
    const broken = new Array(n).fill(0);

    const levelOrder = [];
    const hlOrder = [];
    const lastPositions = [];

    for (let i = 0; i < swingHighsLowsData.length; i++) {
      const item = swingHighsLowsData[i];
      if (item.HighLow !== null && item.HighLow !== undefined) {
        levelOrder.push(item.Level);
        hlOrder.push(item.HighLow);

        if (levelOrder.length >= 4) {
          const lLen = levelOrder.length;
          const posIdx = lastPositions[lastPositions.length - 2];

          const hl4 = hlOrder.slice(lLen - 4);
          const l4_0 = levelOrder[lLen - 4];
          const l4_1 = levelOrder[lLen - 3];
          const l4_2 = levelOrder[lLen - 2];
          const l4_3 = levelOrder[lLen - 1];

          if (hl4[0] === -1 && hl4[1] === 1 && hl4[2] === -1 && hl4[3] === 1) {
            if (l4_0 < l4_2 && l4_2 < l4_1 && l4_1 < l4_3) {
              bos[posIdx] = 1;
              level[posIdx] = l4_1;
            }
          }

          if (hl4[0] === 1 && hl4[1] === -1 && hl4[2] === 1 && hl4[3] === -1) {
            if (l4_0 > l4_2 && l4_2 > l4_1 && l4_1 > l4_3) {
              bos[posIdx] = -1;
              level[posIdx] = l4_1;
            }
          }

          if (hl4[0] === -1 && hl4[1] === 1 && hl4[2] === -1 && hl4[3] === 1) {
            if (l4_3 > l4_1 && l4_1 > l4_0 && l4_0 > l4_2) {
              choch[posIdx] = 1;
              level[posIdx] = l4_1;
            }
          }

          if (hl4[0] === 1 && hl4[1] === -1 && hl4[2] === 1 && hl4[3] === -1) {
            if (l4_3 < l4_1 && l4_1 < l4_0 && l4_0 < l4_2) {
              choch[posIdx] = -1;
              level[posIdx] = l4_1;
            }
          }
        }

        lastPositions.push(i);
      }
    }

    for (let i = 0; i < n; i++) {
      if (bos[i] !== 0 || choch[i] !== 0) {
        const isBull = bos[i] === 1 || choch[i] === 1;
        const isBear = bos[i] === -1 || choch[i] === -1;
        const targetLvl = level[i];
        let brokenIdx = 0;

        for (let j = i + 2; j < n; j++) {
          const testPrice = closeBreak ? data[j].close : (isBull ? data[j].high : data[j].low);
          if (isBull && testPrice > targetLvl) {
            brokenIdx = j;
            break;
          } else if (isBear && testPrice < targetLvl) {
            brokenIdx = j;
            break;
          }
        }

        if (brokenIdx > 0) {
          broken[i] = brokenIdx;

          for (let k = 0; k < i; k++) {
            if ((bos[k] !== 0 || choch[k] !== 0) && broken[k] >= brokenIdx) {
              bos[k] = 0;
              choch[k] = 0;
              level[k] = 0;
              broken[k] = 0;
            }
          }
        }
      }
    }

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      if ((bos[i] !== 0 || choch[i] !== 0) && broken[i] === 0) {
        bos[i] = 0;
        choch[i] = 0;
        level[i] = 0;
      }

      result[i] = {
        BOS: bos[i] !== 0 ? bos[i] : null,
        CHOCH: choch[i] !== 0 ? choch[i] : null,
        Level: level[i] !== 0 ? level[i] : null,
        BrokenIndex: broken[i] !== 0 ? broken[i] : null
      };
    }

    return result;
  }

  /**
   * 4. OB - Order Blocks
   */
  function ob(ohlc, swingHighsLowsData, closeMitigation = false) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    const crossed = new Array(n).fill(false);
    const obArr = new Array(n).fill(0);
    const topArr = new Array(n).fill(0);
    const bottomArr = new Array(n).fill(0);
    const obVolume = new Array(n).fill(0);
    const lowVolume = new Array(n).fill(0);
    const highVolume = new Array(n).fill(0);
    const percentage = new Array(n).fill(0);
    const mitigatedIndex = new Array(n).fill(0);
    const breaker = new Array(n).fill(false);

    const swingHighIndices = [];
    const swingLowIndices = [];
    for (let i = 0; i < swingHighsLowsData.length; i++) {
      const hl = swingHighsLowsData[i].HighLow;
      if (hl === 1) swingHighIndices.push(i);
      else if (hl === -1) swingLowIndices.push(i);
    }

    function findLastIndexBefore(arr, val) {
      let l = 0, r = arr.length - 1, res = null;
      while (l <= r) {
        const mid = Math.floor((l + r) / 2);
        if (arr[mid] < val) {
          res = arr[mid];
          l = mid + 1;
        } else {
          r = mid - 1;
        }
      }
      return res;
    }

    const activeBullish = [];
    for (let closeIndex = 0; closeIndex < n; closeIndex++) {
      for (let a = activeBullish.length - 1; a >= 0; a--) {
        const idx = activeBullish[a];
        if (breaker[idx]) {
          if (data[closeIndex].high > topArr[idx]) {
            obArr[idx] = 0;
            topArr[idx] = 0;
            bottomArr[idx] = 0;
            obVolume[idx] = 0;
            lowVolume[idx] = 0;
            highVolume[idx] = 0;
            mitigatedIndex[idx] = 0;
            percentage[idx] = 0;
            activeBullish.splice(a, 1);
          }
        } else {
          const isBreaker = (!closeMitigation && data[closeIndex].low < bottomArr[idx]) ||
            (closeMitigation && Math.min(data[closeIndex].open, data[closeIndex].close) < bottomArr[idx]);
          if (isBreaker) {
            breaker[idx] = true;
            mitigatedIndex[idx] = closeIndex - 1;
          }
        }
      }

      const lastTopIndex = findLastIndexBefore(swingHighIndices, closeIndex);
      if (lastTopIndex !== null && !crossed[lastTopIndex]) {
        if (data[closeIndex].close > data[lastTopIndex].high) {
          crossed[lastTopIndex] = true;
          const defaultIdx = closeIndex - 1;
          let obBtm = data[defaultIdx].high;
          let obTop = data[defaultIdx].low;
          let obIdx = defaultIdx;

          if (closeIndex - lastTopIndex > 1) {
            const start = lastTopIndex + 1;
            const end = closeIndex;
            if (end > start) {
              let minVal = Infinity;
              let candIdx = -1;
              for (let k = start; k < end; k++) {
                if (data[k].low <= minVal) {
                  minVal = data[k].low;
                  candIdx = k;
                }
              }
              if (candIdx !== -1) {
                obBtm = data[candIdx].low;
                obTop = data[candIdx].high;
                obIdx = candIdx;
              }
            }
          }

          obArr[obIdx] = 1;
          topArr[obIdx] = obTop;
          bottomArr[obIdx] = obBtm;

          const volCur = data[closeIndex].volume || 0;
          const volPrev1 = closeIndex >= 1 ? (data[closeIndex - 1].volume || 0) : 0;
          const volPrev2 = closeIndex >= 2 ? (data[closeIndex - 2].volume || 0) : 0;

          obVolume[obIdx] = volCur + volPrev1 + volPrev2;
          lowVolume[obIdx] = volPrev2;
          highVolume[obIdx] = volCur + volPrev1;

          const maxV = Math.max(highVolume[obIdx], lowVolume[obIdx]);
          percentage[obIdx] = maxV !== 0 ? (Math.min(highVolume[obIdx], lowVolume[obIdx]) / maxV * 100.0) : 100.0;

          activeBullish.push(obIdx);
        }
      }
    }

    const activeBearish = [];
    for (let closeIndex = 0; closeIndex < n; closeIndex++) {
      for (let a = activeBearish.length - 1; a >= 0; a--) {
        const idx = activeBearish[a];
        if (breaker[idx]) {
          if (data[closeIndex].low < bottomArr[idx]) {
            obArr[idx] = 0;
            topArr[idx] = 0;
            bottomArr[idx] = 0;
            obVolume[idx] = 0;
            lowVolume[idx] = 0;
            highVolume[idx] = 0;
            mitigatedIndex[idx] = 0;
            percentage[idx] = 0;
            activeBearish.splice(a, 1);
          }
        } else {
          const isBreaker = (!closeMitigation && data[closeIndex].high > topArr[idx]) ||
            (closeMitigation && Math.max(data[closeIndex].open, data[closeIndex].close) > topArr[idx]);
          if (isBreaker) {
            breaker[idx] = true;
            mitigatedIndex[idx] = closeIndex;
          }
        }
      }

      const lastBtmIndex = findLastIndexBefore(swingLowIndices, closeIndex);
      if (lastBtmIndex !== null && !crossed[lastBtmIndex]) {
        if (data[closeIndex].close < data[lastBtmIndex].low) {
          crossed[lastBtmIndex] = true;
          const defaultIdx = closeIndex - 1;
          let obTop = data[defaultIdx].high;
          let obBtm = data[defaultIdx].low;
          let obIdx = defaultIdx;

          if (closeIndex - lastBtmIndex > 1) {
            const start = lastBtmIndex + 1;
            const end = closeIndex;
            if (end > start) {
              let maxVal = -Infinity;
              let candIdx = -1;
              for (let k = start; k < end; k++) {
                if (data[k].high >= maxVal) {
                  maxVal = data[k].high;
                  candIdx = k;
                }
              }
              if (candIdx !== -1) {
                obTop = data[candIdx].high;
                obBtm = data[candIdx].low;
                obIdx = candIdx;
              }
            }
          }

          obArr[obIdx] = -1;
          topArr[obIdx] = obTop;
          bottomArr[obIdx] = obBtm;

          const volCur = data[closeIndex].volume || 0;
          const volPrev1 = closeIndex >= 1 ? (data[closeIndex - 1].volume || 0) : 0;
          const volPrev2 = closeIndex >= 2 ? (data[closeIndex - 2].volume || 0) : 0;

          obVolume[obIdx] = volCur + volPrev1 + volPrev2;
          lowVolume[obIdx] = volCur + volPrev1;
          highVolume[obIdx] = volPrev2;

          const maxV = Math.max(highVolume[obIdx], lowVolume[obIdx]);
          percentage[obIdx] = maxV !== 0 ? (Math.min(highVolume[obIdx], lowVolume[obIdx]) / maxV * 100.0) : 100.0;

          activeBearish.push(obIdx);
        }
      }
    }

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      const isOB = obArr[i] !== 0;
      result[i] = {
        OB: isOB ? obArr[i] : null,
        Top: isOB ? topArr[i] : null,
        Bottom: isOB ? bottomArr[i] : null,
        OBVolume: isOB ? obVolume[i] : null,
        MitigatedIndex: isOB ? mitigatedIndex[i] : null,
        Percentage: isOB ? percentage[i] : null
      };
    }
    return result;
  }

  /**
   * 5. Liquidity
   */
  function liquidity(ohlc, swingHighsLowsData, rangePercent = 0.01) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    const liqArr = new Array(n).fill(null);
    const liqLevel = new Array(n).fill(null);
    const liqEnd = new Array(n).fill(null);
    const liqSwept = new Array(n).fill(null);

    for (let i = 0; i < n; i++) {
      const shl = swingHighsLowsData[i];
      if (!shl || shl.HighLow === null || shl.Level === null || isNaN(shl.Level)) continue;

      const isBull = shl.HighLow === 1;
      const level = Number(shl.Level);

      let swept = 0;
      for (let j = i + 1; j < n; j++) {
        if (isBull) {
          if (data[j].high >= level) { swept = j; break; }
        } else {
          if (data[j].low <= level) { swept = j; break; }
        }
      }

      liqArr[i] = isBull ? 1 : -1;
      liqLevel[i] = level;
      liqEnd[i] = swept > 0 ? swept : n - 1;
      liqSwept[i] = swept;
    }

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = {
        Liquidity: liqArr[i],
        Level: liqLevel[i],
        End: liqEnd[i],
        Swept: liqSwept[i]
      };
    }
    return result;
  }

  /**
   * 6. Previous High Low
   */
  function previousHighLow(ohlc, timeFrame = "1D") {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    function getPeriodTimestamp(t, tf) {
      const d = new Date(typeof t === 'number' && t < 1e11 ? t * 1000 : t);
      const tfUpper = tf.toUpperCase();
      if (tfUpper.endsWith('D')) {
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      } else if (tfUpper.endsWith('H')) {
        const h = parseInt(tfUpper, 10) || 1;
        const hourBucket = Math.floor(d.getUTCHours() / h) * h;
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourBucket);
      } else if (tfUpper.endsWith('W')) {
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff);
      } else if (tfUpper.endsWith('M')) {
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      }
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }

    const periodsMap = new Map();
    for (let i = 0; i < n; i++) {
      const pTime = getPeriodTimestamp(data[i].time, timeFrame);
      if (!periodsMap.has(pTime)) {
        periodsMap.set(pTime, { high: -Infinity, low: Infinity, startIndex: i });
      }
      const p = periodsMap.get(pTime);
      if (data[i].high > p.high) p.high = data[i].high;
      if (data[i].low < p.low) p.low = data[i].low;
    }

    const periodsList = Array.from(periodsMap.entries()).sort((a, b) => a[0] - b[0]);
    const pTimes = periodsList.map(p => p[0]);

    const prevHighArr = new Array(n).fill(null);
    const prevLowArr = new Array(n).fill(null);
    const brokenHighArr = new Array(n).fill(0);
    const brokenLowArr = new Array(n).fill(0);

    let cumMaxHigh = -Infinity;
    let cumMinLow = Infinity;
    let currentPeriodIdx = -1;

    for (let i = 0; i < n; i++) {
      const pTime = getPeriodTimestamp(data[i].time, timeFrame);
      let pIdx = pTimes.indexOf(pTime);

      if (pIdx !== currentPeriodIdx) {
        currentPeriodIdx = pIdx;
        cumMaxHigh = data[i].high;
        cumMinLow = data[i].low;
      } else {
        cumMaxHigh = Math.max(cumMaxHigh, data[i].high);
        cumMinLow = Math.min(cumMinLow, data[i].low);
      }

      if (pIdx >= 1) {
        const prevP = periodsList[pIdx - 1][1];
        prevHighArr[i] = prevP.high;
        prevLowArr[i] = prevP.low;

        if (cumMaxHigh > prevP.high) brokenHighArr[i] = 1;
        if (cumMinLow < prevP.low) brokenLowArr[i] = 1;
      }
    }

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = {
        PreviousHigh: prevHighArr[i],
        PreviousLow: prevLowArr[i],
        BrokenHigh: brokenHighArr[i],
        BrokenLow: brokenLowArr[i]
      };
    }
    return result;
  }

  /**
   * 7. Sessions
   */
  function sessions(ohlc, session, startTime = "", endTime = "", timeZone = "UTC") {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    const defaultSessions = {
      "Sydney": { start: "21:00", end: "06:00" },
      "Tokyo": { start: "00:00", end: "09:00" },
      "London": { start: "07:00", end: "16:00" },
      "New York": { start: "13:00", end: "22:00" },
      "Asian kill zone": { start: "00:00", end: "04:00" },
      "London open kill zone": { start: "06:00", end: "09:00" },
      "New York kill zone": { start: "11:00", end: "14:00" },
      "london close kill zone": { start: "14:00", end: "16:00" },
      "Custom": { start: startTime, end: endTime }
    };

    const sDef = defaultSessions[session];
    if (!sDef || (!sDef.start && !sDef.end)) {
      throw new Error(`SMC.sessions: Invalid session name '${session}' or missing start/end time.`);
    }

    function timeToMinutes(str) {
      const parts = str.split(':');
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }

    const startMin = timeToMinutes(sDef.start);
    const endMin = timeToMinutes(sDef.end);

    const active = new Array(n).fill(0);
    const high = new Array(n).fill(0);
    const low = new Array(n).fill(0);

    for (let i = 0; i < n; i++) {
      const t = data[i].time;
      const d = new Date(typeof t === 'number' && t < 1e11 ? t * 1000 : t);
      const curMin = d.getUTCHours() * 60 + d.getUTCMinutes();

      let isActive = false;
      if (startMin < endMin) {
        isActive = curMin >= startMin && curMin <= endMin;
      } else {
        isActive = curMin >= startMin || curMin <= endMin;
      }

      if (isActive) {
        active[i] = 1;
        high[i] = Math.max(data[i].high, i > 0 && active[i - 1] === 1 ? high[i - 1] : 0);
        low[i] = Math.min(data[i].low, i > 0 && active[i - 1] === 1 && low[i - 1] !== 0 ? low[i - 1] : Infinity);
      } else {
        active[i] = 0;
        high[i] = 0;
        low[i] = 0;
      }
    }

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = {
        Active: active[i],
        High: high[i],
        Low: low[i] === Infinity ? 0 : low[i]
      };
    }
    return result;
  }

  /**
   * 8. Retracements
   */
  function retracements(ohlc, swingHighsLowsData) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    let direction = new Array(n).fill(0);
    let currentRet = new Array(n).fill(0);
    let deepestRet = new Array(n).fill(0);

    let top = 0;
    let bottom = 0;

    for (let i = 0; i < n; i++) {
      const hl = swingHighsLowsData[i].HighLow;
      const lvl = swingHighsLowsData[i].Level;

      if (hl === 1) {
        direction[i] = 1;
        top = lvl;
      } else if (hl === -1) {
        direction[i] = -1;
        bottom = lvl;
      } else {
        direction[i] = i > 0 ? direction[i - 1] : 0;
      }

      if (i > 0) {
        if (direction[i - 1] === 1) {
          const divisor = top - bottom;
          currentRet[i] = divisor !== 0 ? Number((100 - (((data[i].low - bottom) / divisor) * 100)).toFixed(1)) : 0;
          deepestRet[i] = Math.max(direction[i - 1] === 1 ? deepestRet[i - 1] : 0, currentRet[i]);
        } else if (direction[i - 1] === -1) {
          const divisor = bottom - top;
          currentRet[i] = divisor !== 0 ? Number((100 - (((data[i].high - top) / divisor) * 100)).toFixed(1)) : 0;
          deepestRet[i] = Math.max(direction[i - 1] === -1 ? deepestRet[i - 1] : 0, currentRet[i]);
        }
      }
    }

    const shiftedDir = new Array(n).fill(0);
    const shiftedCur = new Array(n).fill(0);
    const shiftedDeep = new Array(n).fill(0);

    for (let i = 1; i < n; i++) {
      shiftedDir[i] = direction[i - 1];
      shiftedCur[i] = currentRet[i - 1];
      shiftedDeep[i] = deepestRet[i - 1];
    }
    shiftedDir[0] = direction[n - 1];
    shiftedCur[0] = currentRet[n - 1];
    shiftedDeep[0] = deepestRet[n - 1];

    let removeCount = 0;
    for (let i = 0; i < n - 1; i++) {
      if (shiftedDir[i] !== shiftedDir[i + 1]) {
        removeCount++;
      }
      shiftedDir[i] = 0;
      shiftedCur[i] = 0;
      shiftedDeep[i] = 0;
      if (removeCount === 3) {
        shiftedDir[i + 1] = 0;
        shiftedCur[i + 1] = 0;
        shiftedDeep[i + 1] = 0;
        break;
      }
    }

    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = {
        Direction: shiftedDir[i],
        CurrentRetracement: shiftedCur[i],
        DeepestRetracement: shiftedDeep[i]
      };
    }
    return result;
  }

  /**
   * 9. ATRBot - Dynamic Trail with VIDYA / Multi-MA and Trend Signals
   * 
   * @param {Array|Object} ohlc - Candles data
   * @param {Object} [options]
   * @param {number} [options.atrLength=14] - ATR Period
   * @param {number} [options.atrMult=2.0] - ATR Multiplier
   * @param {string} [options.source="close"] - Source price
   * @param {string} [options.maType="VIDYA"] - MA Type ('VIDYA', 'EMA', 'SMA', 'VWMA', 'LWMA', 'HMA', etc.)
   * @param {number} [options.maLength=21] - MA Period
   * @param {number} [options.cmoLength=14] - CMO Period for VIDYA
   * @returns {Array<{trail1: number, trail2: number, trend: number, isBuy: boolean, isSell: boolean, atr: number, time: any}>}
   */
  function atrBot(ohlc, options = {}) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    const atrLength = options.atrLength !== undefined ? Number(options.atrLength) : 14;
    const atrMult = options.atrMult !== undefined ? Number(options.atrMult) : 2.0;
    const sourceType = (options.source || "close").toLowerCase();
    const maType = (options.maType || "VIDYA").toUpperCase();
    const maLength = options.maLength !== undefined ? Number(options.maLength) : 21;
    const cmoLength = options.cmoLength !== undefined ? Number(options.cmoLength) : 14;

    const results = new Array(n);

    let prevClose = NaN;
    let prevATR = NaN;
    let prevTrail1 = NaN;
    let prevTrail2 = NaN;
    let prevTrend = 0;

    let prevEMA = NaN;
    const vidyaBuffer = [];
    let vidyaPrev = NaN;

    for (let i = 0; i < n; i++) {
      const bar = data[i];
      const open = bar.open;
      const high = bar.high;
      const low = bar.low;
      const close = bar.close;

      let src = close;
      if (sourceType === "open") src = open;
      else if (sourceType === "high") src = high;
      else if (sourceType === "low") src = low;
      else if (sourceType === "hl2") src = (high + low) / 2.0;
      else if (sourceType === "hlc3") src = (high + low + close) / 3.0;
      else if (sourceType === "ohlc4") src = (open + high + low + close) / 4.0;

      // 1. Calculate MA (Trail 1)
      let trail1 = src;
      if (maType === "VIDYA") {
        if (isNaN(vidyaPrev)) {
          trail1 = src;
          vidyaPrev = src;
        } else {
          const change = src - (isNaN(prevTrail1) ? src : data[i - 1].close);
          if (change > 0) {
            vidyaBuffer.push({ gain: change, loss: 0 });
          } else if (change < 0) {
            vidyaBuffer.push({ gain: 0, loss: Math.abs(change) });
          } else {
            vidyaBuffer.push({ gain: 0, loss: 0 });
          }

          if (vidyaBuffer.length > cmoLength) {
            vidyaBuffer.shift();
          }

          let sumGains = 0, sumLosses = 0;
          for (let j = 0; j < vidyaBuffer.length; j++) {
            sumGains += vidyaBuffer[j].gain;
            sumLosses += vidyaBuffer[j].loss;
          }
          const sumTotal = sumGains + sumLosses;
          let cmo = 0;
          if (sumTotal > 0) {
            cmo = ((sumGains - sumLosses) / sumTotal) * 100;
          }

          const emaAlpha = 2.0 / (maLength + 1);
          const alpha = emaAlpha * (Math.abs(cmo) / 100);
          trail1 = alpha * src + (1 - alpha) * vidyaPrev;
          vidyaPrev = trail1;
        }
      } else {
        // Default EMA
        if (isNaN(prevEMA)) {
          trail1 = src;
        } else {
          const alpha = 2.0 / (maLength + 1);
          trail1 = alpha * src + (1 - alpha) * prevEMA;
        }
        prevEMA = trail1;
      }

      // 2. Calculate True Range & ATR (Wilder's Smoothing)
      let tr = 0;
      if (isNaN(prevClose)) {
        tr = high - low;
      } else {
        tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      }

      let atr = tr;
      if (isNaN(prevATR)) {
        atr = tr;
      } else {
        atr = (prevATR * (atrLength - 1) + tr) / atrLength;
      }
      const atrValue = atr * atrMult;

      // 3. Calculate Trail 2 (Dynamic ATR Trailing Stop)
      let trail2 = trail1;
      const t2Prev = isNaN(prevTrail2) ? 0 : prevTrail2;
      const t1Prev = isNaN(prevTrail1) ? trail1 : prevTrail1;

      if (trail1 > t2Prev) {
        if (t1Prev > t2Prev) {
          trail2 = Math.max(t2Prev, trail1 - atrValue);
        } else {
          trail2 = trail1 - atrValue;
        }
      } else {
        if (trail1 < t2Prev && t1Prev < t2Prev) {
          trail2 = Math.min(t2Prev, trail1 + atrValue);
        } else {
          trail2 = trail1 + atrValue;
        }
      }

      // 4. Trend & Signal Detection
      const trend = trail1 > trail2 ? 1 : (trail1 < trail2 ? -1 : prevTrend);
      const isBuy = (trend === 1 && prevTrend === -1);
      const isSell = (trend === -1 && prevTrend === 1);

      prevClose = close;
      prevATR = atr;
      prevTrail1 = trail1;
      prevTrail2 = trail2;
      prevTrend = trend;

      results[i] = {
        time: bar.time,
        trail1: trail1,
        trail2: trail2,
        trend: trend,
        isBuy: isBuy,
        isSell: isSell,
        atr: atr
      };
    }

    return results;
  }

  /**
   * 10. VSR - Volume Spike Reversal Zones
   * 
   * @param {Array|Object} ohlc - Candles data
   * @param {Object} [options]
   * @param {number} [options.length=10] - Volume SD Length
   * @param {number} [options.threshold=10.0] - Volume Spike Threshold
   * @returns {Array<{upper: number|null, lower: number|null, signal: number, isSpike: boolean, time: any}>}
   */
  function vsr(ohlc, options = {}) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    const length = options.length !== undefined ? Number(options.length) : 10;
    const threshold = options.threshold !== undefined ? Number(options.threshold) : 10.0;

    const results = new Array(n);

    let prevVolume = NaN;
    let prevStdev = NaN;
    let vsrUpper = NaN;
    let vsrLower = NaN;
    const volumeChanges = [];

    for (let i = 0; i < n; i++) {
      const bar = data[i];
      const high = bar.high;
      const low = bar.low;
      const close = bar.close;
      const volume = bar.volume || 0;

      let change = 0;
      if (!isNaN(prevVolume) && prevVolume !== 0) {
        change = (volume / prevVolume) - 1.0;
      }

      volumeChanges.push(change);
      if (volumeChanges.length > length) {
        volumeChanges.shift();
      }

      let stdev = 0;
      if (volumeChanges.length >= 2) {
        const sum = volumeChanges.reduce((a, b) => a + b, 0);
        const mean = sum / volumeChanges.length;
        const variance = volumeChanges.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / volumeChanges.length;
        stdev = Math.sqrt(variance);
      }

      let difference = 0;
      let signal = 0;
      if (!isNaN(prevStdev) && prevStdev !== 0 && volumeChanges.length >= 2) {
        difference = change / prevStdev;
        signal = Math.abs(difference);
      }

      let isSpike = false;
      if (signal > threshold && !isNaN(high) && !isNaN(low) && !isNaN(close)) {
        isSpike = true;
        const proposedUpper = Math.max(high, close);
        const proposedLower = Math.min(low, close);

        let isOverlap = false;
        if (!isNaN(vsrUpper) && !isNaN(vsrLower)) {
          if (proposedLower <= vsrUpper && vsrLower <= proposedUpper) {
            isOverlap = true;
          }
        }

        if (isOverlap) {
          vsrUpper = Math.max(vsrUpper, proposedUpper);
          vsrLower = Math.min(vsrLower, proposedLower);
        } else {
          vsrUpper = proposedUpper;
          vsrLower = proposedLower;
        }
      }

      prevVolume = volume;
      prevStdev = stdev;

      results[i] = {
        upper: !isNaN(vsrUpper) ? vsrUpper : null,
        lower: !isNaN(vsrLower) ? vsrLower : null,
        signal: signal,
        isSpike: isSpike,
        time: bar.time
      };
    }

    return results;
  }

  /**
   * 11. EMA - Exponential Moving Average
   * 
   * @param {Array|Object} ohlc - Candles data or array of price numbers
   * @param {number} [period=20] - EMA Period
   * @param {string} [source="close"] - Price source ('close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4')
   * @returns {Array<{time: any, value: number}>|Array<number>}
   */
  function ema(ohlc, period = 20, source = "close") {
    if (!ohlc) throw new TypeError("SMC.ema: Input data is required.");

    // Handle array of numbers
    if (Array.isArray(ohlc) && typeof ohlc[0] === 'number') {
      const n = ohlc.length;
      const res = new Array(n);
      const alpha = 2.0 / (period + 1);
      let prev = NaN;
      for (let i = 0; i < n; i++) {
        const val = ohlc[i];
        if (isNaN(prev)) {
          prev = val;
        } else {
          prev = alpha * val + (1 - alpha) * prev;
        }
        res[i] = prev;
      }
      return res;
    }

    const data = normalizeOHLCV(ohlc);
    const n = data.length;
    const res = new Array(n);
    const alpha = 2.0 / (period + 1);
    const srcType = source.toLowerCase();

    let prev = NaN;
    for (let i = 0; i < n; i++) {
      const bar = data[i];
      let val = bar.close;
      if (srcType === "open") val = bar.open;
      else if (srcType === "high") val = bar.high;
      else if (srcType === "low") val = bar.low;
      else if (srcType === "hl2") val = (bar.high + bar.low) / 2.0;
      else if (srcType === "hlc3") val = (bar.high + bar.low + bar.close) / 3.0;
      else if (srcType === "ohlc4") val = (bar.open + bar.high + bar.low + bar.close) / 4.0;

      if (isNaN(prev)) {
        prev = val;
      } else {
        prev = alpha * val + (1 - alpha) * prev;
      }

      res[i] = {
        time: bar.time,
        value: prev
      };
    }
    return res;
  }

  /**
   * 12. SMA - Simple Moving Average
   * 
   * @param {Array|Object} ohlc - Candles data or array of numbers
   * @param {number} [period=20] - SMA Period
   * @param {string} [source="close"] - Price source
   * @returns {Array<{time: any, value: number}>|Array<number>}
   */
  function sma(ohlc, period = 20, source = "close") {
    if (!ohlc) throw new TypeError("SMC.sma: Input data is required.");

    if (Array.isArray(ohlc) && typeof ohlc[0] === 'number') {
      const n = ohlc.length;
      const res = new Array(n);
      const buf = [];
      let sum = 0;
      for (let i = 0; i < n; i++) {
        buf.push(ohlc[i]);
        sum += ohlc[i];
        if (buf.length > period) {
          sum -= buf.shift();
        }
        res[i] = sum / buf.length;
      }
      return res;
    }

    const data = normalizeOHLCV(ohlc);
    const n = data.length;
    const res = new Array(n);
    const srcType = source.toLowerCase();
    const buf = [];
    let sum = 0;

    for (let i = 0; i < n; i++) {
      const bar = data[i];
      let val = bar.close;
      if (srcType === "open") val = bar.open;
      else if (srcType === "high") val = bar.high;
      else if (srcType === "low") val = bar.low;
      else if (srcType === "hl2") val = (bar.high + bar.low) / 2.0;
      else if (srcType === "hlc3") val = (bar.high + bar.low + bar.close) / 3.0;
      else if (srcType === "ohlc4") val = (bar.open + bar.high + bar.low + bar.close) / 4.0;

      buf.push(val);
      sum += val;
      if (buf.length > period) {
        sum -= buf.shift();
      }

      res[i] = {
        time: bar.time,
        value: sum / buf.length
      };
    }
    return res;
  }

  /**
   * 13. VWAP - Volume Weighted Average Price with Standard Deviation Bands (TradingView Standard ta.vwap)
   * 
   * @param {Array|Object} ohlc - Candles data
   * @param {Object} [options]
   * @param {string} [options.anchor="session"] - Anchor period: 'session' (daily UTC), 'week', 'month', 'none', 'rolling'
   * @param {number} [options.rollingPeriod=200] - Period if anchor is 'rolling'
   * @param {string} [options.source="hlc3"] - Price source ('hlc3', 'hl2', 'close', 'ohlc4')
   * @param {number} [options.stdevMult1=1.0] - Multiplier for Band 1
   * @param {number} [options.stdevMult2=2.0] - Multiplier for Band 2
   * @param {number} [options.stdevMult3=3.0] - Multiplier for Band 3
   * @returns {Array<{time: any, vwap: number, upper1: number, lower1: number, upper2: number, lower2: number, upper3: number, lower3: number, stdev: number}>}
   */
  function vwap(ohlc, options = {}) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;

    const anchor = (options.anchor || "session").toLowerCase();
    const rollingPeriod = options.rollingPeriod !== undefined ? Number(options.rollingPeriod) : 200;
    const sourceType = (options.source || "hlc3").toLowerCase();
    const mult1 = options.stdevMult1 !== undefined ? Number(options.stdevMult1) : 1.0;
    const mult2 = options.stdevMult2 !== undefined ? Number(options.stdevMult2) : 2.0;
    const mult3 = options.stdevMult3 !== undefined ? Number(options.stdevMult3) : 3.0;

    function getAnchorKey(t, anchorType) {
      if (anchorType === "none") return 0;
      const d = new Date(typeof t === 'number' && t < 1e11 ? t * 1000 : t);
      if (anchorType === "session" || anchorType === "day" || anchorType === "1d") {
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      } else if (anchorType === "week" || anchorType === "1w") {
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff);
      } else if (anchorType === "month" || anchorType === "1m") {
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      }
      return 0;
    }

    const results = new Array(n);

    if (anchor === "rolling") {
      // Rolling VWAP with O(N) sliding window
      const pvBuf = [];
      const pv2Buf = [];
      const vBuf = [];

      let sumPV = 0;
      let sumPV2 = 0;
      let sumV = 0;

      for (let i = 0; i < n; i++) {
        const bar = data[i];
        let p = (bar.high + bar.low + bar.close) / 3.0;
        if (sourceType === "close") p = bar.close;
        else if (sourceType === "hl2") p = (bar.high + bar.low) / 2.0;
        else if (sourceType === "ohlc4") p = (bar.open + bar.high + bar.low + bar.close) / 4.0;

        const v = Number(bar.volume || 0);
        const pv = p * v;
        const pv2 = p * p * v;

        pvBuf.push(pv);
        pv2Buf.push(pv2);
        vBuf.push(v);

        sumPV += pv;
        sumPV2 += pv2;
        sumV += v;

        if (pvBuf.length > rollingPeriod) {
          sumPV -= pvBuf.shift();
          sumPV2 -= pv2Buf.shift();
          sumV -= vBuf.shift();
        }

        const curVwap = sumV > 0 ? (sumPV / sumV) : p;
        const variance = sumV > 0 ? Math.max(0, (sumPV2 / sumV) - Math.pow(curVwap, 2)) : 0;
        const stdev = Math.sqrt(variance);

        results[i] = {
          time: bar.time,
          vwap: curVwap,
          upper1: curVwap + mult1 * stdev,
          lower1: curVwap - mult1 * stdev,
          upper2: curVwap + mult2 * stdev,
          lower2: curVwap - mult2 * stdev,
          upper3: curVwap + mult3 * stdev,
          lower3: curVwap - mult3 * stdev,
          stdev: stdev
        };
      }
      return results;
    }

    // Cumulative / Anchored Session VWAP (Closed-form O(1) per bar)
    let currentAnchorKey = null;
    let cumPV = 0;
    let cumPV2 = 0;
    let cumV = 0;

    for (let i = 0; i < n; i++) {
      const bar = data[i];
      const aKey = getAnchorKey(bar.time, anchor);

      let p = (bar.high + bar.low + bar.close) / 3.0;
      if (sourceType === "close") p = bar.close;
      else if (sourceType === "hl2") p = (bar.high + bar.low) / 2.0;
      else if (sourceType === "ohlc4") p = (bar.open + bar.high + bar.low + bar.close) / 4.0;

      const v = Number(bar.volume || 0);
      const pv = p * v;
      const pv2 = p * p * v;

      if (aKey !== currentAnchorKey) {
        currentAnchorKey = aKey;
        cumPV = pv;
        cumPV2 = pv2;
        cumV = v;
      } else {
        cumPV += pv;
        cumPV2 += pv2;
        cumV += v;
      }

      const curVwap = cumV > 0 ? (cumPV / cumV) : p;
      const variance = cumV > 0 ? Math.max(0, (cumPV2 / cumV) - Math.pow(curVwap, 2)) : 0;
      const stdev = Math.sqrt(variance);

      results[i] = {
        time: bar.time,
        vwap: curVwap,
        upper1: curVwap + mult1 * stdev,
        lower1: curVwap - mult1 * stdev,
        upper2: curVwap + mult2 * stdev,
        lower2: curVwap - mult2 * stdev,
        upper3: curVwap + mult3 * stdev,
        lower3: curVwap - mult3 * stdev,
        stdev: stdev
      };
    }

    return results;
  }

  /**
   * 14. RSI - Relative Strength Index (Wilder's Smoothing)
   * 
   * @param {Array|Object} ohlc - Candles data or price array
   * @param {number} [period=14] - RSI Period
   * @param {string} [source="close"] - Price source
   * @returns {Array<{time: any, value: number}>|Array<number>}
   */
  function rsi(ohlc, period = 14, source = "close") {
    if (!ohlc) throw new TypeError("SMC.rsi: Input data is required.");

    const isNumArr = Array.isArray(ohlc) && typeof ohlc[0] === 'number';
    const prices = isNumArr ? ohlc : normalizeOHLCV(ohlc).map(c => c.close);
    const times = isNumArr ? null : normalizeOHLCV(ohlc).map(c => c.time);
    const n = prices.length;
    const res = new Array(n).fill(50);

    if (n < 2) return isNumArr ? res : res.map((v, i) => ({ time: times[i], value: v }));

    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= Math.min(period, n - 1); i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    let rs = avgLoss !== 0 ? avgGain / avgLoss : 100;
    res[Math.min(period, n - 1)] = 100 - (100 / (1 + rs));

    for (let i = period + 1; i < n; i++) {
      const change = prices[i] - prices[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      rs = avgLoss !== 0 ? avgGain / avgLoss : 100;
      res[i] = 100 - (100 / (1 + rs));
    }

    if (isNumArr) return res;
    return res.map((v, i) => ({ time: times[i], value: v }));
  }

  /**
   * 15. ATR - Average True Range (Wilder's Smoothing)
   * 
   * @param {Array|Object} ohlc - Candles data
   * @param {number} [period=14] - ATR Period
   * @returns {Array<{time: any, value: number}>}
   */
  function atr(ohlc, period = 14) {
    const data = normalizeOHLCV(ohlc);
    const n = data.length;
    const res = new Array(n);

    let prevClose = NaN;
    let prevATR = NaN;

    for (let i = 0; i < n; i++) {
      const bar = data[i];
      let tr = 0;
      if (isNaN(prevClose)) {
        tr = bar.high - bar.low;
      } else {
        tr = Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
      }

      if (isNaN(prevATR)) {
        prevATR = tr;
      } else {
        prevATR = (prevATR * (period - 1) + tr) / period;
      }

      prevClose = bar.close;
      res[i] = {
        time: bar.time,
        value: prevATR
      };
    }
    return res;
  }

  // --- API Surface ---
  return {
    fvg,
    swingHighsLows,
    swing_highs_lows: swingHighsLows,
    bosChoch,
    bos_choch: bosChoch,
    ob,
    orderBlocks: ob,
    order_blocks: ob,
    liquidity,
    previousHighLow,
    previous_high_low: previousHighLow,
    sessions,
    retracements,
    atrBot,
    atr_bot: atrBot,
    atrbot: atrBot,
    vsr,
    ema,
    sma,
    vwap,
    rsi,
    atr,
    version: "0.0.27"
  };
}));

