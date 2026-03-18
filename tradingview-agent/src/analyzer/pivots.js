'use strict';

/**
 * Pivot high/low detection.
 *
 * A pivot high at index i means: candles[i].high is higher than the `lookback`
 * bars on both its left and right sides.
 *
 * A pivot low at index i means: candles[i].low is lower than the `lookback`
 * bars on both sides.
 *
 * Pivots near the most recent bars (within `lookback` of the end) cannot be
 * confirmed and are excluded.
 */

/**
 * @typedef {object} PivotPoint
 * @property {number} index   - Index in the candles array
 * @property {number} time    - Unix timestamp of the candle
 * @property {number} price   - Pivot price level (high for pivot high, low for pivot low)
 * @property {'high'|'low'} type
 */

/**
 * Detect pivot highs and lows in a candle array.
 *
 * @param {Array<{ time: number, high: number, low: number, close: number }>} candles - Oldest-first
 * @param {number} [lookback=5] - Number of bars on each side required for confirmation
 * @returns {{ pivotHighs: PivotPoint[], pivotLows: PivotPoint[] }}
 */
function detectPivots(candles, lookback = 5) {
  const pivotHighs = [];
  const pivotLows  = [];

  const n = candles.length;

  for (let i = lookback; i < n - lookback; i++) {
    const c = candles[i];

    // --- Pivot High ---
    let isPivotHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) {
        isPivotHigh = false;
        break;
      }
    }
    if (isPivotHigh) {
      pivotHighs.push({ index: i, time: c.time, price: c.high, type: 'high' });
    }

    // --- Pivot Low ---
    let isPivotLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) {
        isPivotLow = false;
        break;
      }
    }
    if (isPivotLow) {
      pivotLows.push({ index: i, time: c.time, price: c.low, type: 'low' });
    }
  }

  return { pivotHighs, pivotLows };
}

/**
 * Return the N most recent pivot highs and lows.
 *
 * @param {object} pivots - Result of detectPivots
 * @param {number} [n=10]
 * @returns {{ recentHighs: PivotPoint[], recentLows: PivotPoint[] }}
 */
function recentPivots(pivots, n = 10) {
  return {
    recentHighs: pivots.pivotHighs.slice(-n),
    recentLows:  pivots.pivotLows.slice(-n),
  };
}

module.exports = { detectPivots, recentPivots };
