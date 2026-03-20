'use strict';

/**
 * bybitContext — bridge between the Bybit adapter and the analysis engine.
 *
 * Fetches ticker snapshot, funding history, and open interest from Bybit
 * concurrently, then produces:
 *   1. A normalized BybitContextData shape for display/debugging
 *   2. A confidence delta via computeBybitContextAdjustment() (pure, unit-tested)
 *
 * Design principles (mirrors perpContext.js):
 *  - Entirely optional: if Bybit is unavailable, returns neutral context silently.
 *  - Complementary to CoinGlass: only activated when CoinGlass perpContext is absent
 *    (plan-restricted or no API key), preventing double-counting of the same signals.
 *  - Resilient: each Bybit fetch is individually caught via Promise.allSettled.
 *    Partial results are still applied conservatively; total failures return neutral.
 *  - Never throws: all errors are captured and surfaced as warnings in the result.
 *  - Pure boundary: the rest of the engine only sees the normalized BybitContextData
 *    shape; raw Bybit shapes do not leak upstream.
 *
 * ── Confidence adjustment rules (conservative) ───────────────────────────────
 *
 * Applied only to breakout_watch and pullback_watch signals.
 * no_trade and bearish_breakdown_watch: context is informational only.
 *
 * Source 1 — Funding bias (from averageFunding over 24 settlements ≈ 8 days):
 *   breakout_watch:
 *     long_crowded    → -0.03  (longs crowded at breakout: mean-reversion risk)
 *     neutral_positive→ -0.01
 *     short_crowded   → +0.03  (shorts crowded: squeeze potential)
 *     neutral_negative→ +0.01
 *   pullback_watch:
 *     long_crowded    → -0.02  (selling into crowded longs)
 *     short_crowded   → +0.02  (crowded shorts may fuel bounce)
 *
 * Source 2 — OI regime (from open interest history):
 *   breakout_watch:
 *     strong_expansion → +0.03  (rising participation = conviction)
 *     expansion        → +0.02
 *     contraction      → -0.02  (losing participation = fragile breakout)
 *     strong_contraction→-0.03
 *   pullback_watch:
 *     expanding (any)  → +0.01  (participation intact during pullback)
 *     contracting (any)→ -0.01  (losing participation = pullback may deepen)
 *
 * Total Bybit delta is capped at [-0.05, +0.05].
 * Long/short ratio is fetched for display but NOT used in confidence yet
 * (requires more calibration before it can be reliably applied).
 */

const { getTickerContext }       = require('../adapters/bybit/tickers');
const { getFundingContext }      = require('../adapters/bybit/funding');
const { getOpenInterestContext } = require('../adapters/bybit/openInterest');
const { getLongShortContext }    = require('../adapters/bybit/longShort');
const { normalizeBybitSymbol }   = require('../adapters/bybit/normalize');

const BYBIT_DELTA_CAP = 0.05;

/**
 * Neutral Bybit context returned when the adapter is unavailable.
 *
 * @returns {BybitContextData}
 */
function neutralBybitContext() {
  return {
    liveFundingRate:  null,
    averageFunding:   null,
    fundingBias:      null,
    fundingRegime:    null,
    oiTrend:          null,
    oiExpansion:      null,
    oiRegime:         null,
    crowdBias:        null,
    crowdingRisk:     null,
    markPrice:        null,
    openInterest:     null,
    openInterestValue:null,
    available:        false,
    warnings:         [],
    raw: { ticker: null, funding: null, oi: null, longShort: null },
  };
}

/**
 * @typedef {object} BybitContextData
 * @property {number|null}  liveFundingRate   - Predicted funding rate for next settlement (from ticker)
 * @property {number|null}  averageFunding    - Mean funding rate over last 24 settlements (~8 days)
 * @property {string|null}  fundingBias       - 'long_crowded' | 'neutral_positive' | 'neutral' | 'neutral_negative' | 'short_crowded'
 * @property {string|null}  fundingRegime     - 'extremely_crowded_long' | 'crowded_long' | 'balanced' | 'crowded_short' | 'extremely_crowded_short'
 * @property {string|null}  oiTrend           - 'expanding' | 'stable' | 'contracting' | 'insufficient_data'
 * @property {number|null}  oiExpansion       - OI percentage change (e.g. +4.5 means +4.5%)
 * @property {string|null}  oiRegime          - 'strong_expansion' | 'expansion' | 'stable' | 'contraction' | 'strong_contraction'
 * @property {string|null}  crowdBias         - Long/short crowd label (informational only)
 * @property {string|null}  crowdingRisk      - 'high' | 'moderate' | 'low' (informational only)
 * @property {number|null}  markPrice         - Mark price from Bybit
 * @property {number|null}  openInterest      - Current OI in native token
 * @property {number|null}  openInterestValue - Current OI in USDT
 * @property {boolean}      available         - True if at least one endpoint returned data
 * @property {string[]}     warnings          - Non-fatal issues from individual fetches
 * @property {object}       raw               - Raw normalized Bybit objects for debugging
 */

/**
 * Compute the confidence adjustment delta from Bybit perp context.
 *
 * This is a pure function — no API calls, no side effects.
 * Designed to be unit-tested directly.
 *
 * @param {object} params
 * @param {string|null} params.fundingBias   - From fundingContext.fundingBias
 * @param {string|null} params.oiRegime      - From oiContext.oiRegime
 * @param {string}      params.signal        - Current signal classification
 * @returns {{ adjustment: number, reasons: string[] }}
 */
function computeBybitContextAdjustment({ fundingBias, oiRegime, signal }) {
  // Only adjust actionable bullish signals
  if (signal !== 'breakout_watch' && signal !== 'pullback_watch') {
    return { adjustment: 0, reasons: [] };
  }

  const reasons = [];
  let delta = 0;

  // ── Source 1: Funding bias ─────────────────────────────────────────────────
  if (fundingBias) {
    if (signal === 'breakout_watch') {
      if (fundingBias === 'long_crowded') {
        delta += -0.03;
        reasons.push('bybit_funding_long_crowded_breakout_watch: -0.03');
      } else if (fundingBias === 'neutral_positive') {
        delta += -0.01;
        reasons.push('bybit_funding_neutral_positive_breakout_watch: -0.01');
      } else if (fundingBias === 'short_crowded') {
        delta += 0.03;
        reasons.push('bybit_funding_short_crowded_breakout_watch: +0.03');
      } else if (fundingBias === 'neutral_negative') {
        delta += 0.01;
        reasons.push('bybit_funding_neutral_negative_breakout_watch: +0.01');
      }
    } else if (signal === 'pullback_watch') {
      if (fundingBias === 'long_crowded') {
        delta += -0.02;
        reasons.push('bybit_funding_long_crowded_pullback_watch: -0.02');
      } else if (fundingBias === 'short_crowded') {
        delta += 0.02;
        reasons.push('bybit_funding_short_crowded_pullback_watch: +0.02');
      }
    }
  }

  // ── Source 2: OI regime ────────────────────────────────────────────────────
  if (oiRegime) {
    if (signal === 'breakout_watch') {
      if (oiRegime === 'strong_expansion') {
        delta += 0.03;
        reasons.push('bybit_oi_strong_expansion_breakout_watch: +0.03');
      } else if (oiRegime === 'expansion') {
        delta += 0.02;
        reasons.push('bybit_oi_expansion_breakout_watch: +0.02');
      } else if (oiRegime === 'contraction') {
        delta += -0.02;
        reasons.push('bybit_oi_contraction_breakout_watch: -0.02');
      } else if (oiRegime === 'strong_contraction') {
        delta += -0.03;
        reasons.push('bybit_oi_strong_contraction_breakout_watch: -0.03');
      }
    } else if (signal === 'pullback_watch') {
      if (oiRegime === 'expansion' || oiRegime === 'strong_expansion') {
        delta += 0.01;
        reasons.push('bybit_oi_expanding_pullback_watch: +0.01');
      } else if (oiRegime === 'contraction' || oiRegime === 'strong_contraction') {
        delta += -0.01;
        reasons.push('bybit_oi_contracting_pullback_watch: -0.01');
      }
    }
  }

  // Apply cap
  const capped = Math.max(-BYBIT_DELTA_CAP, Math.min(BYBIT_DELTA_CAP, delta));

  return { adjustment: parseFloat(capped.toFixed(2)), reasons };
}

/**
 * Fetch and normalize Bybit perp context for a given symbol.
 *
 * Fetches ticker, funding, open interest, and long/short concurrently.
 * Individual fetch failures are captured as warnings and result in null fields —
 * the rest of the context is still returned and applied where available.
 *
 * Never throws.
 *
 * @param {string} symbol           - Raw symbol string (e.g. 'BINANCE:BTCUSDT.P', 'BTCUSDT')
 * @param {object} [options]
 * @param {string} [options.category='linear']  - Bybit category
 * @param {number} [options.timeoutMs=10000]    - Per-request timeout
 * @returns {Promise<BybitContextData>}
 */
async function fetchBybitContext(symbol, options = {}) {
  const bybitSymbol = normalizeBybitSymbol(symbol);
  if (!bybitSymbol) return neutralBybitContext();

  const category  = options.category  || 'linear';
  const timeoutMs = options.timeoutMs || undefined;

  const [tickerResult, fundingResult, oiResult, lsResult] = await Promise.allSettled([
    getTickerContext(bybitSymbol,       { category, timeoutMs }),
    getFundingContext(bybitSymbol,      { category, timeoutMs }),
    getOpenInterestContext(bybitSymbol, { category, timeoutMs }),
    getLongShortContext(bybitSymbol,    { category, timeoutMs }),
  ]);

  const warnings = [];

  const ticker    = tickerResult.status   === 'fulfilled' ? tickerResult.value   : null;
  const funding   = fundingResult.status  === 'fulfilled' ? fundingResult.value  : null;
  const oi        = oiResult.status       === 'fulfilled' ? oiResult.value       : null;
  const longShort = lsResult.status       === 'fulfilled' ? lsResult.value       : null;

  if (tickerResult.status   === 'rejected') warnings.push(`bybit_ticker_unavailable: ${tickerResult.reason?.code || 'error'}`);
  if (fundingResult.status  === 'rejected') warnings.push(`bybit_funding_unavailable: ${fundingResult.reason?.code || 'error'}`);
  if (oiResult.status       === 'rejected') warnings.push(`bybit_oi_unavailable: ${oiResult.reason?.code || 'error'}`);
  if (lsResult.status       === 'rejected') warnings.push(`bybit_ls_unavailable: ${lsResult.reason?.code || 'error'}`);

  // Propagate non-fatal warnings from individual adapters
  for (const ctx of [ticker, funding, oi, longShort]) {
    if (ctx?.warnings?.length) warnings.push(...ctx.warnings);
  }

  const available = ticker !== null || funding !== null || oi !== null;

  return {
    liveFundingRate:   ticker?.fundingRate   ?? null,
    averageFunding:    funding?.averageFunding ?? null,
    fundingBias:       funding?.fundingBias   ?? null,
    fundingRegime:     funding?.fundingRegime ?? null,
    oiTrend:           oi?.oiTrend           ?? null,
    oiExpansion:       oi?.oiExpansion       ?? null,
    oiRegime:          oi?.oiRegime          ?? null,
    crowdBias:         longShort?.crowdBias    ?? null,
    crowdingRisk:      longShort?.crowdingRisk ?? null,
    markPrice:         ticker?.markPrice      ?? null,
    openInterest:      oi?.currentOI          ?? ticker?.openInterest ?? null,
    openInterestValue: ticker?.openInterestValue ?? null,
    available,
    warnings,
    raw: { ticker, funding, oi, longShort },
  };
}

module.exports = { fetchBybitContext, computeBybitContextAdjustment, neutralBybitContext };
