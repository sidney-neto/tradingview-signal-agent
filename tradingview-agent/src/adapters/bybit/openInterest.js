'use strict';

/**
 * Bybit open interest adapter.
 *
 * Endpoint: GET /v5/market/open-interest
 * Docs:     https://bybit-exchange.github.io/docs/v5/market/open-interest
 *
 * Fetches OI history and produces a normalized context:
 * - currentOI      — most recent open interest value
 * - oiTrend        — 'expanding' | 'contracting' | 'stable' | 'insufficient_data'
 * - oiExpansion    — percentage change from oldest to newest record (or null)
 * - oiRegime       — 'strong_expansion' | 'expansion' | 'stable' | 'contraction' | 'strong_contraction'
 * - latestTimestamp — timestamp of most recent record (ms)
 * - source         — 'bybit'
 * - warnings       — non-fatal issues
 *
 * OI trend thresholds (change from first to last record):
 *   > +10% → strong_expansion
 *   > + 5% → expansion
 *   < - 5% → contraction
 *   < -10% → strong_contraction
 *   otherwise → stable
 */

const defaults = require('../../config/defaults');
const { request }       = require('./client');
const {
  normalizeBybitSymbol,
  normalizeOIRecord,
  last,
} = require('./normalize');
const { MissingSymbolError, InvalidSymbolError } = require('./errors');

const OI_PATH = '/v5/market/open-interest';

/**
 * Classify OI trend from a sorted array of normalized OI records.
 *
 * @param {Array<{openInterest: number|null}>} sorted - Ascending by timestamp
 * @returns {{ oiTrend: string, oiExpansion: number|null, oiRegime: string }}
 */
function classifyOITrend(sorted) {
  if (sorted.length < 2) {
    return { oiTrend: 'insufficient_data', oiExpansion: null, oiRegime: 'stable' };
  }

  const first = sorted[0].openInterest;
  const latest = sorted[sorted.length - 1].openInterest;

  if (!first || !latest || first === 0) {
    return { oiTrend: 'insufficient_data', oiExpansion: null, oiRegime: 'stable' };
  }

  const change = (latest - first) / first;
  const pct    = change * 100;

  let oiTrend;
  let oiRegime;

  if (change > 0.10)       { oiTrend = 'expanding';    oiRegime = 'strong_expansion'; }
  else if (change > 0.05)  { oiTrend = 'expanding';    oiRegime = 'expansion'; }
  else if (change < -0.10) { oiTrend = 'contracting';  oiRegime = 'strong_contraction'; }
  else if (change < -0.05) { oiTrend = 'contracting';  oiRegime = 'contraction'; }
  else                     { oiTrend = 'stable';        oiRegime = 'stable'; }

  return { oiTrend, oiExpansion: parseFloat(pct.toFixed(2)), oiRegime };
}

/**
 * Fetch and normalize the open interest context for a symbol.
 *
 * @param {string} symbol         - Symbol in any supported format
 * @param {object} [options={}]
 * @param {string} [options.category='linear']     - Bybit category
 * @param {string} [options.intervalTime='1h']     - OI interval: '5min' | '15min' | '30min' | '1h' | '4h' | '1d'
 * @param {number} [options.limit]                 - Number of records (default: BYBIT_OI_LIMIT)
 * @param {number} [options.timeoutMs]             - Request timeout override
 * @returns {Promise<object>} Normalized OI context
 * @throws {MissingSymbolError}
 * @throws {InvalidSymbolError}
 */
async function getOpenInterestContext(symbol, options = {}) {
  if (!symbol) throw new MissingSymbolError();

  const bybitSymbol = normalizeBybitSymbol(symbol);
  if (!bybitSymbol) throw new InvalidSymbolError(symbol);

  const category     = options.category     || 'linear';
  const intervalTime = options.intervalTime || '1h';
  const limit        = options.limit        || defaults.BYBIT_OI_LIMIT;

  const result = await request(
    OI_PATH,
    { category, symbol: bybitSymbol, intervalTime, limit },
    options.timeoutMs
  );

  const warnings = [];
  const rawList  = (result && result.list) || [];

  if (rawList.length === 0) {
    warnings.push('No open interest records returned — OI context unavailable.');
    return {
      currentOI:       null,
      oiTrend:         'insufficient_data',
      oiExpansion:     null,
      oiRegime:        'stable',
      latestTimestamp: null,
      source:          'bybit',
      warnings,
    };
  }

  const records = rawList.map(normalizeOIRecord).filter(Boolean);

  // Bybit returns newest-first; sort ascending for trend computation
  const sorted = [...records].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const latestRecord  = last(sorted);
  const currentOI     = latestRecord ? latestRecord.openInterest : null;
  const { oiTrend, oiExpansion, oiRegime } = classifyOITrend(sorted);

  return {
    currentOI,
    oiTrend,
    oiExpansion,
    oiRegime,
    latestTimestamp: latestRecord ? latestRecord.timestamp : null,
    source:          'bybit',
    warnings,
  };
}

module.exports = { getOpenInterestContext, classifyOITrend };
