'use strict';

/**
 * Rectangle / Range (Retângulo / Range) detection.
 *
 * A rectangle is defined by:
 *   - A horizontal (or near-horizontal) resistance band with multiple touches
 *   - A horizontal (or near-horizontal) support band with multiple touches
 *   - The channel height is ATR-relative (neither too tight nor too wide)
 *   - At least MIN_TOUCHES touches on each boundary
 *   - Current price is inside the range (not already broken out)
 *
 * Status:
 *   - forming:       price in the middle of the range
 *   - near_breakout: price within 1×ATR of either boundary
 *   - confirmed:     price outside the range
 *
 * Bias:
 *   - neutral if price is in the middle or lower half
 *   - slightly bullish if price is above midpoint (momentum toward resistance)
 *   - direction is typically confirmed by the breakout side
 */

const { fitLine, lineAt, isFlat } = require('./geometry');
const { countTouches, scoreBreakoutProximity, volumeBonus, weightedScore, qualityToConfidence, scoreTouchCount } = require('./scoring');
const { makePattern, PATTERN_TYPES, BIAS, STATUS } = require('./normalize');

const MIN_TOUCHES     = 2;   // minimum touches per boundary line
const MIN_RANGE_BARS  = 15;  // range must span at least this many bars
const MAX_RANGE_BARS  = 120;
const MIN_HEIGHT_ATR  = 1.0; // range height must be at least 1×ATR
const MAX_HEIGHT_ATR  = 8.0; // range height must be at most 8×ATR (beyond is a macro range)

/**
 * Detect Rectangle / Range (neutral bias until breakout).
 *
 * @param {Array} candles
 * @param {Array} pivotHighs
 * @param {Array} pivotLows
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectRectangle(candles, pivotHighs, pivotLows, atrValue, avgVol, timeframe) {
  const recentHighs = pivotHighs.slice(-10);
  const recentLows  = pivotLows.slice(-10);

  if (recentHighs.length < MIN_TOUCHES || recentLows.length < MIN_TOUCHES) return null;

  const lastIdx = candles.length - 1;
  const current = candles[lastIdx].close;

  // Fit resistance line through pivot highs
  const resLine = fitLine(recentHighs.map((p) => ({ x: p.index, y: p.price })));
  // Fit support line through pivot lows
  const supLine = fitLine(recentLows.map((p)  => ({ x: p.index, y: p.price })));

  // Both lines must be roughly flat (ATR-relative)
  if (!isFlat(resLine.slope, atrValue, 0.10)) return null;
  if (!isFlat(supLine.slope, atrValue, 0.10)) return null;

  const resLevel = lineAt(resLine, lastIdx);
  const supLevel = lineAt(supLine, lastIdx);

  // Support must be below resistance
  if (supLevel >= resLevel) return null;

  const height = resLevel - supLevel;

  // Height must be in the ATR-relative range
  if (height < MIN_HEIGHT_ATR * atrValue) return null;
  if (height > MAX_HEIGHT_ATR * atrValue) return null;

  // Check that the pattern spans enough bars
  const startIndex = Math.min(recentHighs[0].index, recentLows[0].index);
  const patternBars = lastIdx - startIndex;
  if (patternBars < MIN_RANGE_BARS || patternBars > MAX_RANGE_BARS) return null;

  // Count touches on each boundary
  const resTouches = countTouches(recentHighs, resLine, atrValue, 0.5);
  const supTouches = countTouches(recentLows,  supLine, atrValue, 0.5);

  if (resTouches < MIN_TOUCHES || supTouches < MIN_TOUCHES) return null;

  // Determine status based on price position
  let status;
  let bias = BIAS.NEUTRAL;

  if (current > resLevel + 0.1 * atrValue) {
    status = STATUS.CONFIRMED;
    bias   = BIAS.BULLISH;
  } else if (current < supLevel - 0.1 * atrValue) {
    status = STATUS.CONFIRMED;
    bias   = BIAS.BEARISH;
  } else if (current > resLevel - 0.8 * atrValue || current < supLevel + 0.8 * atrValue) {
    status = STATUS.NEAR_BREAKOUT;
    bias   = current > (resLevel + supLevel) / 2 ? BIAS.BULLISH : BIAS.BEARISH;
  } else {
    status = STATUS.FORMING;
  }

  const proxResScore = scoreBreakoutProximity(current, resLevel, atrValue);
  const proxSupScore = scoreBreakoutProximity(current, supLevel, atrValue);
  const proxScore    = Math.max(proxResScore, proxSupScore);
  const volDelta     = volumeBonus(candles[lastIdx].volume, avgVol);

  const quality = weightedScore([
    { score: scoreTouchCount(resTouches), weight: 2 },
    { score: scoreTouchCount(supTouches), weight: 2 },
    { score: proxScore,                   weight: 1 },
    { score: Math.min(1, patternBars / MAX_RANGE_BARS), weight: 1 },
  ]) + volDelta;

  if (quality < 0.28) return null;

  const midpoint = (resLevel + supLevel) / 2;

  return makePattern({
    type:       PATTERN_TYPES.RECTANGLE,
    bias,
    status,
    confidence: qualityToConfidence(quality),
    quality,
    timeframe,
    startIndex,
    endIndex:   lastIdx,
    keyLevels: {
      resistance: +resLevel.toFixed(8),
      support:    +supLevel.toFixed(8),
      midpoint:   +midpoint.toFixed(8),
      height:     +height.toFixed(8),
      resTouches,
      supTouches,
    },
    breakoutLevel:     bias === BIAS.BEARISH ? +supLevel.toFixed(8) : +resLevel.toFixed(8),
    invalidationLevel: bias === BIAS.BEARISH ? +resLevel.toFixed(8) : +supLevel.toFixed(8),
    explanation:
      `Retângulo / Range: resistência $${resLevel.toFixed(4)} (${resTouches} toques), ` +
      `suporte $${supLevel.toFixed(4)} (${supTouches} toques). ` +
      `Altura do range: ${height.toFixed(4)} (${Math.round(height / atrValue * 10) / 10}×ATR). ` +
      `${status === STATUS.CONFIRMED ? `Rompimento confirmado para ${bias === BIAS.BULLISH ? 'cima' : 'baixo'}.` : status === STATUS.NEAR_BREAKOUT ? 'Próximo ao rompimento.' : 'Preço dentro do range.'}`,
  });
}

module.exports = { detectRectangle };
