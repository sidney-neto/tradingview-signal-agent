'use strict';

/**
 * marketRegime — consolidated crypto market regime assessment.
 *
 * Combines available context signals (CoinGlass macro, CoinGecko breadth,
 * Bybit OI) into a single regime classification and per-dimension state.
 *
 * Design principles:
 *  - Pure: no network calls. Operates on already-fetched context objects.
 *  - Graceful degradation: returns 'neutral' when no context is available.
 *  - Conservative majority: requires ≥2 risk_off signals for a risk_off regime
 *    (avoids false alarms from a single stale data point).
 *  - Informational: each dimension (btcStructure, fearGreedState, etc.) is
 *    returned separately so callers can present granular regime details.
 *
 * Regime is used by tradeQualification.js to adjust setupQuality — not for
 * direct confidence arithmetic (that happens in analyzeMarket.js overlays).
 */

/**
 * Compute market regime from available context objects.
 *
 * All parameters are optional. Pass whichever are available; the function
 * degrades gracefully when fields are absent or null.
 *
 * @param {object} [params]
 * @param {object|null} [params.perpContext]          - CoinGlass perp context (has fearGreedIndex, btcDominance, altcoinIndex)
 * @param {object|null} [params.macroContext]         - CoinGlass macro context (has fearGreed.value, bitcoinDominance, altcoinSeason)
 * @param {object|null} [params.marketBreadthContext] - CoinGecko breadth (has regime, gainersPercent)
 * @param {object|null} [params.bybitContext]         - Bybit context (informational; not used for regime classification currently)
 * @returns {{
 *   regime: 'risk_on'|'risk_off'|'neutral'|'overheated',
 *   btcStructure: 'dominant'|'declining'|'neutral'|null,
 *   fearGreedState: 'extreme_fear'|'fear'|'neutral'|'greed'|'extreme_greed'|null,
 *   altcoinConditions: 'favorable'|'unfavorable'|'neutral'|null,
 *   available: boolean,
 *   reasons: string[],
 * }}
 */
function computeMarketRegime({
  perpContext          = null,
  macroContext         = null,
  marketBreadthContext = null,
  bybitContext         = null,   // reserved for future use
} = {}) {
  const signals = [];
  const reasons = [];

  // ── Signal 1: CoinGecko breadth regime ──────────────────────────────────
  if (marketBreadthContext?.regime) {
    if (marketBreadthContext.regime === 'risk_on') {
      signals.push('risk_on');
      const pct = marketBreadthContext.gainersPercent != null
        ? `${marketBreadthContext.gainersPercent.toFixed(0)}% gainers`
        : '';
      reasons.push(`breadth_risk_on${pct ? `(${pct})` : ''}`);
    } else if (marketBreadthContext.regime === 'risk_off') {
      signals.push('risk_off');
      const pct = marketBreadthContext.gainersPercent != null
        ? `${marketBreadthContext.gainersPercent.toFixed(0)}% gainers`
        : '';
      reasons.push(`breadth_risk_off${pct ? `(${pct})` : ''}`);
    }
  }

  // ── Signal 2: Fear & Greed index ─────────────────────────────────────────
  // Accept from macroContext (preferred) or perpContext (fallback)
  const fg = macroContext?.fearGreed?.value ?? perpContext?.fearGreedIndex;
  let fearGreedState = null;

  if (fg != null && !isNaN(fg)) {
    if (fg <= 25) {
      fearGreedState = 'extreme_fear';
      signals.push('risk_off');
      reasons.push(`fear_greed_extreme_fear(${fg})`);
    } else if (fg <= 40) {
      fearGreedState = 'fear';
      signals.push('risk_off');
      reasons.push(`fear_greed_fear(${fg})`);
    } else if (fg >= 75) {
      fearGreedState = 'extreme_greed';
      signals.push('overheated');
      reasons.push(`fear_greed_extreme_greed(${fg})`);
    } else if (fg >= 60) {
      fearGreedState = 'greed';
      signals.push('risk_on');
      reasons.push(`fear_greed_greed(${fg})`);
    } else {
      fearGreedState = 'neutral';
    }
  }

  // ── Signal 3: BTC dominance ──────────────────────────────────────────────
  // Accept from macroContext (preferred) or perpContext (fallback)
  const btcDom = macroContext?.bitcoinDominance ?? perpContext?.btcDominance;
  let btcStructure = null;

  if (btcDom != null && !isNaN(btcDom)) {
    if (btcDom > 55) {
      btcStructure = 'dominant';
      signals.push('risk_off');
      reasons.push(`btc_dominance_high(${btcDom.toFixed(1)}%)`);
    } else if (btcDom < 45) {
      btcStructure = 'declining';
      signals.push('risk_on');
      reasons.push(`btc_dominance_low(${btcDom.toFixed(1)}%)`);
    } else {
      btcStructure = 'neutral';
    }
  }

  // ── Signal 4: Altcoin season index ───────────────────────────────────────
  const altIdx = macroContext?.altcoinSeason ?? perpContext?.altcoinIndex;
  let altcoinConditions = null;

  if (altIdx != null && !isNaN(altIdx)) {
    if (altIdx >= 75) {
      altcoinConditions = 'favorable';
      signals.push('risk_on');
      reasons.push(`altcoin_season_active(${altIdx})`);
    } else if (altIdx <= 25) {
      altcoinConditions = 'unfavorable';
      signals.push('risk_off');
      reasons.push(`altcoin_season_low(${altIdx})`);
    } else {
      altcoinConditions = 'neutral';
    }
  }

  const available      = signals.length > 0;
  const riskOnCount    = signals.filter((s) => s === 'risk_on').length;
  const riskOffCount   = signals.filter((s) => s === 'risk_off').length;
  const overheated     = signals.some((s) => s === 'overheated');

  // ── Resolve regime ────────────────────────────────────────────────────────
  // Conservative: uncontested signals classify directly; contested signals
  // require a net majority of ≥ 2 to avoid false regime calls from a single
  // opposing data point.
  let regime;

  if (!available) {
    regime = 'neutral';
  } else if (overheated && riskOffCount === 0 && riskOnCount === 0) {
    regime = 'overheated';
  } else if (riskOnCount === 0 && riskOffCount > 0) {
    // Uncontested risk-off
    regime = 'risk_off';
  } else if (riskOffCount === 0 && riskOnCount > 0) {
    // Uncontested risk-on
    regime = 'risk_on';
  } else {
    // Both directions present — require net ≥ 2 to overcome opposition
    const net = riskOffCount - riskOnCount;
    if (net >= 2) regime = 'risk_off';
    else if (net <= -2) regime = 'risk_on';
    else regime = 'neutral';
  }

  return {
    regime,
    btcStructure,
    fearGreedState,
    altcoinConditions,
    available,
    reasons,
  };
}

module.exports = { computeMarketRegime };
