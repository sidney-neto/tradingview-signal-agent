'use strict';

/**
 * perpContext — bridge between the CoinGlass adapter and the analysis engine.
 *
 * Fetches funding, open interest, and macro context from CoinGlass concurrently,
 * then normalizes the combined result into the shape that computePullbackContext()
 * (in rules.js) expects.
 *
 * Design principles:
 *  - Entirely optional: if COINGLASS_API_KEY is unset, returns neutral context silently.
 *  - Resilient: each CoinGlass fetch is individually caught via Promise.allSettled.
 *    A partial result is still useful; a total failure returns neutral with warnings.
 *  - Never throws: all errors are captured and surfaced as warnings in the result.
 *  - Pure input/output boundary: the rest of the engine only sees the normalized
 *    PerpContextData shape below; raw CoinGlass shapes do not leak upstream.
 *
 * ⚠️  LIVE VALIDATION REQUIRED
 * This module was implemented against CoinGlass API documentation (v4).
 * Live endpoint responses have NOT been validated yet. Before using in production:
 *  1. Set COINGLASS_API_KEY and run the validation script (see README).
 *  2. Verify normalized field values are in the expected ranges.
 *  3. Confirm symbol format (e.g. MMTUSDT vs MMTUSDT.P) resolves correctly per endpoint.
 */

const { getFundingContext }      = require('../adapters/coinglass/funding');
const { getOpenInterestContext } = require('../adapters/coinglass/openInterest');
const { getMacroContext }        = require('../adapters/coinglass/macro');
const { extractBaseCoin }        = require('../adapters/coinglass/normalize');

/** Coins treated as "majors" for the purpose of BTC-dominance / altcoin-season adjustments. */
const MAJOR_COINS = new Set(['BTC', 'ETH']);

/**
 * Determine whether a symbol represents an altcoin (not BTC or ETH).
 * Used to gate BTC-dominance and altcoin-season adjustments.
 *
 * @param {string} symbol - Raw symbol string (e.g. 'BINANCE:MMTUSDT.P', 'BTCUSDT')
 * @returns {boolean}
 */
function isAltcoin(symbol) {
  try {
    const base = extractBaseCoin(symbol);
    return !MAJOR_COINS.has(base);
  } catch {
    return true; // assume altcoin on parse failure — conservative
  }
}

/**
 * Neutral context returned when CoinGlass is unavailable or disabled.
 * All numeric fields are null; available=false signals no adjustment was applied.
 *
 * @returns {PerpContextData}
 */
function neutralContext() {
  return {
    fundingRate:    null,
    fundingBias:    null,
    fundingRegime:  null,
    oiTrend:        null,
    oiExpansion:    null,
    fearGreedIndex: null,
    fearGreedLabel: null,
    btcDominance:   null,
    altcoinIndex:   null,
    isAltcoin:      false,
    available:      false,
    providerStatus: null,
    warnings:       [],
    raw: { funding: null, oi: null, macro: null },
  };
}

/**
 * @typedef {object} PerpContextData
 * @property {number|null}  fundingRate      - Current funding rate (decimal, e.g. 0.0001 = 0.01%)
 * @property {string|null}  fundingBias      - 'long_crowded' | 'short_crowded' | 'neutral'
 * @property {string|null}  fundingRegime    - 'extreme_long' | 'long_heavy' | 'neutral' | 'short_heavy' | 'extreme_short'
 * @property {string|null}  oiTrend          - 'rising' | 'falling' | 'flat'
 * @property {boolean|null} oiExpansion      - true when OI is expanding
 * @property {number|null}  fearGreedIndex   - 0–100 Fear & Greed value
 * @property {string|null}  fearGreedLabel   - 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed'
 * @property {number|null}  btcDominance     - BTC.D percentage (e.g. 54.2)
 * @property {number|null}  altcoinIndex     - Altcoin season index 0–100
 * @property {boolean}      isAltcoin        - Whether the symbol is an altcoin
 * @property {boolean}      available        - True if at least one CoinGlass endpoint returned data
 * @property {string[]}     warnings         - Non-fatal issues from individual fetches
 * @property {object}       raw              - Raw normalized CoinGlass objects for debugging
 */

/**
 * Fetch and normalize perp context for a given symbol.
 *
 * Fetches funding rate, open interest, and macro context concurrently.
 * Individual fetch failures are captured as warnings — a partial result
 * is still returned and applied conservatively.
 *
 * Returns immediately with neutral context if COINGLASS_API_KEY is unset.
 *
 * @param {string} symbol           - Raw symbol string (e.g. 'BINANCE:MMTUSDT.P')
 * @param {object} [options]
 * @param {string} [options.exchange='Binance']  - Exchange for funding/LS endpoints
 * @param {number} [options.timeoutMs=10000]     - Per-request timeout
 * @returns {Promise<PerpContextData>}
 */
async function fetchPerpContext(symbol, options = {}) {
  // No API key → skip silently, return neutral. This is expected in non-crypto environments.
  if (!process.env.COINGLASS_API_KEY) {
    return neutralContext();
  }

  const exchange  = options.exchange  || 'Binance';
  const timeoutMs = options.timeoutMs || 10_000;

  const [fundingResult, oiResult, macroResult] = await Promise.allSettled([
    getFundingContext(symbol,      { exchange, interval: '1h', limit: 24, timeoutMs }),
    getOpenInterestContext(symbol, { interval: '4h', limit: 42, timeoutMs }),
    getMacroContext(               { timeoutMs }),
  ]);

  // If every endpoint rejected with plan_restricted, return compact neutral — no warning spam.
  const allPlanRestricted = [fundingResult, oiResult, macroResult].every(
    (r) => r.status === 'rejected' && r.reason?.code === 'plan_restricted'
  );
  if (allPlanRestricted) {
    return { ...neutralContext(), providerStatus: 'plan_restricted' };
  }

  const warnings = [];

  const funding = fundingResult.status === 'fulfilled' ? fundingResult.value : null;
  const oi      = oiResult.status      === 'fulfilled' ? oiResult.value      : null;
  const macro   = macroResult.status   === 'fulfilled' ? macroResult.value   : null;

  // Only warn about non-plan-restricted failures to avoid noise when the plan simply
  // doesn't cover some endpoints but others succeed.
  if (fundingResult.status === 'rejected' && fundingResult.reason?.code !== 'plan_restricted') {
    warnings.push(`coinglass_funding_unavailable: ${fundingResult.reason?.code || 'error'}`);
  }
  if (oiResult.status === 'rejected' && oiResult.reason?.code !== 'plan_restricted') {
    warnings.push(`coinglass_oi_unavailable: ${oiResult.reason?.code || 'error'}`);
  }
  if (macroResult.status === 'rejected' && macroResult.reason?.code !== 'plan_restricted') {
    warnings.push(`coinglass_macro_unavailable: ${macroResult.reason?.code || 'error'}`);
  }

  // Propagate non-fatal warnings from individual adapters (e.g. empty data)
  for (const ctx of [funding, oi, macro]) {
    if (ctx?.warnings?.length) warnings.push(...ctx.warnings);
  }

  const available = funding !== null || oi !== null || macro !== null;

  return {
    fundingRate:    funding?.currentFunding  ?? null,
    fundingBias:    funding?.fundingBias     ?? null,
    fundingRegime:  funding?.fundingRegime   ?? null,
    oiTrend:        oi?.oiTrend             ?? null,
    oiExpansion:    oi?.oiExpansion         ?? null,
    fearGreedIndex: macro?.fearGreed?.value ?? null,
    fearGreedLabel: macro?.fearGreed?.label ?? null,
    btcDominance:   macro?.bitcoinDominance ?? null,
    altcoinIndex:   macro?.altcoinSeason    ?? null,
    isAltcoin:      isAltcoin(symbol),
    available,
    providerStatus: null,
    warnings,
    raw: { funding, oi, macro },
  };
}

module.exports = { fetchPerpContext, isAltcoin };
