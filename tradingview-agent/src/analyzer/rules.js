'use strict';

/**
 * Deterministic classification rules for trend, momentum, volume, volatility, and signal.
 *
 * All functions take normalized indicator values and return simple string labels.
 * Logic is intentionally explicit and auditable.
 */

const defaults = require('../config/defaults');

// ─────────────────────────────────────────────────────────────────────────────
// Trend classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify market trend based on price vs EMAs and MA alignment.
 *
 * @param {object} params
 * @param {number} price
 * @param {number|null} ema20
 * @param {number|null} ema50
 * @param {number|null} ema100
 * @param {number|null} ema200
 * @param {number|null} ma200
 * @param {object|null} trendlineState
 * @returns {string} trend label
 */
function classifyTrend({ price, ema20, ema50, ema100, ema200, ma200, trendlineState }) {
  const aboveEma20  = ema20  != null && !isNaN(ema20)  && price > ema20;
  const aboveEma50  = ema50  != null && !isNaN(ema50)  && price > ema50;
  const aboveEma100 = ema100 != null && !isNaN(ema100) && price > ema100;
  const aboveEma200 = ema200 != null && !isNaN(ema200) && price > ema200;
  const aboveMa200  = ma200  != null && !isNaN(ma200)  && price > ma200;

  const bullishCount = [aboveEma20, aboveEma50, aboveEma100, aboveEma200, aboveMa200].filter(Boolean).length;
  const total        = [ema20, ema50, ema100, ema200, ma200].filter((v) => v != null && !isNaN(v)).length;

  if (total === 0) return 'unknown';

  // Check MA alignment (short above long)
  const emasOrdered =
    ema20 != null && ema50 != null && ema100 != null && ema200 != null &&
    ema20 > ema50 && ema50 > ema100 && ema100 > ema200;
  const emasDisordered =
    ema20 != null && ema50 != null && ema100 != null && ema200 != null &&
    ema20 < ema50 && ema50 < ema100 && ema100 < ema200;

  const ratio = bullishCount / total;

  if (ratio === 1 && emasOrdered)    return 'strong_bullish';
  if (ratio >= 0.8)                  return 'bullish';
  if (ratio === 0 && emasDisordered) return 'strong_bearish';
  if (ratio <= 0.2)                  return 'bearish';
  if (ratio >= 0.5)                  return 'neutral_bullish';
  if (ratio < 0.5)                   return 'neutral_bearish';
  return 'neutral';
}

// ─────────────────────────────────────────────────────────────────────────────
// Momentum classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify momentum from RSI and related signals.
 *
 * @param {object} params
 * @param {number|null} rsi14
 * @param {string} volumeState  - classifyVolume result
 * @param {string} trendlineBreak - 'bullish_break' | 'bearish_break' | 'none'
 * @param {string} zoneType     - 'consolidation' | 'accumulation' | 'none'
 * @returns {string} momentum label
 */
function classifyMomentum({ rsi14, volumeState, trendlineBreak, zoneType }) {
  if (rsi14 == null || isNaN(rsi14)) return 'unknown';

  let baseLabel;
  if (rsi14 >= 75)      baseLabel = 'overextended_bullish';
  else if (rsi14 >= 60) baseLabel = 'bullish';
  else if (rsi14 >= 50) baseLabel = 'neutral_bullish';
  else if (rsi14 >= 40) baseLabel = 'neutral_bearish';
  else if (rsi14 >= 25) baseLabel = 'bearish';
  else                  baseLabel = 'oversold_bearish';

  // Adjust slightly for contextual signals
  const highVolume     = volumeState === 'high' || volumeState === 'very_high';
  const bullishContext = trendlineBreak === 'bullish_break' || zoneType === 'accumulation';
  const bearishContext = trendlineBreak === 'bearish_break';

  if (baseLabel === 'neutral_bullish' && highVolume && bullishContext) return 'bullish';
  if (baseLabel === 'neutral_bearish' && highVolume && bearishContext) return 'bearish';

  return baseLabel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pullback validation helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate whether current conditions represent a valid bullish pullback opportunity.
 *
 * A pullback setup means: the market remains structurally bullish, but price has
 * retraced into a support zone or mean-reversion territory in a way that could
 * offer a continuation opportunity if support holds.
 *
 * HARD REQUIREMENTS (all must pass):
 *  1. Trend is bullish or strong_bullish
 *  2. Price is above EMA100 (medium-term structural floor — if EMA100 available)
 *  3. Momentum is cooled but not collapsed:
 *       - neutral_bullish (RSI 50–59): early pullback or cooling from higher
 *       - neutral_bearish (RSI 40–49): classic pullback territory
 *       - bearish        (RSI 25–39): acceptable only when bullish line is intact
 *       - bullish        (RSI 60–74): only acceptable when price already broke below EMA20
 *       - overextended/oversold: never acceptable
 *  4. Retracement evidence (at least one of):
 *       - Price is below EMA20 (short-term mean)
 *       - Price has retraced ≥ PULLBACK_RETRACEMENT_ATR_MIN ATR from last confirmed pivot high
 *  5. No structural collapse:
 *       - Broken bullish trendline + bearish/oversold momentum → reject
 *       - Fresh bearish trendline break + bearish/oversold momentum → reject
 *
 * CONFIDENCE FACTORS (applied if hard requirements pass):
 *  +0.10 if price is near a support level (EMA20, EMA50, or bullish trendline)
 *  +0.05 if bullish trendline is intact
 *  +0.05 if price is clearly below EMA20 (unambiguous retracement)
 *  -0.05 if a recent bearish trendline break occurred (line broke but structure holding)
 *  floor: 0.30
 *
 * @param {object} params
 * @param {string} params.trend
 * @param {string} params.momentum
 * @param {object|null} params.trendlineState
 * @param {{ ema20, ema50, ema100, atr14, [key: string]: any }} params.indicators
 * @param {number} params.currentPrice
 * @returns {{ valid: boolean, reason?: string, factors: object }}
 */
function isValidBullishPullback({ trend, momentum, trendlineState, indicators, currentPrice }) {
  const { ema20, ema50, ema100, atr14 } = indicators || {};
  const factors = {};

  // Guard: price data required
  if (!currentPrice) return { valid: false, reason: 'no_price_data', factors };

  // ── 1. Trend backbone ────────────────────────────────────────────────────
  const trendBullish = trend === 'bullish' || trend === 'strong_bullish';
  if (!trendBullish) {
    return { valid: false, reason: 'trend_not_bullish', factors };
  }

  // ── 2. EMA100 structural floor ───────────────────────────────────────────
  // Only enforced when EMA100 is available. Below EMA100 in a nominally bullish
  // trend means the medium-term structure is already compromised.
  const ema100Available = ema100 != null && !isNaN(ema100);
  if (ema100Available && currentPrice < ema100) {
    return { valid: false, reason: 'below_ema100_structural_floor', factors };
  }

  // ── 3. Momentum cooled, not hot ──────────────────────────────────────────
  const ema20Available  = ema20 != null && !isNaN(ema20);
  const priceBelowEma20 = ema20Available && currentPrice < ema20;
  factors.priceBelowEma20 = priceBelowEma20;

  // Acceptable momentum states for a pullback
  const momentumCooled = (
    momentum === 'neutral_bullish' ||  // RSI 50–59: early pullback / cooling
    momentum === 'neutral_bearish' ||  // RSI 40–49: classic pullback territory
    momentum === 'bearish'             // RSI 25–39: acceptable when line is intact (see hard reject below)
  );

  // 'bullish' (RSI 60–74) is acceptable ONLY if price has clearly broken below EMA20,
  // which confirms the retracement is real rather than a hot continuation.
  const momentumOk = momentumCooled || (momentum === 'bullish' && priceBelowEma20);

  if (!momentumOk) {
    // overextended_bullish, oversold_bearish, or bullish without EMA20 breach
    return { valid: false, reason: 'momentum_not_cooled', factors };
  }

  // ── 4. Retracement evidence ──────────────────────────────────────────────
  const touchAtr = (atr14 != null && !isNaN(atr14)) ? atr14 : null;
  const latestPivotHigh = trendlineState?.pivotContext?.latestPivotHigh;

  let retraceFromHighAtr = null;
  if (latestPivotHigh && touchAtr) {
    retraceFromHighAtr = (latestPivotHigh.price - currentPrice) / touchAtr;
  }
  const hasRetracedFromHigh = retraceFromHighAtr !== null &&
    retraceFromHighAtr >= defaults.PULLBACK_RETRACEMENT_ATR_MIN;

  factors.retraceFromHighAtr   = retraceFromHighAtr;
  factors.hasRetracedFromHigh  = hasRetracedFromHigh;

  const hasRetracement = priceBelowEma20 || hasRetracedFromHigh;
  if (!hasRetracement) {
    return { valid: false, reason: 'no_retracement_evidence', factors };
  }

  // ── 5. Support interaction (preferred, not hard-required) ────────────────
  const ema50Available = ema50 != null && !isNaN(ema50);
  const supportThresh  = touchAtr ? touchAtr * defaults.PULLBACK_SUPPORT_ATR_FRACTION : null;

  const nearEma20 = ema20Available && supportThresh !== null &&
    Math.abs(currentPrice - ema20) <= supportThresh;
  const nearEma50 = ema50Available && supportThresh !== null &&
    Math.abs(currentPrice - ema50) <= supportThresh;
  const bullishLineIntact = !!(
    trendlineState?.bullishTrendline && !trendlineState.bullishTrendline.isBroken
  );

  factors.nearEma20            = nearEma20;
  factors.nearEma50            = nearEma50;
  factors.bullishLineIntact    = bullishLineIntact;
  factors.hasSupportInteraction = nearEma20 || nearEma50 || bullishLineIntact;

  // ── Hard rejects (structural collapse) ──────────────────────────────────
  // 'bearish' and 'oversold_bearish' both indicate momentum collapse severe
  // enough to reject a pullback read when combined with structural damage.
  const momentumCollapsed = momentum === 'bearish' || momentum === 'oversold_bearish';

  const bullishLineBroken  = trendlineState?.bullishTrendline?.isBroken === true;
  const freshBearishBreak  = !!(
    trendlineState?.lineBreakDetected &&
    trendlineState?.lineBreakDirection === 'bearish_break'
  );

  factors.bullishLineBroken = bullishLineBroken;
  factors.freshBearishBreak = freshBearishBreak;

  // Broken bullish support line + collapsed momentum = structure failure, not pullback
  if (bullishLineBroken && momentumCollapsed) {
    return { valid: false, reason: 'structure_failure_broken_line_and_collapsed_momentum', factors };
  }

  // Fresh bearish break + collapsed momentum = active breakdown, not pullback
  if (freshBearishBreak && momentumCollapsed) {
    return { valid: false, reason: 'fresh_bearish_breakdown_with_collapsed_momentum', factors };
  }

  return { valid: true, factors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto-perpetual context extension point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a crypto-perpetual market context adjustment for pullback_watch confidence.
 *
 * CURRENT STATUS: All external context fields are optional and unimplemented.
 * This function returns a neutral (zero-adjustment) result when no data is provided.
 * It exists as a deliberate extension point so future callers can wire in live
 * data without redesigning the signal pipeline.
 *
 * HOW FUTURE SIGNALS SHOULD INFLUENCE pullback_watch:
 *
 *  fundingRate:
 *    - Very positive (e.g. > 0.05%/8h): reduce confidence by 0.05–0.10.
 *      Overcrowded long positions make pullbacks more likely to flush deeper.
 *    - Negative or near-zero during bullish structure: increase confidence by 0.05.
 *      Funding cooling suggests longs are being flushed — cleaner entry environment.
 *
 *  fearGreedIndex:
 *    - < 30 (Fear zone): improve pullback quality for structurally strong assets.
 *      Capitulation-driven pullbacks in healthy trends often offer better entries.
 *    - > 80 (Greed zone): reduce confidence. Euphoric markets tend to produce
 *      deeper-than-expected pullbacks when they occur.
 *
 *  btcDominance (BTC.D):
 *    - Rising BTC dominance: reduce confidence for altcoin perpetual pullbacks.
 *      Capital is rotating toward BTC — altcoin pullbacks may extend further.
 *    - Falling BTC dominance: neutral or slight boost for altcoin pullbacks.
 *
 *  usdtDominance / usdcDominance:
 *    - Rising USDT.D or USDC.D: reduce confidence. Capital is rotating to stablecoins,
 *      indicating risk-off sentiment that undermines pullback continuation odds.
 *
 *  totalMarketCap (TOTAL / TOTAL2 / TOTAL3):
 *    - TOTAL2 (ex-BTC) or TOTAL3 (ex-BTC/ETH) in a rising trend: improve altcoin
 *      pullback quality — broad market is supportive.
 *    - Declining TOTAL: reduce confidence — macro headwinds.
 *
 *  altcoinIndex:
 *    - > 75 (Altcoin season): improve confidence for altcoin perpetual pullbacks
 *      within a trending structure.
 *    - < 25: reduce confidence — BTC-dominated regime, altcoin pullbacks often fail.
 *
 *  macdSignal:
 *    - 'bullish' (histogram rising, signal crossover): improve confidence.
 *    - 'bearish': reduce confidence.
 *    - 'neutral': no adjustment.
 *
 * @param {object} [ctx]
 * @param {number|null}  [ctx.fundingRate]      Current funding rate (decimal, e.g. 0.0001 = 0.01%)
 * @param {string|null}  [ctx.fundingBias]      'long_crowded' | 'short_crowded' | 'neutral'
 * @param {string|null}  [ctx.oiTrend]          'rising' | 'falling' | 'flat'
 * @param {number|null}  [ctx.fearGreedIndex]   0–100 crypto fear & greed index
 * @param {number|null}  [ctx.btcDominance]     BTC.D percentage (e.g. 52.4)
 * @param {number|null}  [ctx.altcoinIndex]     Altcoin season index 0–100
 * @param {boolean}      [ctx.isAltcoin]        Whether the symbol is an altcoin (gates dominance/season rules)
 * @param {string|null}  [ctx.signal]           Current signal label — gates OI and some macro rules
 * @returns {{ confidenceAdjustment: number, reasons: string[], warnings: string[], available: boolean }}
 *
 * ⚠️  LIVE VALIDATION REQUIRED
 * Thresholds derived from API documentation, not live data.
 * Validate against real CoinGlass responses before relying on these in production.
 */
function computePullbackContext(ctx = {}) {
  const {
    fundingRate,
    oiTrend,
    fearGreedIndex,
    btcDominance,
    altcoinIndex,
    isAltcoin = false,
    signal    = null,
  } = ctx;

  let adj = 0;
  const reasons  = [];
  const warnings = [];

  // Return early if no data was provided at all
  const hasData = (
    fundingRate    != null ||
    oiTrend        != null ||
    fearGreedIndex != null ||
    btcDominance   != null ||
    altcoinIndex   != null
  );
  if (!hasData) {
    return { confidenceAdjustment: 0, reasons, warnings, available: false };
  }

  // ── 1. Funding rate ───────────────────────────────────────────────────────
  // Applies to pullback_watch and breakout_watch only.
  // Very positive funding = crowded longs = pullbacks tend to flush deeper.
  // Near-zero or negative funding = longs washed out = cleaner entry environment.
  if (
    fundingRate != null && !isNaN(fundingRate) &&
    (signal === 'pullback_watch' || signal === 'breakout_watch')
  ) {
    if (fundingRate >= 0.001) {
      adj -= 0.10;
      reasons.push(`funding_extreme_long(${(fundingRate * 100).toFixed(4)}%): -0.10`);
    } else if (fundingRate >= 0.0003) {
      adj -= 0.05;
      reasons.push(`funding_long_heavy(${(fundingRate * 100).toFixed(4)}%): -0.05`);
    } else if (fundingRate < -0.0001) {
      adj += 0.05;
      reasons.push(`funding_short_heavy(${(fundingRate * 100).toFixed(4)}%): +0.05`);
    }
  }

  // ── 2. Open interest trend ────────────────────────────────────────────────
  // Expanding OI on a breakout = new money entering = more conviction.
  // Contracting OI during any bullish setup = fading participation.
  if (oiTrend != null) {
    if (oiTrend === 'rising' && signal === 'breakout_watch') {
      adj += 0.05;
      reasons.push('oi_expanding_on_breakout: +0.05');
    } else if (oiTrend === 'falling' && (signal === 'pullback_watch' || signal === 'breakout_watch')) {
      adj -= 0.03;
      reasons.push('oi_contracting: -0.03');
    }
  }

  // ── 3. Fear & Greed ───────────────────────────────────────────────────────
  // Applies to pullback_watch only — most meaningful for mean-reversion entries.
  // Extreme fear + structurally valid pullback = capitulation-driven entry, often better.
  // Extreme greed = late/crowded market, pullbacks tend to overshoot.
  if (fearGreedIndex != null && !isNaN(fearGreedIndex) && signal === 'pullback_watch') {
    if (fearGreedIndex <= 25) {
      adj += 0.05;
      reasons.push(`fear_greed_extreme_fear(${fearGreedIndex}): +0.05`);
    } else if (fearGreedIndex >= 75) {
      adj -= 0.05;
      reasons.push(`fear_greed_greed(${fearGreedIndex}): -0.05`);
    }
  }

  // ── 4. BTC Dominance (altcoins only) ─────────────────────────────────────
  // High BTC.D = capital concentrating in BTC. Altcoin pullbacks in this
  // environment tend to extend further or fail to resume.
  if (btcDominance != null && !isNaN(btcDominance) && isAltcoin) {
    if (btcDominance > 55) {
      adj -= 0.05;
      reasons.push(`btc_dominance_high(${btcDominance.toFixed(1)}%): -0.05`);
    }
  }

  // ── 5. Altcoin Season Index (altcoins only) ───────────────────────────────
  // High altcoin season = broad alt rotation underway = constructive setups more likely to follow through.
  // Low altcoin season = BTC-dominated regime = alt pullbacks often fail.
  if (altcoinIndex != null && !isNaN(altcoinIndex) && isAltcoin) {
    if (altcoinIndex >= 75) {
      adj += 0.05;
      reasons.push(`altcoin_season_active(${altcoinIndex}): +0.05`);
    } else if (altcoinIndex <= 25) {
      adj -= 0.05;
      reasons.push(`altcoin_season_low(${altcoinIndex}): -0.05`);
    }
  }

  // Cap: asymmetric — penalties allowed slightly more room than boosts, because
  // CoinGlass is an overlay on top of an already structure-validated candle signal.
  const confidenceAdjustment = Math.max(-0.20, Math.min(0.15, adj));

  return {
    confidenceAdjustment,
    reasons,
    warnings,
    available: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify the overall setup signal for this bar.
 *
 * SIGNAL PRIORITY ORDER (MVP v1 deliberate design)
 * -------------------------------------------------
 * This function uses a sequential if/else waterfall. The order below is intentional:
 * the first matching condition wins and no lower-priority conditions are evaluated.
 * This is a conscious MVP v1 trade-off for simplicity and auditability over exhaustive
 * multi-factor scoring. The priority order is:
 *
 *  1. breakout_watch  — bullish trendline break with bullish trend alignment
 *  2. breakout_watch  — accumulation zone with bullish structure emerging
 *  3. pullback_watch  — valid bullish pullback (see isValidBullishPullback):
 *                       requires bullish trend + EMA100 floor + cooled momentum +
 *                       retracement evidence + no structural collapse
 *  4. bearish_breakdown_watch — bearish trendline break with bearish trend alignment
 *  5. bearish_breakdown_watch — bearish trend + bearish momentum
 *  6. no_trade (explicit, confident) — consolidation zone detected
 *  7. no_trade (default, moderate)   — no other condition matched
 *
 * To change signal priority, re-order the branches below.
 * Do not replace this waterfall with a scoring system until the MVP is stable.
 *
 * @param {object} params
 * @param {string} params.trend
 * @param {string} params.momentum
 * @param {string} params.volumeState
 * @param {string} params.volatilityState
 * @param {object|null} params.trendlineState
 * @param {object|null} params.zoneState
 * @param {object} [params.indicators]        - Raw indicator values { ema20, ema50, ema100, atr14, ... }
 * @param {number} [params.currentPrice]      - Current bar close price
 * @returns {{ signal: string, confidence: number, invalidation: string|null, targets: string[] }}
 */
function classifySignal({
  trend, momentum, volumeState, volatilityState,
  trendlineState, zoneState,
  indicators = {},
  currentPrice,
}) {
  const trendBullish    = trend === 'strong_bullish' || trend === 'bullish';
  const trendBearish    = trend === 'strong_bearish' || trend === 'bearish';
  const momentumBullish = momentum === 'bullish' || momentum === 'neutral_bullish';
  const momentumBearish = momentum === 'bearish'  || momentum === 'neutral_bearish';
  const highVolume      = volumeState === 'high' || volumeState === 'very_high';

  const lineBreak    = trendlineState && trendlineState.lineBreakDetected;
  const lineBreakDir = trendlineState && trendlineState.lineBreakDirection;
  const zoneType     = zoneState && zoneState.zoneType;

  let signal      = 'no_trade';
  let confidence  = 0;
  let invalidation = null;
  const targets   = [];

  // ── 1 & 2. breakout_watch ────────────────────────────────────────────────

  // Breakout above bearish trendline with bullish trend alignment
  if (lineBreak && lineBreakDir === 'bullish_break' && trendBullish) {
    signal     = 'breakout_watch';
    confidence = highVolume ? 0.75 : 0.55;
    invalidation = 'Fechar abaixo da trendline bearish rompida.';
    targets.push('Próxima máxima de swing ou zona de resistência.');
  }

  // Accumulation zone with bullish structure emerging
  else if (zoneType === 'accumulation' && (trendBullish || trend === 'neutral_bullish') && momentumBullish) {
    signal     = 'breakout_watch';
    confidence = 0.50;
    invalidation = 'Fechar abaixo do suporte da zona de acumulação.';
    targets.push('Topo da zona como alvo inicial. Máxima anterior como extensão.');
  }

  // ── 3. pullback_watch ────────────────────────────────────────────────────
  // Delegates to isValidBullishPullback for all qualification logic.
  // Confidence is scored dynamically from quality factors.
  // See isValidBullishPullback() for full criteria documentation.

  else {
    const pullback = isValidBullishPullback({
      trend, momentum, trendlineState, indicators, currentPrice,
    });

    if (pullback.valid) {
      signal = 'pullback_watch';
      const f = pullback.factors;

      // Base confidence — conservative start for a setup with structural uncertainty
      let conf = 0.40;

      // Quality bonuses
      if (f.hasSupportInteraction) conf += 0.10; // price is near a meaningful support level
      if (f.bullishLineIntact)      conf += 0.05; // trendline support adds structural backing
      if (f.priceBelowEma20)        conf += 0.05; // unambiguous short-term retracement

      // Quality penalties
      if (f.freshBearishBreak)      conf -= 0.05; // recent line break — structure partially compromised

      confidence = Math.max(0.30, conf); // floor: always non-trivial if valid

      // Determine invalidation from the nearest live support level
      const { ema50 } = indicators;
      const ema50Valid = ema50 != null && !isNaN(ema50);

      if (f.nearEma50 && ema50Valid) {
        invalidation = `Fechar abaixo da EMA50 (${ema50.toFixed(4)}) — perda do suporte de médio prazo.`;
      } else if (f.nearEma20) {
        const { ema20 } = indicators;
        invalidation = `Fechar abaixo da EMA20 (${(ema20 || 0).toFixed(4)}) — perda do suporte de curto prazo.`;
      } else if (f.bullishLineIntact && trendlineState?.bullishTrendline) {
        const lvl = trendlineState.bullishTrendline.currentLevel;
        invalidation = `Fechar abaixo do suporte da trendline bullish (~${lvl.toFixed(4)}).`;
      } else {
        invalidation = 'Fechar abaixo da mínima de swing anterior ou suporte relevante.';
      }

      if (f.bullishLineIntact) {
        targets.push('Recuperação da EMA20 e teste da máxima de swing anterior.');
      } else {
        targets.push('Recuperação da EMA20 — primeiro alvo de recuperação.');
      }
    }

    // ── 4 & 5. bearish_breakdown_watch ──────────────────────────────────────

    else if (lineBreak && lineBreakDir === 'bearish_break' && trendBearish) {
      signal     = 'bearish_breakdown_watch';
      confidence = highVolume ? 0.70 : 0.50;
      invalidation = 'Recuperar acima da trendline bullish rompida.';
      targets.push('Próxima mínima de swing ou zona de suporte.');
    }

    else if (trendBearish && momentumBearish) {
      signal     = 'bearish_breakdown_watch';
      confidence = 0.50;
      invalidation = 'Recuperar acima da EMA20 ou máxima de swing anterior.';
      targets.push('Teste das mínimas recentes ou range inferior.');
    }

    // ── 6. no_trade — consolidation zone ────────────────────────────────────

    else if (zoneType === 'consolidation') {
      signal     = 'no_trade';
      confidence = 0.60;
      targets.push('Aguardar rompimento direcional do range de consolidação.');
    }
  }

  // ── 7. no_trade default ──────────────────────────────────────────────────
  // For default no_trade (no condition matched), assign a meaningful non-zero confidence
  // rather than 0. A value of 0 is indistinguishable from a system failure to callers.
  // 0.50 means: "moderately confident there is no actionable setup here" — the market is
  // ambiguous or mixed. The consolidation case already sets 0.60 explicitly above.
  if (signal === 'no_trade' && confidence === 0) {
    confidence = 0.50;
  }

  // Normalize confidence
  confidence = Math.min(1, Math.max(0, confidence));

  return { signal, confidence, invalidation, targets };
}

module.exports = {
  classifyTrend,
  classifyMomentum,
  classifySignal,
  isValidBullishPullback,
  computePullbackContext,
};
