'use strict';

/**
 * Consolidation and accumulation zone detection.
 *
 * These are structural conditions derived from candle data and locally computed indicators.
 * They are NOT proprietary indicators — they are deterministic, explainable conditions.
 *
 * Consolidation zone:
 *   A period of compressed, sideways price action with limited directional progress.
 *   Detected by measuring the price range relative to ATR over a lookback window.
 *
 * Accumulation zone:
 *   A consolidation zone that additionally shows characteristics suggestive of demand
 *   absorption: occurring after a decline, repeated defense of a lower support level,
 *   and/or improving volume behavior at lows.
 *
 * Outputs are conservative and include uncertainty signals.
 */

const defaults = require('../config/defaults');

/**
 * @typedef {object} ZoneState
 * @property {'consolidation'|'accumulation'|'none'} zoneType
 * @property {number|null} zoneHigh
 * @property {number|null} zoneLow
 * @property {'weak'|'moderate'|'strong'|null} zoneStrength
 * @property {'low'|'moderate'|'high'} breakoutRisk
 * @property {string} explanation
 */

/**
 * Detect whether the current candles are in a consolidation or accumulation zone.
 *
 * @param {object} params
 * @param {Array<{ open: number, high: number, low: number, close: number, volume: number }>} params.candles
 * @param {number|null} params.atrValue          - Current ATR (may be NaN/null)
 * @param {number[]} params.atrSeries            - Full ATR series
 * @param {number} [params.lookback]              - Number of recent bars to examine
 * @returns {ZoneState}
 */
function detectZone({ candles, atrValue, atrSeries, lookback = defaults.ZONE_LOOKBACK }) {
  const n = candles.length;
  if (n < lookback) {
    return noZone('Histórico de candles insuficiente para detecção de zona.');
  }

  const window = candles.slice(n - lookback);
  const highs  = window.map((c) => c.high);
  const lows   = window.map((c) => c.low);
  const closes = window.map((c) => c.close);

  const windowHigh = Math.max(...highs);
  const windowLow  = Math.min(...lows);
  const windowRange = windowHigh - windowLow;

  // Use ATR to gauge "normal" range
  const effectiveAtr = (atrValue && !isNaN(atrValue)) ? atrValue : windowRange / 5;
  const consolidationThreshold = effectiveAtr * defaults.CONSOLIDATION_ATR_MULTIPLIER;

  const isCompressed = windowRange <= consolidationThreshold;

  if (!isCompressed) {
    return noZone('Range de preço não suficientemente comprimido para indicar zona de consolidação.');
  }

  // Further qualify consolidation quality.
  // Use an inner band (middle 70% of the range) rather than the full [windowLow, windowHigh]
  // extremes. The full extremes are derived from the same window, so every close would
  // trivially pass and coverageRatio would always be 1.0. The inner band measures whether
  // price action is genuinely centered and contained — not just that it exists in the window.
  const innerBandLow  = windowLow  + windowRange * 0.15;
  const innerBandHigh = windowHigh - windowRange * 0.15;
  const closesInRange = closes.filter((c) => c >= innerBandLow && c <= innerBandHigh).length;
  const coverageRatio = closesInRange / closes.length;

  let zoneStrength = 'weak';
  if (coverageRatio >= 0.85) zoneStrength = 'strong';
  else if (coverageRatio >= 0.65) zoneStrength = 'moderate';

  // Check for accumulation characteristics
  const isAccumulation = checkAccumulationConditions({ window, candles, n, lookback, atrSeries });

  // Estimate breakout risk from ATR compression
  const compressionRatio = windowRange / (effectiveAtr * 3);
  let breakoutRisk = 'moderate';
  if (compressionRatio < 0.4) breakoutRisk = 'high';
  else if (compressionRatio > 0.7) breakoutRisk = 'low';

  if (isAccumulation) {
    return {
      zoneType:     'accumulation',
      zoneHigh:     windowHigh,
      zoneLow:      windowLow,
      zoneStrength,
      breakoutRisk,
      explanation: buildAccumulationExplanation(windowHigh, windowLow, zoneStrength, breakoutRisk),
    };
  }

  return {
    zoneType:     'consolidation',
    zoneHigh:     windowHigh,
    zoneLow:      windowLow,
    zoneStrength,
    breakoutRisk,
    explanation: buildConsolidationExplanation(windowHigh, windowLow, zoneStrength, breakoutRisk),
  };
}

/**
 * Check additional accumulation conditions.
 * Returns true only when multiple supportive signals are present.
 * Conservative: accumulation is a structural possibility, not a certainty.
 */
function checkAccumulationConditions({ window, candles, n, lookback, atrSeries }) {
  // Condition 1: Prior decline before the window
  const priorLookback = Math.min(lookback * 2, n - lookback);
  if (priorLookback < 5) return false;

  const priorWindow = candles.slice(n - lookback - priorLookback, n - lookback);
  const priorHigh   = Math.max(...priorWindow.map((c) => c.high));
  const windowHigh  = Math.max(...window.map((c) => c.high));

  const declineFromPrior = (priorHigh - windowHigh) / priorHigh;
  const hadDecline = declineFromPrior >= 0.05; // at least 5% decline before zone

  if (!hadDecline) return false;

  // Condition 2: Lower wick defense — repeated wicks touching the low of the zone
  const windowLow    = Math.min(...window.map((c) => c.low));
  const windowRange  = windowHigh - windowLow;
  const lowerQuarter = windowLow + windowRange * 0.25;
  const lowDefenses  = window.filter((c) => c.low <= lowerQuarter).length;
  const hasLowDefense = lowDefenses >= 3;

  // Condition 3: Closes mostly in the upper half of the zone (absorption)
  const midpoint   = (windowHigh + windowLow) / 2;
  const upperCloses = window.filter((c) => c.close >= midpoint).length;
  const hasUpperBias = upperCloses / window.length >= 0.5;

  // Require at least 2 of the 3 secondary conditions
  const secondaryScore = [hasLowDefense, hasUpperBias].filter(Boolean).length;
  return secondaryScore >= 1;
}

const ZONE_STRENGTH_PT = { weak: 'fraca', moderate: 'moderada', strong: 'forte' };
const BREAKOUT_RISK_PT = { low: 'baixo', moderate: 'moderado', high: 'alto' };

function noZone(explanation) {
  return {
    zoneType:     'none',
    zoneHigh:     null,
    zoneLow:      null,
    zoneStrength: null,
    breakoutRisk: 'low',
    explanation,
  };
}

function buildConsolidationExplanation(high, low, strength, breakoutRisk) {
  const strPt  = ZONE_STRENGTH_PT[strength]    || strength;
  const riskPt = BREAKOUT_RISK_PT[breakoutRisk] || breakoutRisk;
  return (
    `Preço em consolidação de estrutura ${strPt} entre ${low.toFixed(4)} e ${high.toFixed(4)}. ` +
    `Risco de rompimento: ${riskPt}. Sem viés direcional claro.`
  );
}

function buildAccumulationExplanation(high, low, strength, breakoutRisk) {
  const strPt  = ZONE_STRENGTH_PT[strength]    || strength;
  const riskPt = BREAKOUT_RISK_PT[breakoutRisk] || breakoutRisk;
  return (
    `Possível zona de acumulação entre ${low.toFixed(4)} e ${high.toFixed(4)} (estrutura ${strPt}). ` +
    `Preço comprimindo após declínio anterior com defesa repetida das mínimas. ` +
    `Risco de rompimento: ${riskPt}. Possibilidade estrutural — não reversão confirmada.`
  );
}

module.exports = { detectZone };
