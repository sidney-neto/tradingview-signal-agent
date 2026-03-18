'use strict';

/**
 * Moving average calculations (EMA and SMA).
 *
 * All functions operate on plain number arrays (close prices or similar series).
 * They return NaN for positions where sufficient history is not yet available.
 */

/**
 * Compute the Exponential Moving Average (EMA) for a given period.
 * Uses the standard smoothing factor: k = 2 / (period + 1).
 *
 * @param {number[]} values - Series of values (e.g. close prices), oldest-first
 * @param {number} period
 * @returns {number[]} EMA series, same length as input (NaN for early values)
 */
function ema(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const k = 2 / (period + 1);
  const result = new Array(values.length).fill(NaN);

  // Seed with SMA of first `period` values
  let sum = 0;
  let i;
  for (i = 0; i < period && i < values.length; i++) {
    sum += values[i];
  }
  if (i < period) return result; // not enough data

  result[period - 1] = sum / period;

  for (let j = period; j < values.length; j++) {
    result[j] = values[j] * k + result[j - 1] * (1 - k);
  }

  return result;
}

/**
 * Compute the Simple Moving Average (SMA) for a given period.
 *
 * @param {number[]} values - Series of values, oldest-first
 * @param {number} period
 * @returns {number[]} SMA series, same length as input (NaN for early values)
 */
function sma(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const result = new Array(values.length).fill(NaN);

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j];
    }
    result[i] = sum / period;
  }

  return result;
}

/**
 * Return the last non-NaN value from a series, or null.
 *
 * @param {number[]} series
 * @returns {number|null}
 */
function lastValue(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (!isNaN(series[i])) return series[i];
  }
  return null;
}

/**
 * Compute multiple EMA periods at once.
 *
 * @param {number[]} closes - Close prices, oldest-first
 * @param {number[]} periods - Array of periods (e.g. [20, 50, 100, 200])
 * @returns {Object.<number, number[]>} Map of period → EMA series
 */
function multiEma(closes, periods) {
  const result = {};
  for (const p of periods) {
    result[p] = ema(closes, p);
  }
  return result;
}

/**
 * Compute multiple SMA periods at once.
 *
 * @param {number[]} closes - Close prices, oldest-first
 * @param {number[]} periods - Array of periods
 * @returns {Object.<number, number[]>} Map of period → SMA series
 */
function multiSma(closes, periods) {
  const result = {};
  for (const p of periods) {
    result[p] = sma(closes, p);
  }
  return result;
}

module.exports = { ema, sma, lastValue, multiEma, multiSma };
