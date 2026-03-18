'use strict';

/**
 * CoinGlass Macro Context adapter.
 *
 * Aggregates macro crypto market indicators:
 *   - Fear & Greed Index  → GET /api/index/fear-greed-history
 *   - Bitcoin Dominance   → GET /api/index/bitcoin-dominance
 *   - Altcoin Season Index → GET /api/index/altcoin-season
 *
 * Used to provide macro crypto regime context for signal interpretation.
 * A future hook can use this to adjust confidence for altcoins during
 * high-dominance or extreme-fear environments.
 *
 * StableCoin MarketCap history is noted as a v1.2 candidate — endpoint
 * response shape was not confirmed in docs and is excluded from this phase.
 */

const { request } = require('./client');
const { unwrapResponse, last } = require('./normalize');
const { PlanRestrictedError } = require('./errors');
const defaults = require('../../config/defaults');

const PATHS = {
  fearGreed:      '/api/index/fear-greed-history',
  btcDominance:   '/api/index/bitcoin-dominance',
  altcoinSeason:  '/api/index/altcoin-season',
};

// Fear & Greed label bands (0–100)
const FEAR_GREED_BANDS = [
  { max: 25,  label: 'extreme_fear'  },
  { max: 46,  label: 'fear'          },
  { max: 54,  label: 'neutral'       },
  { max: 75,  label: 'greed'         },
  { max: 100, label: 'extreme_greed' },
];

/**
 * Label a Fear & Greed value.
 *
 * @param {number} value - 0–100
 * @returns {string}
 */
function labelFearGreed(value) {
  for (const band of FEAR_GREED_BANDS) {
    if (value <= band.max) return band.label;
  }
  return 'unknown';
}

/**
 * Fetch the most recent Fear & Greed value.
 *
 * The API returns `data_list`, `price_list`, and `time_list` arrays
 * inside a single data object. We take the last element of `data_list`.
 *
 * @param {number} timeoutMs
 * @returns {Promise<{ value: number|null, label: string }|null>}
 */
async function fetchFearGreed(timeoutMs) {
  const raw  = await request(PATHS.fearGreed, {}, timeoutMs);
  const data = unwrapResponse(raw);

  // Data may be an array containing one object with list fields,
  // or directly an object — handle both defensively.
  const container = Array.isArray(data) ? data[0] : data;
  if (!container) return null;

  const dataList = container.data_list;
  if (!Array.isArray(dataList) || dataList.length === 0) return null;

  const value = last(dataList);
  if (typeof value !== 'number' || isNaN(value)) return null;

  // Sanity check: F&G values should be 0–100
  if (value < 0 || value > 100) return null;

  return { value, label: labelFearGreed(value) };
}

/**
 * Fetch the most recent Bitcoin dominance value.
 *
 * Response: [{ time, dominance_value }, ...]
 *
 * @param {number} timeoutMs
 * @returns {Promise<number|null>}
 */
async function fetchBtcDominance(timeoutMs) {
  const raw  = await request(PATHS.btcDominance, {}, timeoutMs);
  const data = unwrapResponse(raw);

  if (!Array.isArray(data) || data.length === 0) return null;

  const latest = last(data);
  if (!latest) return null;

  const value = parseFloat(latest.dominance_value);
  return isNaN(value) ? null : value;
}

/**
 * Fetch the most recent Altcoin Season Index value.
 *
 * Response shape is partially documented; we attempt to extract the latest
 * numeric value and fall back to null if the shape is unexpected.
 *
 * @param {number} timeoutMs
 * @returns {Promise<number|null>}
 */
async function fetchAltcoinSeason(timeoutMs) {
  const raw  = await request(PATHS.altcoinSeason, {}, timeoutMs);
  const data = unwrapResponse(raw);

  if (!data) return null;

  // Try array of records first
  if (Array.isArray(data) && data.length > 0) {
    const latest = last(data);
    // Try common field names
    for (const key of ['value', 'altcoin_season_index', 'index', 'score']) {
      const v = parseFloat(latest[key]);
      if (!isNaN(v)) return v;
    }
    // Try if record is just a number
    if (typeof latest === 'number') return latest;
  }

  // Try container with list
  const container = Array.isArray(data) ? data[0] : data;
  if (container && Array.isArray(container.data_list)) {
    const v = last(container.data_list);
    if (typeof v === 'number' && !isNaN(v)) return v;
  }

  return null;
}

/**
 * @typedef {object} MacroContext
 * @property {{ value: number, label: string }|null} fearGreed         - F&G index
 * @property {number|null}                            bitcoinDominance  - BTC.D percentage
 * @property {number|null}                            altcoinSeason     - Altcoin season index
 * @property {null}                                   stablecoinBias    - TODO: v1.2
 * @property {null}                                   macdState         - TODO: no official endpoint
 * @property {string}                                 source            - 'coinglass'
 * @property {string[]}                               warnings
 */

/**
 * Fetch and normalize macro crypto context.
 *
 * Fetches Fear & Greed, BTC Dominance, and Altcoin Season concurrently.
 * Individual fetch failures are captured as warnings rather than thrown,
 * so a partial result is still useful.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<MacroContext>}
 */
async function getMacroContext(options = {}) {
  const { timeoutMs = defaults.COINGLASS_TIMEOUT_MS } = options;
  const warnings = [];

  const [fgResult, btcResult, altResult] = await Promise.allSettled([
    fetchFearGreed(timeoutMs),
    fetchBtcDominance(timeoutMs),
    fetchAltcoinSeason(timeoutMs),
  ]);

  // If every endpoint rejected with plan_restricted, propagate as a single throw.
  const allPlanRestricted = [fgResult, btcResult, altResult].every(
    (r) => r.status === 'rejected' && r.reason?.code === 'plan_restricted'
  );
  if (allPlanRestricted) {
    throw new PlanRestrictedError('macro endpoints require a plan upgrade');
  }

  let fearGreed       = null;
  let bitcoinDominance = null;
  let altcoinSeason   = null;

  if (fgResult.status === 'fulfilled') {
    fearGreed = fgResult.value;
  } else if (fgResult.reason?.code !== 'plan_restricted') {
    warnings.push(`Fear & Greed fetch failed: ${fgResult.reason?.message || 'unknown error'}`);
  }

  if (btcResult.status === 'fulfilled') {
    bitcoinDominance = btcResult.value;
  } else if (btcResult.reason?.code !== 'plan_restricted') {
    warnings.push(`Bitcoin dominance fetch failed: ${btcResult.reason?.message || 'unknown error'}`);
  }

  if (altResult.status === 'fulfilled') {
    altcoinSeason = altResult.value;
    if (altcoinSeason === null) {
      warnings.push('Altcoin season index could not be parsed from response.');
    }
  } else if (altResult.reason?.code !== 'plan_restricted') {
    warnings.push(`Altcoin season fetch failed: ${altResult.reason?.message || 'unknown error'}`);
  }

  return {
    fearGreed,
    bitcoinDominance,
    altcoinSeason,
    stablecoinBias: null, // TODO v1.2: stablecoin-marketcap-history endpoint
    macdState:      null, // No official CoinGlass MACD endpoint available
    source:         'coinglass',
    warnings,
  };
}

module.exports = { getMacroContext };
