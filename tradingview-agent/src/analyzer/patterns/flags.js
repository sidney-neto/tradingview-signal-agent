'use strict';

/**
 * Flag and Pennant detection (bullish and bearish variants).
 *
 * Both patterns require a "pole" — a rapid directional impulse — followed by
 * a smaller consolidation structure.
 *
 * Flag:    consolidation forms a parallel channel (slight counter-trend slope)
 * Pennant: consolidation forms a converging triangle (symmetric or slight bias)
 *
 * Pole requirements:
 *   - Minimum length: POLE_MIN_BARS bars
 *   - Minimum magnitude: POLE_MIN_ATR × ATR (ensures meaningful impulse)
 *   - Directional: the move covers a specific direction (up for bull, down for bear)
 *
 * Consolidation requirements:
 *   - Length: CONSOL_MIN_BARS to CONSOL_MAX_BARS
 *   - Range must be smaller than pole range (compression)
 *   - Flag: support and resistance lines have similar slope (parallel channel)
 *   - Pennant: lines converge (similar to symmetrical triangle)
 */

const { fitLine, lineAt, lineIntersectX, isRising, isFalling, priceRange } = require('./geometry');
const { scoreBreakoutProximity, volumeBonus, weightedScore, qualityToConfidence } = require('./scoring');
const { makePattern, PATTERN_TYPES, BIAS, STATUS } = require('./normalize');

const POLE_MIN_BARS   = 5;
const POLE_MAX_BARS   = 30;
const POLE_MIN_ATR    = 2.5;    // pole must be at least 2.5×ATR
const CONSOL_MIN_BARS = 5;
const CONSOL_MAX_BARS = 35;
const MAX_FLAG_RETRACEMENT = 0.70; // consolidation retraces at most 70% of pole

/**
 * Find the most recent significant impulse pole.
 *
 * Scans backwards through candles looking for a rapid directional move.
 * Returns { poleStart, poleEnd, direction } or null.
 *
 * @param {Array} candles
 * @param {number} atrValue
 * @param {'bull'|'bear'} direction
 * @returns {{ poleStart: number, poleEnd: number, poleMagnitude: number }|null}
 */
function findPole(candles, atrValue, direction) {
  const n = candles.length;

  // Search for the pole in the last CONSOL_MAX_BARS + POLE_MAX_BARS bars
  const searchFrom = Math.max(0, n - CONSOL_MAX_BARS - POLE_MAX_BARS - 1);

  for (let poleEnd = n - CONSOL_MIN_BARS - 1; poleEnd > searchFrom + POLE_MIN_BARS; poleEnd--) {
    for (let len = POLE_MIN_BARS; len <= POLE_MAX_BARS; len++) {
      const poleStart = poleEnd - len;
      if (poleStart < searchFrom) break;

      const startC = candles[poleStart];
      const endC   = candles[poleEnd];

      let magnitude;
      if (direction === 'bull') {
        magnitude = endC.high - startC.low;
        if (magnitude < POLE_MIN_ATR * atrValue) continue;
        // Confirm directional: end close clearly above start close
        if (endC.close - startC.close < POLE_MIN_ATR * 0.6 * atrValue) continue;
      } else {
        magnitude = startC.high - endC.low;
        if (magnitude < POLE_MIN_ATR * atrValue) continue;
        if (startC.close - endC.close < POLE_MIN_ATR * 0.6 * atrValue) continue;
      }

      return { poleStart, poleEnd, poleMagnitude: magnitude };
    }
  }
  return null;
}

/**
 * Detect Bull or Bear Flag.
 *
 * @param {'bull'|'bear'} direction
 * @param {Array} candles
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectFlag(direction, candles, atrValue, avgVol, timeframe) {
  const pole = findPole(candles, atrValue, direction);
  if (!pole) return null;

  const { poleStart, poleEnd, poleMagnitude } = pole;
  const n        = candles.length;
  const lastIdx  = n - 1;
  const current  = candles[lastIdx].close;

  // Consolidation is from poleEnd to current
  const consolStart = poleEnd + 1;
  const consolLen   = lastIdx - consolStart + 1;

  if (consolLen < CONSOL_MIN_BARS || consolLen > CONSOL_MAX_BARS) return null;

  // Consolidation range must be less than MAX_FLAG_RETRACEMENT × pole magnitude
  const consolRange = priceRange(candles, consolStart, lastIdx);
  if (consolRange.range > MAX_FLAG_RETRACEMENT * poleMagnitude) return null;

  // Fit resistance and support lines through the consolidation
  const consolCandles = candles.slice(consolStart, lastIdx + 1);
  const resPoints = consolCandles.map((c, i) => ({ x: consolStart + i, y: c.high }));
  const supPoints = consolCandles.map((c, i) => ({ x: consolStart + i, y: c.low  }));

  const resLine = fitLine(resPoints);
  const supLine = fitLine(supPoints);

  // Flag: lines should be roughly parallel (similar slopes, both counter-trend)
  const slopeDiff = Math.abs(resLine.slope - supLine.slope);
  if (slopeDiff > atrValue * 0.15) return null; // not parallel enough

  // Direction check: bull flag retraces downward, bear flag retraces upward
  if (direction === 'bull' && resLine.slope > atrValue * 0.05) return null; // should be flat or downward
  if (direction === 'bear' && resLine.slope < -atrValue * 0.05) return null; // should be flat or upward

  // Breakout level: resistance line at current bar (bull) or support (bear)
  const breakoutLevel = direction === 'bull'
    ? lineAt(resLine, lastIdx)
    : lineAt(supLine, lastIdx);

  let status;
  const distToBreak = Math.abs(current - breakoutLevel);
  if (distToBreak < 0.3 * atrValue) {
    status = STATUS.NEAR_BREAKOUT;
  } else if (
    (direction === 'bull' && current > breakoutLevel + 0.1 * atrValue) ||
    (direction === 'bear' && current < breakoutLevel - 0.1 * atrValue)
  ) {
    status = STATUS.CONFIRMED;
  } else {
    status = STATUS.FORMING;
  }

  const proxScore = scoreBreakoutProximity(current, breakoutLevel, atrValue);
  const poleScore = Math.min(1, poleMagnitude / (5 * atrValue)); // stronger pole = better
  const volDelta  = volumeBonus(candles[lastIdx].volume, avgVol);

  const quality = weightedScore([
    { score: poleScore,  weight: 3 },
    { score: proxScore,  weight: 2 },
    { score: Math.min(1, consolLen / CONSOL_MAX_BARS), weight: 1 },
  ]) + volDelta;

  if (quality < 0.28) return null;

  const type = direction === 'bull' ? PATTERN_TYPES.FLAG_BULL : PATTERN_TYPES.FLAG_BEAR;
  const bias = direction === 'bull' ? BIAS.BULLISH : BIAS.BEARISH;

  const poleHigh = direction === 'bull' ? candles[poleEnd].high  : candles[poleStart].high;
  const poleLow  = direction === 'bull' ? candles[poleStart].low : candles[poleEnd].low;

  return makePattern({
    type,
    bias,
    status,
    confidence: qualityToConfidence(quality),
    quality,
    timeframe,
    startIndex: poleStart,
    endIndex:   lastIdx,
    keyLevels: {
      poleTop:     poleHigh,
      poleBottom:  poleLow,
      poleMagnitude,
      channelTop:  +lineAt(resLine, lastIdx).toFixed(8),
      channelBot:  +lineAt(supLine, lastIdx).toFixed(8),
    },
    breakoutLevel:     +breakoutLevel.toFixed(8),
    invalidationLevel: direction === 'bull'
      ? +lineAt(supLine, lastIdx).toFixed(8)
      : +lineAt(resLine, lastIdx).toFixed(8),
    explanation:
      `Bandeira ${direction === 'bull' ? 'Altista' : 'Baixista'}: ` +
      `polo de ${poleMagnitude.toFixed(4)} (${Math.round(poleMagnitude / atrValue * 10) / 10}×ATR). ` +
      `Consolidação de ${consolLen} barras. Rompimento esperado em $${breakoutLevel.toFixed(4)}. ` +
      `${status === STATUS.CONFIRMED ? 'Rompimento confirmado.' : status === STATUS.NEAR_BREAKOUT ? 'Próximo ao rompimento.' : 'Em formação.'}`,
  });
}

/**
 * Detect Bull or Bear Pennant.
 *
 * Same as flag, but the consolidation has converging lines (triangle shape).
 *
 * @param {'bull'|'bear'} direction
 * @param {Array} candles
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectPennant(direction, candles, atrValue, avgVol, timeframe) {
  const pole = findPole(candles, atrValue, direction);
  if (!pole) return null;

  const { poleStart, poleEnd, poleMagnitude } = pole;
  const n       = candles.length;
  const lastIdx = n - 1;
  const current = candles[lastIdx].close;

  const consolStart = poleEnd + 1;
  const consolLen   = lastIdx - consolStart + 1;

  if (consolLen < CONSOL_MIN_BARS || consolLen > CONSOL_MAX_BARS) return null;

  const consolRange = priceRange(candles, consolStart, lastIdx);
  if (consolRange.range > MAX_FLAG_RETRACEMENT * poleMagnitude) return null;

  const consolCandles = candles.slice(consolStart, lastIdx + 1);
  const resPoints = consolCandles.map((c, i) => ({ x: consolStart + i, y: c.high }));
  const supPoints = consolCandles.map((c, i) => ({ x: consolStart + i, y: c.low  }));

  const resLine = fitLine(resPoints);
  const supLine = fitLine(supPoints);

  // Pennant: lines must converge (resistance falling or flat, support rising or flat)
  if (resLine.slope >= supLine.slope) return null; // not converging

  // Check for convergence apex within reasonable bars
  const apexX = lineIntersectX(resLine, supLine);
  if (apexX === null || apexX - lastIdx < 1 || apexX - lastIdx > 40) return null;

  const breakoutLevel = direction === 'bull'
    ? lineAt(resLine, lastIdx)
    : lineAt(supLine, lastIdx);

  let status;
  const distToBreak = Math.abs(current - breakoutLevel);
  if (distToBreak < 0.3 * atrValue) {
    status = STATUS.NEAR_BREAKOUT;
  } else if (
    (direction === 'bull' && current > breakoutLevel + 0.1 * atrValue) ||
    (direction === 'bear' && current < breakoutLevel - 0.1 * atrValue)
  ) {
    status = STATUS.CONFIRMED;
  } else {
    status = STATUS.FORMING;
  }

  const proxScore = scoreBreakoutProximity(current, breakoutLevel, atrValue);
  const poleScore = Math.min(1, poleMagnitude / (5 * atrValue));
  const volDelta  = volumeBonus(candles[lastIdx].volume, avgVol);

  const quality = weightedScore([
    { score: poleScore,  weight: 3 },
    { score: proxScore,  weight: 2 },
  ]) + volDelta;

  if (quality < 0.28) return null;

  const type = direction === 'bull' ? PATTERN_TYPES.PENNANT_BULL : PATTERN_TYPES.PENNANT_BEAR;
  const bias = direction === 'bull' ? BIAS.BULLISH : BIAS.BEARISH;

  return makePattern({
    type,
    bias,
    status,
    confidence: qualityToConfidence(quality),
    quality,
    timeframe,
    startIndex: poleStart,
    endIndex:   lastIdx,
    keyLevels: {
      poleTop:        direction === 'bull' ? candles[poleEnd].high  : candles[poleStart].high,
      poleBottom:     direction === 'bull' ? candles[poleStart].low : candles[poleEnd].low,
      poleMagnitude,
      pennantResistance: +lineAt(resLine, lastIdx).toFixed(8),
      pennantSupport:    +lineAt(supLine, lastIdx).toFixed(8),
      apexBarsAhead:  Math.round(apexX - lastIdx),
    },
    breakoutLevel:     +breakoutLevel.toFixed(8),
    invalidationLevel: direction === 'bull'
      ? +lineAt(supLine, lastIdx).toFixed(8)
      : +lineAt(resLine, lastIdx).toFixed(8),
    explanation:
      `Flâmula ${direction === 'bull' ? 'Altista' : 'Baixista'}: ` +
      `polo de ${poleMagnitude.toFixed(4)} (${Math.round(poleMagnitude / atrValue * 10) / 10}×ATR). ` +
      `Consolidação triangular de ${consolLen} barras, apex em ~${Math.round(apexX - lastIdx)} barras. ` +
      `${status === STATUS.CONFIRMED ? 'Rompimento confirmado.' : status === STATUS.NEAR_BREAKOUT ? 'Próximo ao rompimento.' : 'Em formação.'}`,
  });
}

module.exports = { detectFlag, detectPennant };
