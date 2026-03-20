'use strict';

/**
 * Rising Wedge and Falling Wedge detection.
 *
 * Both wedges are formed by two converging trendlines that slope in the
 * same direction — unlike triangles where one line is flat.
 *
 * Rising Wedge (bearish reversal):
 *   - Both resistance and support lines slope UPWARD
 *   - Resistance slope < support slope (lines converge → wedge narrows)
 *   - Price squeezing toward apex while both lines rise
 *   - Bearish: exhaustion of upward move, expected to break downward
 *
 * Falling Wedge (bullish reversal):
 *   - Both resistance and support lines slope DOWNWARD
 *   - Support slope > resistance slope in absolute terms (lines converge)
 *   - Price squeezing toward apex while both lines fall
 *   - Bullish: compression before upward breakout
 *
 * Distinguishing wedges from triangles:
 *   - Triangle: one line is flat, the other is sloped
 *   - Wedge: BOTH lines are sloped in the SAME direction
 */

const { fitLine, lineAt, lineIntersectX, isRising, isFalling } = require('./geometry');
const { countTouches, scoreBreakoutProximity, volumeBonus, weightedScore, qualityToConfidence, scoreTouchCount } = require('./scoring');
const { makePattern, PATTERN_TYPES, BIAS, STATUS } = require('./normalize');

const MIN_PIVOTS      = 3;
const MIN_APEX_BARS   = 2;
const MAX_APEX_BARS   = 80;
// Both lines must be sloped in the same direction with at least this fraction of ATR per bar
const MIN_SLOPE_FRACTION = 0.005;

/**
 * Detect Rising Wedge (bearish bias).
 *
 * @param {Array} candles
 * @param {Array} pivotHighs
 * @param {Array} pivotLows
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectRisingWedge(candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe) {
  const recentHighs = pivotHighs.slice(-8);
  const recentLows  = pivotLows.slice(-8);

  if (recentHighs.length < MIN_PIVOTS || recentLows.length < MIN_PIVOTS) return null;

  const lastIdx = candles.length - 1;
  const current = candles[lastIdx].close;

  const resLine = fitLine(recentHighs.map((p) => ({ x: p.index, y: p.price })));
  const supLine = fitLine(recentLows.map((p)  => ({ x: p.index, y: p.price })));

  // Both lines must be rising
  if (!isRising(resLine.slope, atrValue, MIN_SLOPE_FRACTION)) return null;
  if (!isRising(supLine.slope, atrValue, MIN_SLOPE_FRACTION)) return null;

  // Lines must converge (resistance slope < support slope means they meet)
  if (resLine.slope >= supLine.slope) return null;

  // Apex must be in a reasonable future window
  const apexX = lineIntersectX(resLine, supLine);
  if (apexX === null) return null;
  const barsToApex = apexX - lastIdx;
  if (barsToApex < MIN_APEX_BARS || barsToApex > MAX_APEX_BARS) return null;

  // Current price must be inside the wedge
  const resAtCurrent = lineAt(resLine, lastIdx);
  const supAtCurrent = lineAt(supLine, lastIdx);
  if (current >= resAtCurrent + 0.5 * atrValue) return null;
  if (current <= supAtCurrent - 0.5 * atrValue) return null;

  // Status: near_breakout if close to support (imminent downward break)
  let status;
  const distToSupport = current - supAtCurrent;
  if (distToSupport < 0 && Math.abs(distToSupport) > 0.1 * atrValue) {
    status = STATUS.CONFIRMED; // broke below support
  } else if (distToSupport < 0.5 * atrValue) {
    status = STATUS.NEAR_BREAKOUT;
  } else {
    status = STATUS.FORMING;
  }

  const resTouches = countTouches(recentHighs, resLine, atrValue, 0.6);
  const supTouches = countTouches(recentLows,  supLine, atrValue, 0.6);
  const proxScore  = scoreBreakoutProximity(current, supAtCurrent, atrValue);
  const volDelta   = volumeBonus(candles[lastIdx].volume, avgVol);

  const quality = weightedScore([
    { score: scoreTouchCount(resTouches), weight: 2 },
    { score: scoreTouchCount(supTouches), weight: 2 },
    { score: proxScore,                   weight: 1 },
    { score: Math.max(0, 1 - barsToApex / MAX_APEX_BARS), weight: 1 },
  ]) + volDelta;

  if (quality < 0.28) return null;

  const startIndex = Math.min(recentHighs[0].index, recentLows[0].index);

  return makePattern({
    type:             PATTERN_TYPES.RISING_WEDGE,
    bias:             BIAS.BEARISH,
    status,
    confidence:       qualityToConfidence(quality),
    quality,
    timeframe,
    startIndex,
    endIndex:         lastIdx,
    keyLevels: {
      resistance:    +resAtCurrent.toFixed(8),
      support:       +supAtCurrent.toFixed(8),
      apexBarsAhead: Math.round(barsToApex),
    },
    breakoutLevel:     +supAtCurrent.toFixed(8),
    invalidationLevel: +resAtCurrent.toFixed(8),
    explanation:
      `Cunha Ascendente (bearish): ambas as linhas sobem, convergindo. ` +
      `Resistência $${resAtCurrent.toFixed(4)}, suporte $${supAtCurrent.toFixed(4)}. ` +
      `Apex em ~${Math.round(barsToApex)} barras. ` +
      `Rompimento esperado abaixo do suporte $${supAtCurrent.toFixed(4)}. ` +
      `Padrão ${status === STATUS.NEAR_BREAKOUT ? 'próximo ao rompimento' : 'em formação'}.`,
  });
}

/**
 * Detect Falling Wedge (bullish bias).
 *
 * @param {Array} candles
 * @param {Array} pivotHighs
 * @param {Array} pivotLows
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectFallingWedge(candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe) {
  const recentHighs = pivotHighs.slice(-8);
  const recentLows  = pivotLows.slice(-8);

  if (recentHighs.length < MIN_PIVOTS || recentLows.length < MIN_PIVOTS) return null;

  const lastIdx = candles.length - 1;
  const current = candles[lastIdx].close;

  const resLine = fitLine(recentHighs.map((p) => ({ x: p.index, y: p.price })));
  const supLine = fitLine(recentLows.map((p)  => ({ x: p.index, y: p.price })));

  // Both lines must be falling
  if (!isFalling(resLine.slope, atrValue, MIN_SLOPE_FRACTION)) return null;
  if (!isFalling(supLine.slope, atrValue, MIN_SLOPE_FRACTION)) return null;

  // Lines converge: support slope > resistance slope (support falls less steeply)
  if (resLine.slope <= supLine.slope) return null;

  // Apex in reasonable future
  const apexX = lineIntersectX(resLine, supLine);
  if (apexX === null) return null;
  const barsToApex = apexX - lastIdx;
  if (barsToApex < MIN_APEX_BARS || barsToApex > MAX_APEX_BARS) return null;

  const resAtCurrent = lineAt(resLine, lastIdx);
  const supAtCurrent = lineAt(supLine, lastIdx);
  if (current >= resAtCurrent + 0.5 * atrValue) return null;
  if (current <= supAtCurrent - 0.5 * atrValue) return null;

  // Status: near_breakout if close to resistance (imminent upward break)
  let status;
  const distToRes = resAtCurrent - current;
  if (distToRes < 0 && Math.abs(distToRes) > 0.1 * atrValue) {
    status = STATUS.CONFIRMED;
  } else if (distToRes < 0.5 * atrValue) {
    status = STATUS.NEAR_BREAKOUT;
  } else {
    status = STATUS.FORMING;
  }

  const resTouches = countTouches(recentHighs, resLine, atrValue, 0.6);
  const supTouches = countTouches(recentLows,  supLine, atrValue, 0.6);
  const proxScore  = scoreBreakoutProximity(current, resAtCurrent, atrValue);
  const volDelta   = volumeBonus(candles[lastIdx].volume, avgVol);

  const quality = weightedScore([
    { score: scoreTouchCount(resTouches), weight: 2 },
    { score: scoreTouchCount(supTouches), weight: 2 },
    { score: proxScore,                   weight: 1 },
    { score: Math.max(0, 1 - barsToApex / MAX_APEX_BARS), weight: 1 },
  ]) + volDelta;

  if (quality < 0.28) return null;

  const startIndex = Math.min(recentHighs[0].index, recentLows[0].index);

  return makePattern({
    type:             PATTERN_TYPES.FALLING_WEDGE,
    bias:             BIAS.BULLISH,
    status,
    confidence:       qualityToConfidence(quality),
    quality,
    timeframe,
    startIndex,
    endIndex:         lastIdx,
    keyLevels: {
      resistance:    +resAtCurrent.toFixed(8),
      support:       +supAtCurrent.toFixed(8),
      apexBarsAhead: Math.round(barsToApex),
    },
    breakoutLevel:     +resAtCurrent.toFixed(8),
    invalidationLevel: +supAtCurrent.toFixed(8),
    explanation:
      `Cunha Descendente (bullish): ambas as linhas caem, convergindo. ` +
      `Resistência $${resAtCurrent.toFixed(4)}, suporte $${supAtCurrent.toFixed(4)}. ` +
      `Apex em ~${Math.round(barsToApex)} barras. ` +
      `Rompimento esperado acima da resistência $${resAtCurrent.toFixed(4)}. ` +
      `Padrão ${status === STATUS.NEAR_BREAKOUT ? 'próximo ao rompimento' : 'em formação'}.`,
  });
}

module.exports = { detectRisingWedge, detectFallingWedge };
