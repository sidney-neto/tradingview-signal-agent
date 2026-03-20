'use strict';

/**
 * Triangle pattern detection: Ascending, Descending, Symmetrical.
 *
 * Algorithm (common foundation):
 *   1. Fit a resistance line through recent pivot highs
 *   2. Fit a support line through recent pivot lows
 *   3. Classify the triangle by slope combination:
 *      - Ascending:   resistance flat/slightly falling, support rising
 *      - Descending:  resistance falling, support flat/slightly rising
 *      - Symmetrical: resistance falling, support rising (converging)
 *   4. Lines must converge (apex in the future, within reasonable bars)
 *   5. Current price must be inside the triangle (not already broken out)
 *   6. Require at least 3 pivots on each side for a reliable fit
 *
 * Tolerances are ATR-relative to work across all timeframes.
 */

const {
  fitLine, lineAt, lineIntersectX,
  isFlat, isRising, isFalling,
} = require('./geometry');
const {
  countTouches, scoreBreakoutProximity,
  volumeBonus, weightedScore, qualityToConfidence, scoreTouchCount,
} = require('./scoring');
const { makePattern, PATTERN_TYPES, BIAS, STATUS } = require('./normalize');

// Require at least this many pivots on each side for a triangle fit
const MIN_PIVOTS = 3;
// Apex must be between 2 and 80 bars in the future
const MIN_APEX_BARS = 2;
const MAX_APEX_BARS = 80;

/**
 * Core triangle detection engine.
 * Returns a pattern object or null.
 *
 * @param {string} type         - One of PATTERN_TYPES.*_TRIANGLE
 * @param {string} bias
 * @param {Array} candles
 * @param {Array} pivotHighs
 * @param {Array} pivotLows
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @param {Function} slopeCheck - ({ resSlope, supSlope, atr }) => boolean
 * @param {string} explanationTemplate - PT-BR explanation base
 * @returns {object|null}
 */
function detectTriangle(type, bias, candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe, slopeCheck, explanationTemplate) {
  // Use last N pivots from recent window
  const recentHighs = pivotHighs.slice(-8);
  const recentLows  = pivotLows.slice(-8);

  if (recentHighs.length < MIN_PIVOTS || recentLows.length < MIN_PIVOTS) return null;

  const lastIdx = candles.length - 1;
  const current = candles[lastIdx].close;

  // Fit resistance line through pivot highs
  const resPoints = recentHighs.map((p) => ({ x: p.index, y: p.price }));
  const resLine   = fitLine(resPoints);

  // Fit support line through pivot lows
  const supPoints = recentLows.map((p) => ({ x: p.index, y: p.price }));
  const supLine   = fitLine(supPoints);

  // Check slope combination for this triangle type
  if (!slopeCheck({ resSlope: resLine.slope, supSlope: supLine.slope, atr: atrValue })) return null;

  // Lines must converge (resistance slope < support slope so they meet in the future)
  if (resLine.slope >= supLine.slope) return null;

  // Find apex (x where lines meet)
  const apexX = lineIntersectX(resLine, supLine);
  if (apexX === null) return null;

  const barsToApex = apexX - lastIdx;
  if (barsToApex < MIN_APEX_BARS || barsToApex > MAX_APEX_BARS) return null;

  // Current price must be inside the triangle
  const resAtCurrent = lineAt(resLine, lastIdx);
  const supAtCurrent = lineAt(supLine, lastIdx);

  if (current >= resAtCurrent + 0.5 * atrValue) return null; // above resistance
  if (current <= supAtCurrent - 0.5 * atrValue) return null; // below support

  // Breakout level = resistance at current bar
  const breakoutLevel     = resAtCurrent;
  const breakdownLevel    = supAtCurrent;
  const invalidationLevel = bias === BIAS.BULLISH ? breakdownLevel : breakoutLevel;

  // Status: near_breakout if within 1×ATR of the key boundary
  const distToBreakout = bias === BIAS.BEARISH
    ? Math.abs(current - breakdownLevel)
    : Math.abs(current - breakoutLevel);

  let status;
  if (distToBreakout < 0.3 * atrValue) {
    status = STATUS.NEAR_BREAKOUT;
  } else {
    status = STATUS.FORMING;
  }

  // Score quality
  const resTouches = countTouches(recentHighs, resLine, atrValue, 0.6);
  const supTouches = countTouches(recentLows,  supLine, atrValue, 0.6);
  const proxScore  = scoreBreakoutProximity(current, bias === BIAS.BULLISH ? breakoutLevel : breakdownLevel, atrValue);
  const volDelta   = volumeBonus(candles[lastIdx].volume, avgVol);

  const quality = weightedScore([
    { score: scoreTouchCount(resTouches), weight: 2 },
    { score: scoreTouchCount(supTouches), weight: 2 },
    { score: proxScore,                   weight: 1 },
    { score: Math.max(0, 1 - barsToApex / MAX_APEX_BARS), weight: 1 }, // closer to apex = better
  ]) + volDelta;

  if (quality < 0.30) return null;

  // Determine earliest relevant start index
  const startIndex = Math.min(recentHighs[0].index, recentLows[0].index);

  return makePattern({
    type,
    bias,
    status,
    confidence: qualityToConfidence(quality),
    quality,
    timeframe,
    startIndex,
    endIndex: lastIdx,
    keyLevels: {
      resistance: +resAtCurrent.toFixed(8),
      support:    +supAtCurrent.toFixed(8),
      apexBarsAhead: Math.round(barsToApex),
    },
    breakoutLevel:     +breakoutLevel.toFixed(8),
    invalidationLevel: +invalidationLevel.toFixed(8),
    explanation: explanationTemplate
      .replace('{{res}}', resAtCurrent.toFixed(4))
      .replace('{{sup}}', supAtCurrent.toFixed(4))
      .replace('{{apex}}', Math.round(barsToApex))
      .replace('{{status}}', status === STATUS.NEAR_BREAKOUT ? 'próximo ao rompimento' : 'em formação'),
  });
}

/**
 * Ascending Triangle — flat/descending resistance, rising support (bullish bias).
 */
function detectAscendingTriangle(candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe) {
  return detectTriangle(
    PATTERN_TYPES.ASCENDING_TRIANGLE,
    BIAS.BULLISH,
    candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe,
    ({ resSlope, supSlope, atr }) =>
      // Resistance roughly flat or slightly falling, support meaningfully rising
      isFlat(resSlope, atr, 0.08) && isRising(supSlope, atr, 0.01),
    'Triângulo Ascendente: resistência em ${{res}}, suporte em alta em ${{sup}}. ' +
    'Apex em ~{{apex}} barras. Padrão {{status}}.',
  );
}

/**
 * Descending Triangle — falling resistance, flat/slightly-rising support (bearish bias).
 */
function detectDescendingTriangle(candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe) {
  return detectTriangle(
    PATTERN_TYPES.DESCENDING_TRIANGLE,
    BIAS.BEARISH,
    candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe,
    ({ resSlope, supSlope, atr }) =>
      // Resistance meaningfully falling, support roughly flat or slightly rising
      isFalling(resSlope, atr, 0.01) && isFlat(supSlope, atr, 0.08),
    'Triângulo Descendente: resistência em queda ${{res}}, suporte em ${{sup}}. ' +
    'Apex em ~{{apex}} barras. Padrão {{status}}.',
  );
}

/**
 * Symmetrical Triangle — resistance falling, support rising (neutral, breakout direction unknown).
 */
function detectSymmetricalTriangle(candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe) {
  return detectTriangle(
    PATTERN_TYPES.SYMMETRICAL_TRIANGLE,
    BIAS.NEUTRAL,
    candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe,
    ({ resSlope, supSlope, atr }) =>
      // Both lines clearly sloped toward each other
      isFalling(resSlope, atr, 0.01) && isRising(supSlope, atr, 0.01),
    'Triângulo Simétrico: resistência ${{res}}, suporte ${{sup}}. ' +
    'Apex em ~{{apex}} barras. Rompimento pendente, padrão {{status}}.',
  );
}

module.exports = {
  detectAscendingTriangle,
  detectDescendingTriangle,
  detectSymmetricalTriangle,
};
