'use strict';

/**
 * CoinGlass Long/Short Ratio adapter.
 *
 * Endpoint: GET /api/futures/global-long-short-account-ratio/history
 *
 * Returns the global long/short account ratio for a symbol on a given exchange.
 * Used to detect crowd bias and crowding risk in perpetual futures markets.
 *
 * Response record shape: { symbol, long_ratio, short_ratio, timestamp }
 */

const { request } = require('./client');
const { unwrapResponse, normalizeTradingPair, average, last } = require('./normalize');
const defaults = require('../../config/defaults');

const PATH = '/api/futures/global-long-short-account-ratio/history';

/**
 * Classify crowd bias from a long ratio percentage (0–1 scale or 0–100 scale).
 * CoinGlass returns ratios in the 0–1 range (e.g. 0.52 = 52% longs).
 *
 * @param {number} longRatio - Fraction of accounts that are long (0–1)
 * @returns {'long_heavy'|'short_heavy'|'neutral'}
 */
function classifyCrowdBias(longRatio) {
  if (longRatio >= 0.60) return 'long_heavy';
  if (longRatio <= 0.40) return 'short_heavy';
  return 'neutral';
}

/**
 * Classify crowding risk from a long ratio.
 *
 * Higher crowding in one direction increases the risk of a violent flush.
 *
 * @param {number} longRatio
 * @returns {'high'|'moderate'|'low'}
 */
function classifyCrowdingRisk(longRatio) {
  if (longRatio >= 0.70 || longRatio <= 0.30) return 'high';
  if (longRatio >= 0.62 || longRatio <= 0.38) return 'moderate';
  return 'low';
}

/**
 * @typedef {object} LongShortContext
 * @property {number|null}  longRatioPct       - Latest long account ratio (0–1)
 * @property {number|null}  shortRatioPct      - Latest short account ratio (0–1)
 * @property {number|null}  longShortRatio     - longRatioPct / shortRatioPct
 * @property {number|null}  avgLongRatio       - Average long ratio over the window
 * @property {string}       crowdBias          - 'long_heavy' | 'short_heavy' | 'neutral'
 * @property {string}       crowdingRisk       - 'high' | 'moderate' | 'low'
 * @property {number}       recordCount
 * @property {string}       source             - 'coinglass'
 * @property {string[]}     warnings
 */

/**
 * Fetch and normalize long/short ratio context for a symbol.
 *
 * @param {string} symbol - Raw symbol (e.g. 'BINANCE:BTCUSDT.P', 'BTCUSDT', 'BTC')
 * @param {object} [options]
 * @param {string} [options.exchange='Binance']
 * @param {string} [options.interval='1h']
 * @param {number} [options.limit=24]
 * @param {number} [options.startTime]          - Start timestamp (ms)
 * @param {number} [options.endTime]            - End timestamp (ms)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<LongShortContext>}
 */
async function getLongShortContext(symbol, options = {}) {
  const {
    exchange  = 'Binance',
    interval  = '1h',
    limit     = 24,
    startTime,
    endTime,
    timeoutMs = defaults.COINGLASS_TIMEOUT_MS,
  } = options;

  const pair     = normalizeTradingPair(symbol);
  const warnings = [];

  const raw = await request(PATH, {
    exchange,
    symbol:    pair,
    interval,
    limit,
    startTime: startTime || undefined,
    endTime:   endTime   || undefined,
  }, timeoutMs);

  const data = unwrapResponse(raw);

  if (!Array.isArray(data) || data.length === 0) {
    warnings.push('CoinGlass returned no long/short ratio records.');
    return {
      longRatioPct:   null,
      shortRatioPct:  null,
      longShortRatio: null,
      avgLongRatio:   null,
      crowdBias:      'neutral',
      crowdingRisk:   'low',
      recordCount:    0,
      source:         'coinglass',
      warnings,
    };
  }

  const longRatios = data
    .map((r) => {
      const v = parseFloat(r.long_ratio);
      return isNaN(v) ? null : v;
    })
    .filter((v) => v !== null);

  const shortRatios = data
    .map((r) => {
      const v = parseFloat(r.short_ratio);
      return isNaN(v) ? null : v;
    })
    .filter((v) => v !== null);

  const latestLong  = last(longRatios);
  const latestShort = last(shortRatios);
  const avgLong     = average(longRatios);

  // Normalise ratios to 0–1 scale if they appear to be on 0–100 scale
  const normLong  = latestLong  !== null && latestLong  > 1 ? latestLong  / 100 : latestLong;
  const normShort = latestShort !== null && latestShort > 1 ? latestShort / 100 : latestShort;
  const normAvg   = avgLong     !== null && avgLong     > 1 ? avgLong     / 100 : avgLong;

  const longShortRatio = (normLong !== null && normShort !== null && normShort > 0)
    ? normLong / normShort
    : null;

  return {
    longRatioPct:   normLong,
    shortRatioPct:  normShort,
    longShortRatio,
    avgLongRatio:   normAvg,
    crowdBias:      normLong !== null ? classifyCrowdBias(normLong)    : 'neutral',
    crowdingRisk:   normLong !== null ? classifyCrowdingRisk(normLong) : 'low',
    recordCount:    data.length,
    source:         'coinglass',
    warnings,
  };
}

module.exports = { getLongShortContext };
