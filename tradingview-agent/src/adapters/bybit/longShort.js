'use strict';

/**
 * Bybit long/short ratio adapter.
 *
 * Endpoint: GET /v5/market/account-ratio
 * Docs:     https://bybit-exchange.github.io/docs/v5/market/long-short-ratio
 *
 * Fetches account long/short ratio history and produces a normalized context:
 * - longShortRatio  — most recent buyRatio (0–1)
 * - crowdBias       — directional crowd label
 * - crowdingRisk    — 'high' | 'moderate' | 'low'
 * - latestTimestamp — timestamp of most recent record (ms)
 * - source          — 'bybit'
 * - warnings        — non-fatal issues
 *
 * Crowd bias thresholds (buyRatio):
 *   > 0.65 → strong_long_bias
 *   > 0.55 → long_leaning
 *   < 0.35 → strong_short_bias
 *   < 0.45 → short_leaning
 *   otherwise → neutral
 */

const defaults = require('../../config/defaults');
const { request }       = require('./client');
const {
  normalizeBybitSymbol,
  normalizeLSRecord,
  last,
} = require('./normalize');
const { MissingSymbolError, InvalidSymbolError } = require('./errors');

const LS_PATH = '/v5/market/account-ratio';

/**
 * Classify crowd directional bias from buyRatio.
 *
 * @param {number} buyRatio - Value between 0 and 1
 * @returns {string}
 */
function classifyCrowdBias(buyRatio) {
  if (buyRatio > 0.65) return 'strong_long_bias';
  if (buyRatio > 0.55) return 'long_leaning';
  if (buyRatio < 0.35) return 'strong_short_bias';
  if (buyRatio < 0.45) return 'short_leaning';
  return 'neutral';
}

/**
 * Classify crowding risk from buyRatio.
 *
 * @param {number} buyRatio
 * @returns {'high'|'moderate'|'low'}
 */
function classifyCrowdingRisk(buyRatio) {
  if (buyRatio > 0.70 || buyRatio < 0.30) return 'high';
  if (buyRatio > 0.60 || buyRatio < 0.40) return 'moderate';
  return 'low';
}

/**
 * Fetch and normalize the long/short crowd context for a symbol.
 *
 * @param {string} symbol         - Symbol in any supported format
 * @param {object} [options={}]
 * @param {string} [options.category='linear'] - Bybit category
 * @param {string} [options.period='1h']       - Period: '5min' | '15min' | '30min' | '1h' | '4h' | '1d'
 * @param {number} [options.limit]             - Number of records (default: BYBIT_LS_LIMIT)
 * @param {number} [options.timeoutMs]         - Request timeout override
 * @returns {Promise<object>} Normalized long/short context
 * @throws {MissingSymbolError}
 * @throws {InvalidSymbolError}
 */
async function getLongShortContext(symbol, options = {}) {
  if (!symbol) throw new MissingSymbolError();

  const bybitSymbol = normalizeBybitSymbol(symbol);
  if (!bybitSymbol) throw new InvalidSymbolError(symbol);

  const category = options.category || 'linear';
  const period   = options.period   || '1h';
  const limit    = options.limit    || defaults.BYBIT_LS_LIMIT;

  const result = await request(
    LS_PATH,
    { category, symbol: bybitSymbol, period, limit },
    options.timeoutMs
  );

  const warnings = [];
  const rawList  = (result && result.list) || [];

  if (rawList.length === 0) {
    warnings.push('No long/short records returned — crowd context unavailable.');
    return {
      longShortRatio:  null,
      crowdBias:       'neutral',
      crowdingRisk:    'low',
      latestTimestamp: null,
      source:          'bybit',
      warnings,
    };
  }

  const records = rawList.map(normalizeLSRecord).filter(Boolean);

  // Bybit returns newest-first
  const latestRecord   = records[0];
  const longShortRatio = latestRecord ? latestRecord.buyRatio : null;

  return {
    longShortRatio,
    crowdBias:       longShortRatio !== null ? classifyCrowdBias(longShortRatio)    : 'neutral',
    crowdingRisk:    longShortRatio !== null ? classifyCrowdingRisk(longShortRatio) : 'low',
    latestTimestamp: latestRecord ? latestRecord.timestamp : null,
    source:          'bybit',
    warnings,
  };
}

module.exports = { getLongShortContext, classifyCrowdBias, classifyCrowdingRisk };
