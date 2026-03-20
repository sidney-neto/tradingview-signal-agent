'use strict';

/**
 * Head and Shoulders (OCO) and Inverse Head and Shoulders (OCO Invertido) detection.
 *
 * Algorithm (H&S bearish):
 *   1. Scan recent pivot highs for triplets (LS, Head, RS)
 *   2. Head must be higher than both shoulders
 *   3. Shoulders must be within 1.5×ATR of each other (symmetry)
 *   4. Head must rise at least 1×ATR above the neckline
 *   5. Neckline connects the two valleys between LS-Head and Head-RS
 *   6. Status reflects price position relative to neckline
 *
 * For Inverse H&S (bullish): same logic mirrored on pivot lows.
 */

const { findLowest, findHighest, slope2pts } = require('./geometry');
const { scoreSymmetry, scoreBreakoutProximity, volumeBonus, weightedScore, qualityToConfidence } = require('./scoring');
const { makePattern, PATTERN_TYPES, BIAS, STATUS } = require('./normalize');

// Maximum shoulders-to-head distance in bars (pattern must fit in a window)
const MAX_PATTERN_BARS = 120;
// Minimum number of bars between each pivot (prevents tiny wiggles)
const MIN_PIVOT_SPACING = 4;

/**
 * Detect Head and Shoulders (bearish reversal).
 *
 * @param {Array} candles         - Full OHLCV array (oldest first)
 * @param {Array} pivotHighs      - From detectPivots, sorted by index ascending
 * @param {number} atrValue       - Current ATR
 * @param {number} avgVol         - Average volume (20-bar)
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectHeadAndShoulders(candles, pivotHighs, atrValue, avgVol, timeframe) {
  if (pivotHighs.length < 3) return null;

  const phs = pivotHighs.slice(-10); // last 10 pivot highs
  const n   = phs.length;
  const lastIdx = candles.length - 1;
  const currentPrice = candles[lastIdx].close;

  for (let i = n - 3; i >= 0; i--) {
    const ls   = phs[i];
    const head = phs[i + 1];
    const rs   = phs[i + 2];

    // Minimum spacing between pivots
    if (head.index - ls.index < MIN_PIVOT_SPACING) continue;
    if (rs.index  - head.index < MIN_PIVOT_SPACING) continue;

    // Total pattern must fit within MAX_PATTERN_BARS
    if (rs.index - ls.index > MAX_PATTERN_BARS) continue;

    // Head must be the highest of the three
    if (!(head.price > ls.price && head.price > rs.price)) continue;

    // Shoulder symmetry: within 1.5×ATR
    if (Math.abs(ls.price - rs.price) > 1.5 * atrValue) continue;

    // Find valleys between LS↔Head and Head↔RS
    const leftValley  = findLowest(candles, ls.index, head.index);
    const rightValley = findLowest(candles, head.index, rs.index);
    if (!leftValley || !rightValley) continue;

    // Neckline: line through the two valleys
    const neckSlope     = slope2pts(leftValley.index, leftValley.price, rightValley.index, rightValley.price);
    const neckIntercept = leftValley.price - neckSlope * leftValley.index;
    const neckAtCurrent = neckSlope * lastIdx + neckIntercept;

    // Head must clear neckline by at least 1×ATR (otherwise it's noise)
    const headNeckLevel = neckSlope * head.index + neckIntercept;
    if (head.price - headNeckLevel < atrValue) continue;

    // Determine status
    const neckAtRS = neckSlope * rs.index + neckIntercept;
    let status;
    if (currentPrice < neckAtCurrent - 0.1 * atrValue) {
      status = STATUS.CONFIRMED;
    } else if (currentPrice <= neckAtCurrent + 0.8 * atrValue) {
      status = STATUS.NEAR_BREAKOUT;
    } else {
      status = STATUS.FORMING;
    }

    // Invalidated if price pushes meaningfully above the right shoulder
    if (currentPrice > rs.price + 0.5 * atrValue) continue;

    // Score components
    const symScore  = scoreSymmetry(ls.price, rs.price, atrValue);
    const proxScore = scoreBreakoutProximity(currentPrice, neckAtCurrent, atrValue);
    const volDelta  = volumeBonus(candles[lastIdx].volume, avgVol);

    const quality = weightedScore([
      { score: symScore,            weight: 3 },
      { score: proxScore,           weight: 2 },
      { score: Math.min(1, (head.price - headNeckLevel) / (3 * atrValue)), weight: 2 }, // head prominence
    ]) + volDelta;

    if (quality < 0.30) continue; // reject low-quality patterns

    const confidence = qualityToConfidence(quality);

    return makePattern({
      type:             PATTERN_TYPES.HEAD_AND_SHOULDERS,
      bias:             BIAS.BEARISH,
      status,
      confidence,
      quality,
      timeframe,
      startIndex:       ls.index,
      endIndex:         rs.index,
      keyLevels: {
        leftShoulder:  ls.price,
        head:          head.price,
        rightShoulder: rs.price,
        necklineLeft:  leftValley.price,
        necklineRight: rightValley.price,
        necklineCurrent: +neckAtCurrent.toFixed(8),
      },
      breakoutLevel:     +neckAtCurrent.toFixed(8),
      invalidationLevel: +(rs.price + 0.5 * atrValue).toFixed(8),
      explanation:
        `OCO detectado: ombro esquerdo $${ls.price.toFixed(4)}, cabeça $${head.price.toFixed(4)}, ` +
        `ombro direito $${rs.price.toFixed(4)}. ` +
        `Neckline atual em $${neckAtCurrent.toFixed(4)}. ` +
        `${status === STATUS.CONFIRMED ? 'Rompimento confirmado.' : status === STATUS.NEAR_BREAKOUT ? 'Preço próximo ao rompimento.' : 'Padrão em formação.'}`,
    });
  }

  return null;
}

/**
 * Detect Inverse Head and Shoulders (bullish reversal).
 *
 * Mirror logic of detectHeadAndShoulders, using pivot lows.
 *
 * @param {Array} candles
 * @param {Array} pivotLows
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectInverseHeadAndShoulders(candles, pivotLows, atrValue, avgVol, timeframe) {
  if (pivotLows.length < 3) return null;

  const pls = pivotLows.slice(-10);
  const n   = pls.length;
  const lastIdx = candles.length - 1;
  const currentPrice = candles[lastIdx].close;

  for (let i = n - 3; i >= 0; i--) {
    const ls   = pls[i];
    const head = pls[i + 1]; // head is the LOWEST of the three
    const rs   = pls[i + 2];

    if (head.index - ls.index < MIN_PIVOT_SPACING) continue;
    if (rs.index  - head.index < MIN_PIVOT_SPACING) continue;
    if (rs.index - ls.index > MAX_PATTERN_BARS) continue;

    // Head must be the lowest
    if (!(head.price < ls.price && head.price < rs.price)) continue;

    // Shoulder symmetry: within 1.5×ATR
    if (Math.abs(ls.price - rs.price) > 1.5 * atrValue) continue;

    // Find peaks between LS↔Head and Head↔RS
    const leftPeak  = findHighest(candles, ls.index, head.index);
    const rightPeak = findHighest(candles, head.index, rs.index);
    if (!leftPeak || !rightPeak) continue;

    // Neckline: line through the two peaks
    const neckSlope     = slope2pts(leftPeak.index, leftPeak.price, rightPeak.index, rightPeak.price);
    const neckIntercept = leftPeak.price - neckSlope * leftPeak.index;
    const neckAtCurrent = neckSlope * lastIdx + neckIntercept;

    // Head must be at least 1×ATR below neckline
    const headNeckLevel = neckSlope * head.index + neckIntercept;
    if (headNeckLevel - head.price < atrValue) continue;

    let status;
    if (currentPrice > neckAtCurrent + 0.1 * atrValue) {
      status = STATUS.CONFIRMED;
    } else if (currentPrice >= neckAtCurrent - 0.8 * atrValue) {
      status = STATUS.NEAR_BREAKOUT;
    } else {
      status = STATUS.FORMING;
    }

    // Invalidated if price breaks below right shoulder
    if (currentPrice < rs.price - 0.5 * atrValue) continue;

    const symScore  = scoreSymmetry(ls.price, rs.price, atrValue);
    const proxScore = scoreBreakoutProximity(currentPrice, neckAtCurrent, atrValue);
    const volDelta  = volumeBonus(candles[lastIdx].volume, avgVol);

    const quality = weightedScore([
      { score: symScore,  weight: 3 },
      { score: proxScore, weight: 2 },
      { score: Math.min(1, (headNeckLevel - head.price) / (3 * atrValue)), weight: 2 },
    ]) + volDelta;

    if (quality < 0.30) continue;

    const confidence = qualityToConfidence(quality);

    return makePattern({
      type:             PATTERN_TYPES.INV_HEAD_AND_SHOULDERS,
      bias:             BIAS.BULLISH,
      status,
      confidence,
      quality,
      timeframe,
      startIndex:       ls.index,
      endIndex:         rs.index,
      keyLevels: {
        leftShoulder:    ls.price,
        head:            head.price,
        rightShoulder:   rs.price,
        necklineLeft:    leftPeak.price,
        necklineRight:   rightPeak.price,
        necklineCurrent: +neckAtCurrent.toFixed(8),
      },
      breakoutLevel:     +neckAtCurrent.toFixed(8),
      invalidationLevel: +(rs.price - 0.5 * atrValue).toFixed(8),
      explanation:
        `OCO Invertido detectado: ombro esquerdo $${ls.price.toFixed(4)}, cabeça $${head.price.toFixed(4)}, ` +
        `ombro direito $${rs.price.toFixed(4)}. ` +
        `Neckline atual em $${neckAtCurrent.toFixed(4)}. ` +
        `${status === STATUS.CONFIRMED ? 'Rompimento confirmado.' : status === STATUS.NEAR_BREAKOUT ? 'Preço próximo ao rompimento.' : 'Padrão em formação.'}`,
    });
  }

  return null;
}

module.exports = { detectHeadAndShoulders, detectInverseHeadAndShoulders };
