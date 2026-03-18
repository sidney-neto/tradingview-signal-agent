'use strict';

/**
 * ATR (Average True Range) calculation.
 *
 * Uses Wilder's smoothing (same as RSI).
 * True Range = max(high - low, |high - prev_close|, |low - prev_close|)
 */

/**
 * Compute ATR for a given period.
 *
 * @param {Array<{ high: number, low: number, close: number }>} candles - Oldest-first
 * @param {number} [period=14]
 * @returns {number[]} ATR series, same length as input (NaN for early values)
 */
function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) {
    return new Array(candles ? candles.length : 0).fill(NaN);
  }

  const result = new Array(candles.length).fill(NaN);
  const trValues = [];

  // True Range for each bar starting at index 1 (needs prev close)
  for (let i = 1; i < candles.length; i++) {
    const { high, low, close: curr } = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low  - prevClose)
    );
    trValues.push(tr);
  }

  // Initial ATR = simple average of first `period` TR values
  let atrVal = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period] = atrVal; // index period corresponds to trValues[period-1]

  for (let i = period + 1; i < candles.length; i++) {
    const tr = trValues[i - 1];
    atrVal = (atrVal * (period - 1) + tr) / period;
    result[i] = atrVal;
  }

  return result;
}

/**
 * Classify volatility based on recent ATR relative to price.
 *
 * @param {number} atrValue   - Current ATR
 * @param {number} price      - Current price
 * @returns {string}
 */
function classifyVolatility(atrValue, price) {
  if (isNaN(atrValue) || atrValue == null || price <= 0) return 'unknown';
  const pct = (atrValue / price) * 100;
  if (pct >= 5)   return 'extreme';
  if (pct >= 2)   return 'high';
  if (pct >= 0.8) return 'moderate';
  if (pct >= 0.3) return 'low';
  return 'very_low';
}

module.exports = { atr, classifyVolatility };
