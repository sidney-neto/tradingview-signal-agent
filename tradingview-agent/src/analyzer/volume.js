'use strict';

/**
 * Volume analysis helpers.
 */

/**
 * Compute a simple rolling average of volume over `period` bars.
 *
 * @param {Array<{ volume: number }>} candles - Oldest-first
 * @param {number} [period=20]
 * @returns {number[]} Average volume series, same length as input
 */
function avgVolume(candles, period = 20) {
  if (!Array.isArray(candles) || candles.length === 0) return [];

  const result = new Array(candles.length).fill(NaN);

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].volume || 0;
    }
    result[i] = sum / period;
  }

  return result;
}

/**
 * Classify current volume relative to its recent average.
 *
 * @param {number} currentVolume
 * @param {number} averageVolume
 * @returns {string}
 */
function classifyVolume(currentVolume, averageVolume) {
  if (isNaN(averageVolume) || averageVolume <= 0) return 'unknown';
  const ratio = currentVolume / averageVolume;
  if (ratio >= 3.0)  return 'very_high';
  if (ratio >= 1.5)  return 'high';
  if (ratio >= 0.75) return 'average';
  if (ratio >= 0.4)  return 'low';
  return 'very_low';
}

module.exports = { avgVolume, classifyVolume };
