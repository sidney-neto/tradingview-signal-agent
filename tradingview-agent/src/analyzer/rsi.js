'use strict';

/**
 * RSI (Relative Strength Index) calculation.
 *
 * Uses Wilder's smoothing (equivalent to EMA with alpha = 1/period).
 * Returns a series the same length as the input close array.
 * Early values (before sufficient history) are NaN.
 */

/**
 * Compute RSI for a given period.
 *
 * @param {number[]} closes - Close prices, oldest-first
 * @param {number} [period=14]
 * @returns {number[]} RSI series (0–100), same length as input
 */
function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) {
    return new Array(closes ? closes.length : 0).fill(NaN);
  }

  const result = new Array(closes.length).fill(NaN);

  // Calculate initial average gain/loss over first `period` changes
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else            avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  result[period] = firstRsi;

  // Wilder smoothing for subsequent values
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain   = change > 0 ? change : 0;
    const loss   = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

/**
 * Classify RSI into a momentum label.
 *
 * @param {number} rsiValue
 * @returns {string}
 */
function classifyRsi(rsiValue) {
  if (isNaN(rsiValue) || rsiValue == null) return 'unknown';
  if (rsiValue >= 80) return 'overbought_extreme';
  if (rsiValue >= 70) return 'overbought';
  if (rsiValue >= 60) return 'bullish';
  if (rsiValue >= 45) return 'neutral';
  if (rsiValue >= 35) return 'bearish';
  if (rsiValue >= 25) return 'oversold';
  return 'oversold_extreme';
}

module.exports = { rsi, classifyRsi };
