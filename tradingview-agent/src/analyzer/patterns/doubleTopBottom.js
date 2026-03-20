'use strict';

/**
 * Double Top (Topo Duplo) and Double Bottom (Fundo Duplo) detection.
 *
 * Algorithm (Double Top):
 *   1. Scan recent pivot highs for pairs at similar price levels (within 1.5×ATR)
 *   2. Require a meaningful valley between the two tops (depth ≥ 1.5×ATR from peak)
 *   3. The second top should not significantly exceed the first (would be a new high)
 *   4. Neckline = lowest close between the two tops
 *   5. Status: forming / near_breakout / confirmed based on price vs neckline
 *
 * Double Bottom is the mirror: pivot lows, peak between them, resistance neckline.
 */

const { findLowest, findHighest } = require('./geometry');
const { scoreSymmetry, scoreBreakoutProximity, volumeBonus, weightedScore, qualityToConfidence } = require('./scoring');
const { makePattern, PATTERN_TYPES, BIAS, STATUS } = require('./normalize');

const MIN_SPACING        = 6;   // bars between tops/bottoms
const MAX_PATTERN_BARS   = 100;
const MAX_TOPS_TO_SCAN   = 8;   // how many recent pivots to look at

/**
 * Detect Double Top (bearish reversal).
 *
 * @param {Array} candles
 * @param {Array} pivotHighs
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectDoubleTop(candles, pivotHighs, atrValue, avgVol, timeframe) {
  if (pivotHighs.length < 2) return null;

  const phs     = pivotHighs.slice(-MAX_TOPS_TO_SCAN);
  const n       = phs.length;
  const lastIdx = candles.length - 1;
  const current = candles[lastIdx].close;

  // Try pairs from most recent backward
  for (let i = n - 1; i >= 1; i--) {
    const top2 = phs[i];     // more recent top
    const top1 = phs[i - 1]; // earlier top

    // Minimum spacing
    if (top2.index - top1.index < MIN_SPACING) continue;
    if (top2.index - top1.index > MAX_PATTERN_BARS) continue;

    // Both tops must be at similar price levels (within 1.5×ATR)
    if (Math.abs(top1.price - top2.price) > 1.5 * atrValue) continue;

    // Second top should not significantly exceed first (otherwise it's a breakout, not reversal)
    if (top2.price > top1.price + 0.5 * atrValue) continue;

    // Find the valley (neckline) between the two tops
    const valley = findLowest(candles, top1.index, top2.index);
    if (!valley) continue;

    // Valley must be at least 1.5×ATR below both tops (meaningful retracement)
    const topAvg = (top1.price + top2.price) / 2;
    if (topAvg - valley.price < 1.5 * atrValue) continue;

    const neckline = valley.price;

    // Determine status
    let status;
    if (current < neckline - 0.1 * atrValue) {
      status = STATUS.CONFIRMED;
    } else if (current <= neckline + 0.8 * atrValue) {
      status = STATUS.NEAR_BREAKOUT;
    } else {
      status = STATUS.FORMING;
    }

    // Invalidated if price closes clearly above either top
    if (current > topAvg + 0.5 * atrValue) continue;

    const symScore  = scoreSymmetry(top1.price, top2.price, atrValue);
    const proxScore = scoreBreakoutProximity(current, neckline, atrValue);
    const volDelta  = volumeBonus(candles[lastIdx].volume, avgVol);
    const depthScore = Math.min(1, (topAvg - neckline) / (4 * atrValue));

    const quality = weightedScore([
      { score: symScore,   weight: 3 },
      { score: proxScore,  weight: 2 },
      { score: depthScore, weight: 2 },
    ]) + volDelta;

    if (quality < 0.30) continue;

    return makePattern({
      type:             PATTERN_TYPES.DOUBLE_TOP,
      bias:             BIAS.BEARISH,
      status,
      confidence:       qualityToConfidence(quality),
      quality,
      timeframe,
      startIndex:       top1.index,
      endIndex:         top2.index,
      keyLevels: {
        top1:     top1.price,
        top2:     top2.price,
        neckline,
        valleyIndex: valley.index,
      },
      breakoutLevel:     neckline,
      invalidationLevel: +(topAvg + 0.5 * atrValue).toFixed(8),
      explanation:
        `Topo Duplo: primeiro topo $${top1.price.toFixed(4)}, segundo topo $${top2.price.toFixed(4)}. ` +
        `Neckline (vale) em $${neckline.toFixed(4)}. ` +
        `${status === STATUS.CONFIRMED ? 'Rompimento da neckline confirmado.' : status === STATUS.NEAR_BREAKOUT ? 'Preço próximo à neckline.' : 'Padrão em formação.'}`,
    });
  }

  return null;
}

/**
 * Detect Double Bottom (bullish reversal).
 *
 * Mirror of detectDoubleTop, using pivot lows.
 *
 * @param {Array} candles
 * @param {Array} pivotLows
 * @param {number} atrValue
 * @param {number} avgVol
 * @param {string} timeframe
 * @returns {object|null}
 */
function detectDoubleBottom(candles, pivotLows, atrValue, avgVol, timeframe) {
  if (pivotLows.length < 2) return null;

  const pls     = pivotLows.slice(-MAX_TOPS_TO_SCAN);
  const n       = pls.length;
  const lastIdx = candles.length - 1;
  const current = candles[lastIdx].close;

  for (let i = n - 1; i >= 1; i--) {
    const bot2 = pls[i];
    const bot1 = pls[i - 1];

    if (bot2.index - bot1.index < MIN_SPACING) continue;
    if (bot2.index - bot1.index > MAX_PATTERN_BARS) continue;

    // Both bottoms at similar price levels (within 1.5×ATR)
    if (Math.abs(bot1.price - bot2.price) > 1.5 * atrValue) continue;

    // Second bottom should not significantly undercut first
    if (bot2.price < bot1.price - 0.5 * atrValue) continue;

    // Find the peak (neckline) between the two bottoms
    const peak = findHighest(candles, bot1.index, bot2.index);
    if (!peak) continue;

    // Peak must be at least 1.5×ATR above both bottoms
    const botAvg = (bot1.price + bot2.price) / 2;
    if (peak.price - botAvg < 1.5 * atrValue) continue;

    const neckline = peak.price;

    let status;
    if (current > neckline + 0.1 * atrValue) {
      status = STATUS.CONFIRMED;
    } else if (current >= neckline - 0.8 * atrValue) {
      status = STATUS.NEAR_BREAKOUT;
    } else {
      status = STATUS.FORMING;
    }

    // Invalidated if price breaks clearly below either bottom
    if (current < botAvg - 0.5 * atrValue) continue;

    const symScore  = scoreSymmetry(bot1.price, bot2.price, atrValue);
    const proxScore = scoreBreakoutProximity(current, neckline, atrValue);
    const volDelta  = volumeBonus(candles[lastIdx].volume, avgVol);
    const depthScore = Math.min(1, (neckline - botAvg) / (4 * atrValue));

    const quality = weightedScore([
      { score: symScore,   weight: 3 },
      { score: proxScore,  weight: 2 },
      { score: depthScore, weight: 2 },
    ]) + volDelta;

    if (quality < 0.30) continue;

    return makePattern({
      type:             PATTERN_TYPES.DOUBLE_BOTTOM,
      bias:             BIAS.BULLISH,
      status,
      confidence:       qualityToConfidence(quality),
      quality,
      timeframe,
      startIndex:       bot1.index,
      endIndex:         bot2.index,
      keyLevels: {
        bottom1:  bot1.price,
        bottom2:  bot2.price,
        neckline,
        peakIndex: peak.index,
      },
      breakoutLevel:     neckline,
      invalidationLevel: +(botAvg - 0.5 * atrValue).toFixed(8),
      explanation:
        `Fundo Duplo: primeiro fundo $${bot1.price.toFixed(4)}, segundo fundo $${bot2.price.toFixed(4)}. ` +
        `Neckline (pico) em $${neckline.toFixed(4)}. ` +
        `${status === STATUS.CONFIRMED ? 'Rompimento da neckline confirmado.' : status === STATUS.NEAR_BREAKOUT ? 'Preço próximo à neckline.' : 'Padrão em formação.'}`,
    });
  }

  return null;
}

module.exports = { detectDoubleTop, detectDoubleBottom };
