'use strict';

/**
 * Geometric helpers for chart pattern detection.
 *
 * All functions are pure, deterministic, and operate on index-space
 * (bar index as x-axis, price as y-axis).
 */

/**
 * Fit a least-squares line through {x, y} points.
 * Returns { slope, intercept }.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {{ slope: number, intercept: number }}
 */
function fitLine(points) {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: points[0].y };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX  += p.x;
    sumY  += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) {
    return { slope: 0, intercept: sumY / n };
  }

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Evaluate a line at position x.
 *
 * @param {{ slope: number, intercept: number }} line
 * @param {number} x
 * @returns {number}
 */
function lineAt(line, x) {
  return line.slope * x + line.intercept;
}

/**
 * Slope between two (x, y) points.
 */
function slope2pts(x1, y1, x2, y2) {
  return x2 === x1 ? 0 : (y2 - y1) / (x2 - x1);
}

/**
 * Percentage difference between two values (relative to their average).
 * Returns a value in [0, ∞).
 */
function percentDiff(a, b) {
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  if (avg === 0) return 0;
  return Math.abs(a - b) / avg;
}

/**
 * Check if a slope is "flat" relative to ATR per bar.
 * A slope is flat if its absolute per-bar movement is less than flatFraction × ATR.
 *
 * @param {number} slope       - Price per bar
 * @param {number} atrValue    - Current ATR
 * @param {number} [flatFraction=0.05]
 */
function isFlat(slope, atrValue, flatFraction = 0.05) {
  if (atrValue <= 0) return true;
  return Math.abs(slope) < atrValue * flatFraction;
}

/**
 * True if slope is meaningfully positive (rising) relative to ATR.
 */
function isRising(slope, atrValue, minFraction = 0.01) {
  return slope > atrValue * minFraction;
}

/**
 * True if slope is meaningfully negative (falling) relative to ATR.
 */
function isFalling(slope, atrValue, minFraction = 0.01) {
  return slope < -atrValue * minFraction;
}

/**
 * Estimate the x-coordinate where two lines intersect (apex / convergence point).
 * Returns null if lines are parallel.
 *
 * @param {{ slope: number, intercept: number }} line1
 * @param {{ slope: number, intercept: number }} line2
 * @returns {number|null}
 */
function lineIntersectX(line1, line2) {
  const dSlope = line1.slope - line2.slope;
  if (Math.abs(dSlope) < 1e-12) return null;
  return (line2.intercept - line1.intercept) / dSlope;
}

/**
 * Find the candle with the lowest `low` between two indices (exclusive).
 *
 * @param {Array} candles
 * @param {number} startIdx - exclusive lower bound
 * @param {number} endIdx   - exclusive upper bound
 * @returns {{ price: number, index: number }|null}
 */
function findLowest(candles, startIdx, endIdx) {
  let min = { price: Infinity, index: -1 };
  for (let i = startIdx + 1; i < endIdx; i++) {
    if (candles[i].low < min.price) {
      min = { price: candles[i].low, index: i };
    }
  }
  return min.index >= 0 ? min : null;
}

/**
 * Find the candle with the highest `high` between two indices (exclusive).
 *
 * @param {Array} candles
 * @param {number} startIdx - exclusive lower bound
 * @param {number} endIdx   - exclusive upper bound
 * @returns {{ price: number, index: number }|null}
 */
function findHighest(candles, startIdx, endIdx) {
  let max = { price: -Infinity, index: -1 };
  for (let i = startIdx + 1; i < endIdx; i++) {
    if (candles[i].high > max.price) {
      max = { price: candles[i].high, index: i };
    }
  }
  return max.index >= 0 ? max : null;
}

/**
 * Return the high and low of a candle slice [startIdx, endIdx] inclusive.
 */
function priceRange(candles, startIdx, endIdx) {
  let high = -Infinity, low = Infinity;
  const end = Math.min(endIdx, candles.length - 1);
  for (let i = Math.max(0, startIdx); i <= end; i++) {
    if (candles[i].high > high) high = candles[i].high;
    if (candles[i].low  < low)  low  = candles[i].low;
  }
  return { high, low, range: high - low };
}

/**
 * Compute the average close of a candle slice.
 */
function avgClose(candles, startIdx, endIdx) {
  let sum = 0, count = 0;
  const end = Math.min(endIdx, candles.length - 1);
  for (let i = Math.max(0, startIdx); i <= end; i++) {
    sum += candles[i].close;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

module.exports = {
  fitLine, lineAt, slope2pts, percentDiff,
  isFlat, isRising, isFalling,
  lineIntersectX, findLowest, findHighest,
  priceRange, avgClose,
};
