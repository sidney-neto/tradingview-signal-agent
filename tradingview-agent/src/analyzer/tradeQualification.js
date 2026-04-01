'use strict';

/**
 * tradeQualification — structured trade plan layer.
 *
 * Takes the output of computeAnalysisPipeline plus optional MTF and regime
 * context, and produces a structured, numerical trade plan.
 *
 * Design principles:
 *  - Conservative: leaves numeric fields null when data is insufficient.
 *  - Explainable: all quality decisions have reasons attached.
 *  - Pure: no network calls, no side effects — fully testable offline.
 *  - Additive: does not replace signal/confidence/invalidation/targets;
 *    it extends the output with executable-grade metadata.
 */

const BULLISH_SIGNALS = new Set(['breakout_watch', 'pullback_watch']);
const BEARISH_SIGNALS = new Set(['bearish_breakdown_watch']);

const round4 = (n) => (n != null && !isNaN(n)) ? Math.round(n * 10000) / 10000 : null;
const round1 = (n) => (n != null && !isNaN(n)) ? Math.round(n * 10) / 10 : null;

/**
 * Compute entry zone as a ±fraction-of-ATR band around the current price.
 * Returns null if ATR is unavailable.
 *
 * @private
 */
function _computeEntryZone(currentPrice, atr14) {
  if (!currentPrice || !atr14 || isNaN(atr14)) return null;
  const half = atr14 * 0.25;
  return {
    lower: round4(currentPrice - half),
    upper: round4(currentPrice + half),
  };
}

/**
 * Compute numerical stop price for a given signal.
 * Uses the nearest relevant support/resistance level ± ATR buffer.
 * Returns null if insufficient data.
 *
 * @private
 */
function _computeStopPrice(signal, currentPrice, indicators, trendlineState) {
  const { ema20, ema50, atr14 } = indicators || {};
  if (!currentPrice || !atr14 || isNaN(atr14)) return null;

  const buffer = atr14 * 0.5;

  if (signal === 'pullback_watch') {
    const ema50Valid = ema50 != null && !isNaN(ema50);
    const ema20Valid = ema20 != null && !isNaN(ema20);
    // Near EMA50: stop just below it
    if (ema50Valid && currentPrice <= ema50 * 1.01) {
      return round4(ema50 - buffer);
    }
    // Near EMA20: stop just below it
    if (ema20Valid && currentPrice <= ema20 * 1.01) {
      return round4(ema20 - buffer);
    }
    // Bullish trendline present
    const btl = trendlineState?.bullishTrendline;
    if (btl && !btl.isBroken && btl.currentLevel) {
      return round4(btl.currentLevel - buffer);
    }
    // Fallback: 1.5 ATR below current price
    return round4(currentPrice - 1.5 * atr14);
  }

  if (signal === 'breakout_watch') {
    // Stop below the broken resistance (now support)
    const bearTL = trendlineState?.bearishTrendline;
    if (bearTL && bearTL.currentLevel) {
      return round4(bearTL.currentLevel - buffer);
    }
    return round4(currentPrice - 2 * atr14);
  }

  if (signal === 'bearish_breakdown_watch') {
    const bullTL = trendlineState?.bullishTrendline;
    if (bullTL && bullTL.currentLevel) {
      return round4(bullTL.currentLevel + buffer);
    }
    return round4(currentPrice + 1.5 * atr14);
  }

  return null;
}

/**
 * Compute take-profit levels for a given signal.
 * Returns null if insufficient data; returns an array of 1–2 price levels.
 *
 * @private
 */
function _computeTakeProfitLevels(signal, currentPrice, indicators, trendlineState) {
  const { ema20, atr14 } = indicators || {};
  if (!currentPrice || !atr14 || isNaN(atr14)) return null;

  const tps = [];

  if (BULLISH_SIGNALS.has(signal)) {
    // TP1: EMA20 (if above current price, it's the recovery target)
    if (ema20 != null && !isNaN(ema20) && ema20 > currentPrice) {
      tps.push(round4(ema20));
    } else {
      tps.push(round4(currentPrice + 1.5 * atr14));
    }
    // TP2: prior swing high or 3×ATR extension
    const pivotHigh = trendlineState?.pivotContext?.latestPivotHigh?.price;
    if (pivotHigh && pivotHigh > currentPrice) {
      tps.push(round4(pivotHigh));
    } else {
      tps.push(round4(currentPrice + 3 * atr14));
    }
  } else if (BEARISH_SIGNALS.has(signal)) {
    // TP1: EMA20 (if below current price)
    if (ema20 != null && !isNaN(ema20) && ema20 < currentPrice) {
      tps.push(round4(ema20));
    } else {
      tps.push(round4(currentPrice - 1.5 * atr14));
    }
    // TP2: prior swing low or -3×ATR
    const pivotLow = trendlineState?.pivotContext?.latestPivotLow?.price;
    if (pivotLow && pivotLow < currentPrice) {
      tps.push(round4(pivotLow));
    } else {
      tps.push(round4(currentPrice - 3 * atr14));
    }
  }

  return tps.length > 0 ? tps : null;
}

/**
 * Compute the trade qualification layer from pipeline output + optional context.
 *
 * @param {object} params
 * @param {string}      params.signal
 * @param {number}      params.confidence
 * @param {string}      params.trend
 * @param {string}      params.momentum
 * @param {object}      params.indicators      - { ema20, ema50, ema100, ema200, ma200, atr14, rsi14, avgVolume20 }
 * @param {number}      params.currentPrice
 * @param {object|null} params.trendlineState
 * @param {object|null} params.zoneState
 * @param {string}      params.volumeState
 * @param {string}      params.volatilityState
 * @param {object|null} [params.mtfQualification]  - from mtfQualification.js (optional)
 * @param {object|null} [params.marketRegime]      - from marketRegime.js (optional)
 *
 * @returns {{
 *   tradeBias: 'long'|'short'|'flat',
 *   setupQuality: 'high'|'medium'|'low'|'rejected',
 *   entryZone: {lower: number, upper: number}|null,
 *   stopPrice: number|null,
 *   takeProfitLevels: number[]|null,
 *   riskRewardEstimate: number|null,
 *   trendAlignment: 'aligned'|'counter'|'neutral',
 *   isCounterTrend: boolean,
 *   rejectReasons: string[],
 *   qualityReasons: string[],
 * }}
 */
function computeTradeQualification({
  signal,
  confidence,
  trend,
  momentum,
  indicators,
  currentPrice,
  trendlineState,
  zoneState,
  volumeState,
  volatilityState,
  mtfQualification = null,
  marketRegime = null,
}) {
  const rejectReasons  = [];
  const qualityReasons = [];

  // ── Trade bias ────────────────────────────────────────────────────────────
  const tradeBias = BULLISH_SIGNALS.has(signal) ? 'long'
    : BEARISH_SIGNALS.has(signal) ? 'short'
    : 'flat';

  // ── Counter-trend detection ───────────────────────────────────────────────
  const trendBullish   = trend === 'strong_bullish' || trend === 'bullish';
  const trendBearish   = trend === 'strong_bearish' || trend === 'bearish';
  const isCounterTrend = (tradeBias === 'long' && trendBearish)
    || (tradeBias === 'short' && trendBullish);

  const trendAlignment = isCounterTrend ? 'counter'
    : (tradeBias === 'flat') ? 'neutral'
    : 'aligned';

  // ── Numerical levels ──────────────────────────────────────────────────────
  const { atr14 } = indicators || {};

  const entryZone = _computeEntryZone(currentPrice, atr14);
  const stopPrice = tradeBias !== 'flat'
    ? _computeStopPrice(signal, currentPrice, indicators, trendlineState)
    : null;
  const takeProfitLevels = tradeBias !== 'flat'
    ? _computeTakeProfitLevels(signal, currentPrice, indicators, trendlineState)
    : null;

  // ── Risk/reward estimate ──────────────────────────────────────────────────
  let riskRewardEstimate = null;
  if (stopPrice != null && takeProfitLevels != null && takeProfitLevels.length > 0 && currentPrice) {
    const riskDist   = Math.abs(currentPrice - stopPrice);
    const rewardDist = Math.abs(takeProfitLevels[0] - currentPrice);
    if (riskDist > 0) {
      riskRewardEstimate = round1(rewardDist / riskDist);
    }
  }

  // ── Setup quality scoring ──────────────────────────────────────────────────
  let setupQuality;

  if (signal === 'no_trade') {
    setupQuality = 'rejected';
    rejectReasons.push('no_actionable_signal');
  } else if (isCounterTrend && confidence < 0.60) {
    setupQuality = 'rejected';
    rejectReasons.push('counter_trend_low_confidence');
  } else {
    // Start from quality-adjusted confidence and apply context modifiers
    let qualScore = confidence;

    if (mtfQualification) {
      if (mtfQualification.mtfAlignment === 'aligned') {
        qualScore += 0.05;
        qualityReasons.push('mtf_aligned: +0.05');
      } else if (mtfQualification.mtfAlignment === 'conflicting') {
        qualScore -= 0.10;
        rejectReasons.push('mtf_conflicting: -0.10');
      }
    }

    if (marketRegime && marketRegime.available) {
      if (marketRegime.regime === 'risk_on' && tradeBias === 'long') {
        qualScore += 0.03;
        qualityReasons.push('regime_risk_on: +0.03');
      } else if (marketRegime.regime === 'risk_off' && tradeBias === 'long') {
        qualScore -= 0.08;
        rejectReasons.push('regime_risk_off: -0.08');
      } else if (marketRegime.regime === 'risk_on' && tradeBias === 'short') {
        qualScore -= 0.05;
        rejectReasons.push('regime_risk_on_vs_short: -0.05');
      }
    }

    if (isCounterTrend) {
      qualScore -= 0.05;
      rejectReasons.push('counter_trend: -0.05');
    }

    if (qualScore >= 0.65) setupQuality = 'high';
    else if (qualScore > 0.52) setupQuality = 'medium';
    else if (qualScore >= 0.40) setupQuality = 'low';
    else setupQuality = 'rejected';
  }

  return {
    tradeBias,
    setupQuality,
    entryZone,
    stopPrice,
    takeProfitLevels,
    riskRewardEstimate,
    trendAlignment,
    isCounterTrend,
    rejectReasons,
    qualityReasons,
  };
}

module.exports = { computeTradeQualification };
