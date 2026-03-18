'use strict';

/**
 * Trendline construction and line-break detection.
 *
 * Inspired by the "Trading Line with Breaks" concept (LuxAlgo-style) but implemented
 * independently using deterministic pivot-based logic.
 *
 * Approach:
 *  - Bearish (down) trendline: drawn from recent pivot highs descending left-to-right.
 *    A valid bearish trendline slopes down and has not been broken by a close above it.
 *  - Bullish (up) trendline: drawn from recent pivot lows ascending left-to-right.
 *    A valid bullish trendline slopes up and has not been broken by a close below it.
 *
 * Line-break detection:
 *  - A bearish trendline break occurs when the latest close is above the projected line level.
 *  - A bullish trendline break occurs when the latest close is below the projected line level.
 *
 * Output is fully deterministic given the same candle array.
 */

/**
 * @typedef {object} TrendlinePoint
 * @property {number} index
 * @property {number} time
 * @property {number} price
 */

/**
 * @typedef {object} Trendline
 * @property {'bearish'|'bullish'} direction
 * @property {TrendlinePoint} anchor1  - Earlier pivot
 * @property {TrendlinePoint} anchor2  - Later pivot
 * @property {number} slope            - Price change per bar
 * @property {number} currentLevel     - Projected price at the latest bar
 * @property {boolean} isBroken
 * @property {string} breakDirection   - 'above' | 'below' | 'none'
 * @property {string} priceRelation    - 'above' | 'near' | 'below' (relative to current price)
 */

/**
 * @typedef {object} TrendlineState
 * @property {string} activeTrendlineType   - 'bearish' | 'bullish' | 'both' | 'none'
 * @property {Trendline|null} bearishTrendline
 * @property {Trendline|null} bullishTrendline
 * @property {boolean} lineBreakDetected
 * @property {string} lineBreakDirection    - 'bullish_break' | 'bearish_break' | 'none'
 * @property {object} pivotContext
 * @property {string} explanation
 */

const defaults = require('../config/defaults');

/**
 * Build candidate bearish trendlines from pivot highs.
 * Returns the most recent valid descending trendline, or null.
 *
 * @param {import('./pivots').PivotPoint[]} pivotHighs
 * @param {Array} candles
 * @param {number} currentPrice
 * @param {number} atrValue
 * @returns {Trendline|null}
 */
function buildBearishTrendline(pivotHighs, candles, currentPrice, atrValue) {
  if (pivotHighs.length < 2) return null;

  const lastBar = candles.length - 1;

  // Try pairs of pivot highs from most recent backwards
  for (let i = pivotHighs.length - 1; i >= 1; i--) {
    const p2 = pivotHighs[i];
    for (let j = i - 1; j >= 0; j--) {
      const p1 = pivotHighs[j];

      // Bearish trendline: p2 must be lower than p1
      if (p2.price >= p1.price) continue;

      const slope = (p2.price - p1.price) / (p2.index - p1.index);

      // Project line to current bar
      const currentLevel = p2.price + slope * (lastBar - p2.index);

      // Verify the line is not broken between anchor2 and current bar
      let broken = false;
      let breakBar = -1;
      for (let k = p2.index + 1; k <= lastBar; k++) {
        const lineLevel = p2.price + slope * (k - p2.index);
        if (candles[k].close > lineLevel) {
          broken = true;
          breakBar = k;
          break;
        }
      }

      const touchThreshold = atrValue
        ? atrValue * defaults.TRENDLINE_TOUCH_ATR_FRACTION
        : currentLevel * 0.005;

      const priceRelation =
        currentPrice > currentLevel + touchThreshold ? 'above' :
        currentPrice < currentLevel - touchThreshold ? 'below' :
        'near';

      return {
        direction: 'bearish',
        anchor1: p1,
        anchor2: p2,
        slope,
        currentLevel,
        isBroken: broken,
        breakDirection: broken ? 'above' : 'none',
        priceRelation,
        breakBar,
      };
    }
  }

  return null;
}

/**
 * Build candidate bullish trendlines from pivot lows.
 * Returns the most recent valid ascending trendline, or null.
 *
 * @param {import('./pivots').PivotPoint[]} pivotLows
 * @param {Array} candles
 * @param {number} currentPrice
 * @param {number} atrValue
 * @returns {Trendline|null}
 */
function buildBullishTrendline(pivotLows, candles, currentPrice, atrValue) {
  if (pivotLows.length < 2) return null;

  const lastBar = candles.length - 1;

  for (let i = pivotLows.length - 1; i >= 1; i--) {
    const p2 = pivotLows[i];
    for (let j = i - 1; j >= 0; j--) {
      const p1 = pivotLows[j];

      // Bullish trendline: p2 must be higher than p1
      if (p2.price <= p1.price) continue;

      const slope = (p2.price - p1.price) / (p2.index - p1.index);

      const currentLevel = p2.price + slope * (lastBar - p2.index);

      let broken = false;
      let breakBar = -1;
      for (let k = p2.index + 1; k <= lastBar; k++) {
        const lineLevel = p2.price + slope * (k - p2.index);
        if (candles[k].close < lineLevel) {
          broken = true;
          breakBar = k;
          break;
        }
      }

      const touchThreshold = atrValue
        ? atrValue * defaults.TRENDLINE_TOUCH_ATR_FRACTION
        : currentLevel * 0.005;

      const priceRelation =
        currentPrice > currentLevel + touchThreshold ? 'above' :
        currentPrice < currentLevel - touchThreshold ? 'below' :
        'near';

      return {
        direction: 'bullish',
        anchor1: p1,
        anchor2: p2,
        slope,
        currentLevel,
        isBroken: broken,
        breakDirection: broken ? 'below' : 'none',
        priceRelation,
        breakBar,
      };
    }
  }

  return null;
}

/**
 * Analyze trendlines and produce the full TrendlineState.
 *
 * @param {object} params
 * @param {import('./pivots').PivotPoint[]} params.pivotHighs
 * @param {import('./pivots').PivotPoint[]} params.pivotLows
 * @param {Array} params.candles
 * @param {number} params.currentPrice
 * @param {number|null} params.atrValue
 * @returns {TrendlineState}
 */
function analyzeTrendlines({ pivotHighs, pivotLows, candles, currentPrice, atrValue }) {
  const bearish = buildBearishTrendline(pivotHighs, candles, currentPrice, atrValue || NaN);
  const bullish = buildBullishTrendline(pivotLows,  candles, currentPrice, atrValue || NaN);

  const hasBearish = bearish !== null;
  const hasBullish = bullish !== null;

  let activeTrendlineType = 'none';
  if (hasBearish && hasBullish)  activeTrendlineType = 'both';
  else if (hasBearish)           activeTrendlineType = 'bearish';
  else if (hasBullish)           activeTrendlineType = 'bullish';

  // Line-break events: prefer most recent
  let lineBreakDetected = false;
  let lineBreakDirection = 'none';

  if (hasBearish && bearish.isBroken) {
    lineBreakDetected  = true;
    lineBreakDirection = 'bullish_break'; // broke above bearish line
  } else if (hasBullish && bullish.isBroken) {
    lineBreakDetected  = true;
    lineBreakDirection = 'bearish_break'; // broke below bullish line
  }

  const pivotContext = {
    pivotHighCount: pivotHighs.length,
    pivotLowCount:  pivotLows.length,
    latestPivotHigh: pivotHighs.length > 0 ? pivotHighs[pivotHighs.length - 1] : null,
    latestPivotLow:  pivotLows.length  > 0 ? pivotLows[pivotLows.length  - 1] : null,
  };

  const explanation = buildTrendlineExplanation({
    bearish, bullish, lineBreakDetected, lineBreakDirection, currentPrice,
  });

  return {
    activeTrendlineType,
    bearishTrendline: bearish,
    bullishTrendline: bullish,
    lineBreakDetected,
    lineBreakDirection,
    pivotContext,
    explanation,
  };
}

function buildTrendlineExplanation({ bearish, bullish, lineBreakDetected, lineBreakDirection, currentPrice }) {
  const parts = [];

  if (lineBreakDetected) {
    if (lineBreakDirection === 'bullish_break') {
      parts.push('Rompimento acima da linha de resistência descendente — estrutura de alta em formação.');
    } else {
      parts.push('Rompimento abaixo da linha de suporte ascendente — estrutura de baixa em formação.');
    }
  }

  if (bearish && !bearish.isBroken) {
    const rel = bearish.priceRelation;
    if (rel === 'below') {
      parts.push(`Preço abaixo da resistência descendente (${bearish.currentLevel.toFixed(4)}) — pressão vendedora preservada.`);
    } else if (rel === 'near') {
      parts.push(`Preço testando a resistência descendente (${bearish.currentLevel.toFixed(4)}) — aguardar rejeição ou rompimento.`);
    }
  }

  if (bullish && !bullish.isBroken) {
    const rel = bullish.priceRelation;
    if (rel === 'above') {
      parts.push(`Preço acima do suporte ascendente (${bullish.currentLevel.toFixed(4)}) — suporte de tendência preservado.`);
    } else if (rel === 'near') {
      parts.push(`Preço testando o suporte ascendente (${bullish.currentLevel.toFixed(4)}) — aguardar bounce ou quebra.`);
    }
  }

  if (parts.length === 0) {
    parts.push('Sem estrutura de trendline dominante detectada.');
  }

  return parts.join(' ');
}

module.exports = { analyzeTrendlines, buildBearishTrendline, buildBullishTrendline };
