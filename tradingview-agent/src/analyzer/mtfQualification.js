'use strict';

/**
 * mtfQualification — multi-timeframe setup qualification.
 *
 * Takes results from multiple analyzeMarket calls and evaluates whether
 * higher-timeframe trends confirm or conflict with the base-timeframe signal.
 *
 * Design principles:
 *  - Pure: no network calls. Operates on already-fetched analyzeMarket results.
 *  - Conservative: requires explicit confirmation; neutral when insufficient data.
 *  - Directional: only compares higher TFs to base (lower TFs are informational, not qualifying).
 *  - Bounded: confidence adjustment capped at [-0.10, +0.08].
 */

/** Ordered rank for timeframes — lower number = shorter timeframe */
const TF_RANK = {
  '1m':  1, '3m':  2, '5m':  3, '15m': 4, '30m': 5,
  '1h':  6, '2h':  7, '4h':  8, '6h':  9, '12h': 10,
  '1d': 11, '1w': 12,
};

const MTF_ADJ_MIN = -0.10;
const MTF_ADJ_MAX = +0.08;

/**
 * Get numeric rank for a timeframe label.
 * Returns 0 for unknown timeframes.
 *
 * @param {string} tf
 * @returns {number}
 */
function getTfRank(tf) {
  return TF_RANK[tf] || 0;
}

/**
 * Classify whether a higher-TF result confirms, conflicts, or is neutral
 * relative to the base signal direction.
 *
 * Confirmation = higher-TF trend aligns with base signal direction.
 * Conflict     = higher-TF trend is opposite to base signal direction.
 * Neutral      = higher-TF trend is ambiguous or unavailable.
 *
 * @param {object|null} higherTfResult  - analyzeMarket result for the higher TF
 * @param {string}      baseSignal      - base timeframe signal
 * @returns {'confirming'|'conflicting'|'neutral'}
 */
function classifyHigherTfAlignment(higherTfResult, baseSignal) {
  if (!higherTfResult) return 'neutral';

  const { trend } = higherTfResult;
  const isBullishBase = baseSignal === 'pullback_watch' || baseSignal === 'breakout_watch';
  const isBearishBase = baseSignal === 'bearish_breakdown_watch';

  const htfBullish = trend === 'strong_bullish' || trend === 'bullish';
  const htfBearish = trend === 'strong_bearish' || trend === 'bearish';

  if (isBullishBase) {
    if (htfBullish) return 'confirming';
    if (htfBearish) return 'conflicting';
    return 'neutral';
  }

  if (isBearishBase) {
    if (htfBearish) return 'confirming';
    if (htfBullish) return 'conflicting';
    return 'neutral';
  }

  return 'neutral';
}

/**
 * Compute MTF qualification from a map of TF → analyzeMarket results.
 *
 * Only considers timeframes HIGHER than baseTimeframe for qualification.
 * Lower timeframes are ignored (they cannot qualify a higher-TF setup).
 *
 * @param {object} params
 * @param {string} params.baseTimeframe  - e.g. '1h'
 * @param {string} params.baseSignal     - e.g. 'pullback_watch'
 * @param {object} params.mtfResults     - map of timeframe → analyzeMarket result
 * @returns {{
 *   mtfAlignment: 'aligned'|'conflicting'|'neutral',
 *   higherTfCount: number,
 *   confirmingCount: number,
 *   conflictingCount: number,
 *   reasons: string[],
 *   confidenceAdjustment: number,
 * }}
 */
function computeMtfQualification({ baseTimeframe, baseSignal, mtfResults }) {
  const baseTfRank = getTfRank(baseTimeframe);

  // Only consider TFs strictly higher than the base
  const higherTfs = Object.keys(mtfResults || {})
    .filter((tf) => getTfRank(tf) > baseTfRank && mtfResults[tf] != null)
    .sort((a, b) => getTfRank(a) - getTfRank(b));

  if (higherTfs.length === 0) {
    return {
      mtfAlignment:         'neutral',
      higherTfCount:        0,
      confirmingCount:      0,
      conflictingCount:     0,
      reasons:              ['no_higher_tf_data'],
      confidenceAdjustment: 0,
    };
  }

  let confirmingCount  = 0;
  let conflictingCount = 0;
  const reasons        = [];

  for (const tf of higherTfs) {
    const result    = mtfResults[tf];
    const alignment = classifyHigherTfAlignment(result, baseSignal);

    if (alignment === 'confirming') {
      confirmingCount++;
      reasons.push(`${tf}_confirms(${result.trend})`);
    } else if (alignment === 'conflicting') {
      conflictingCount++;
      reasons.push(`${tf}_conflicts(${result.trend})`);
    } else {
      reasons.push(`${tf}_neutral(${result.trend})`);
    }
  }

  // Determine overall alignment
  let mtfAlignment;
  let adj = 0;

  if (conflictingCount > 0 && conflictingCount >= confirmingCount) {
    mtfAlignment = 'conflicting';
    // Stronger penalty when multiple TFs conflict
    adj = conflictingCount >= 2 ? -0.10 : -0.05;
  } else if (confirmingCount > 0 && conflictingCount === 0) {
    mtfAlignment = 'aligned';
    // Stronger boost when multiple TFs confirm
    adj = confirmingCount >= 2 ? 0.08 : 0.04;
  } else {
    // Mixed: some confirming, some conflicting — or all neutral
    mtfAlignment = 'neutral';
    adj = 0;
  }

  const confidenceAdjustment = Math.round(
    Math.max(MTF_ADJ_MIN, Math.min(MTF_ADJ_MAX, adj)) * 100
  ) / 100;

  return {
    mtfAlignment,
    higherTfCount:   higherTfs.length,
    confirmingCount,
    conflictingCount,
    reasons,
    confidenceAdjustment,
  };
}

module.exports = { computeMtfQualification, classifyHigherTfAlignment, getTfRank };
