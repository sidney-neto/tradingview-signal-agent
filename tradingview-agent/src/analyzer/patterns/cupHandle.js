'use strict';

/**
 * Cup and Handle (Xícara e Alça) detection.
 *
 * This is a conservative implementation — the pattern is easy to over-detect,
 * so several strict conditions are required.
 *
 * Cup requirements:
 *   1. A prior rim (local peak) at the start of the cup
 *   2. Price drops at least CUP_MIN_DEPTH_ATR × ATR from rim
 *   3. Price recovers to within CUP_RIM_TOLERANCE_ATR × ATR of the rim level
 *   4. The base of the cup should be somewhat rounded (not a V-shape)
 *      — approximated by checking that the average of the lower half of the cup
 *        is less than 70% above the cup bottom
 *   5. Cup width: CUP_MIN_BARS to CUP_MAX_BARS
 *
 * Handle requirements:
 *   1. A small pullback after recovering to rim level
 *   2. Handle depth ≤ HANDLE_MAX_RETRACEMENT of cup depth
 *   3. Handle width: HANDLE_MIN_BARS to HANDLE_MAX_BARS
 *   4. Handle must not drop below the midpoint of the cup
 *
 * Status: near_breakout when price approaches the rim level again.
 */

const { findLowest, avgClose, priceRange } = require('./geometry');
const { scoreBreakoutProximity, volumeBonus, weightedScore, qualityToConfidence } = require('./scoring');
const { makePattern, PATTERN_TYPES, BIAS, STATUS } = require('./normalize');

const CUP_MIN_BARS              = 20;
const CUP_MAX_BARS              = 150;
const CUP_MIN_DEPTH_ATR         = 2.5;  // cup bottom must be at least 2.5×ATR below rim
const CUP_RIM_TOLERANCE_ATR     = 1.5;  // right rim must recover within 1.5×ATR of left rim
const HANDLE_MIN_BARS           = 3;
const HANDLE_MAX_BARS           = 25;
const HANDLE_MAX_RETRACEMENT    = 0.55; // handle retraces at most 55% of cup depth

/**
 * Detect Cup and Handle (bullish continuation).
 *
 * @param {Array} candles
 * @param {Array} pivotHighs
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectCupAndHandle(candles, pivotHighs, atrValue, avgVol, timeframe) {
  if (pivotHighs.length < 2) return null;

  const n       = candles.length;
  const lastIdx = n - 1;
  const current = candles[lastIdx].close;

  // Try recent pivot highs as the left rim
  const recentPivots = pivotHighs.slice(-6);

  for (let rimIdx = recentPivots.length - 1; rimIdx >= 0; rimIdx--) {
    const leftRim = recentPivots[rimIdx];

    // Cup start must leave enough room for cup + handle
    const cupEndLatest = lastIdx - HANDLE_MIN_BARS;
    if (cupEndLatest - leftRim.index < CUP_MIN_BARS) continue;
    if (lastIdx - leftRim.index > CUP_MAX_BARS + HANDLE_MAX_BARS) continue;

    // Find the bottom of the cup (lowest point after left rim)
    const cupBottom = findLowest(candles, leftRim.index, cupEndLatest);
    if (!cupBottom) continue;

    const cupDepth = leftRim.price - cupBottom.price;

    // Cup must have meaningful depth
    if (cupDepth < CUP_MIN_DEPTH_ATR * atrValue) continue;

    // Scan for the right rim: a recovery back to near the left rim level
    // The right rim is somewhere between cupBottom and the handle start
    let rightRimIdx = -1;
    let rightRimPrice = -Infinity;

    for (let i = cupBottom.index + 2; i <= lastIdx - HANDLE_MIN_BARS; i++) {
      const h = candles[i].high;
      // Must recover close to left rim (within CUP_RIM_TOLERANCE_ATR)
      if (Math.abs(h - leftRim.price) <= CUP_RIM_TOLERANCE_ATR * atrValue && h > rightRimPrice) {
        rightRimPrice = h;
        rightRimIdx   = i;
      }
    }

    if (rightRimIdx < 0) continue;

    // Cup width check
    const cupWidth = rightRimIdx - leftRim.index;
    if (cupWidth < CUP_MIN_BARS || cupWidth > CUP_MAX_BARS) continue;

    // Roundedness check: the average close in the lower 50% of the cup should
    // be reasonably low (prevents V-shapes)
    const cupMid  = (leftRim.price + cupBottom.price) / 2;
    const baseAvg = avgClose(candles, cupBottom.index - Math.floor(cupWidth * 0.15), cupBottom.index + Math.floor(cupWidth * 0.15));
    if (baseAvg > cupMid) continue; // too V-shaped — not rounded enough

    // Handle: candles from rightRimIdx+1 to current
    const handleStart = rightRimIdx + 1;
    const handleLen   = lastIdx - handleStart + 1;
    if (handleLen < HANDLE_MIN_BARS || handleLen > HANDLE_MAX_BARS) continue;

    const handleRange = priceRange(candles, handleStart, lastIdx);

    // Handle must not drop below the cup midpoint
    if (handleRange.low < cupMid) continue;

    // Handle retracement
    const handleDrop = rightRimPrice - handleRange.low;
    if (handleDrop > HANDLE_MAX_RETRACEMENT * cupDepth) continue;

    // Breakout: handle resistance (right rim price)
    const breakoutLevel = rightRimPrice;

    let status;
    if (current > breakoutLevel + 0.1 * atrValue) {
      status = STATUS.CONFIRMED;
    } else if (current > breakoutLevel - 0.8 * atrValue) {
      status = STATUS.NEAR_BREAKOUT;
    } else {
      status = STATUS.FORMING;
    }

    // Invalidation: price drops below handle low
    const invalidationLevel = handleRange.low - 0.3 * atrValue;
    if (current < invalidationLevel) continue;

    const proxScore   = scoreBreakoutProximity(current, breakoutLevel, atrValue);
    const depthScore  = Math.min(1, cupDepth / (6 * atrValue));
    const roundScore  = Math.max(0, 1 - (baseAvg - cupBottom.price) / (cupMid - cupBottom.price));
    const volDelta    = volumeBonus(candles[lastIdx].volume, avgVol);

    const quality = weightedScore([
      { score: proxScore,  weight: 2 },
      { score: depthScore, weight: 2 },
      { score: roundScore, weight: 2 },
    ]) + volDelta;

    if (quality < 0.28) continue;

    return makePattern({
      type:       PATTERN_TYPES.CUP_AND_HANDLE,
      bias:       BIAS.BULLISH,
      status,
      confidence: qualityToConfidence(quality),
      quality,
      timeframe,
      startIndex: leftRim.index,
      endIndex:   lastIdx,
      keyLevels: {
        leftRim:     leftRim.price,
        cupBottom:   cupBottom.price,
        rightRim:    rightRimPrice,
        handleLow:   handleRange.low,
        cupDepth,
      },
      breakoutLevel:     +breakoutLevel.toFixed(8),
      invalidationLevel: +invalidationLevel.toFixed(8),
      explanation:
        `Xícara e Alça: borda esquerda $${leftRim.price.toFixed(4)}, ` +
        `fundo $${cupBottom.price.toFixed(4)} (profundidade ${cupDepth.toFixed(4)}), ` +
        `borda direita $${rightRimPrice.toFixed(4)}. ` +
        `Alça mínima $${handleRange.low.toFixed(4)}. ` +
        `Rompimento esperado acima de $${breakoutLevel.toFixed(4)}. ` +
        `${status === STATUS.CONFIRMED ? 'Rompimento confirmado.' : status === STATUS.NEAR_BREAKOUT ? 'Próximo ao rompimento.' : 'Em formação.'}`,
    });
  }

  return null;
}

module.exports = { detectCupAndHandle };
