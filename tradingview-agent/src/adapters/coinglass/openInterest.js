'use strict';

/**
 * CoinGlass Open Interest adapter.
 *
 * Endpoint: GET /api/futures/open-interest/aggregated-history
 *
 * Returns aggregated OI OHLC across all exchanges for a given coin.
 * Used to detect participation expansion/contraction and distinguish
 * weak moves from meaningful continuation.
 *
 * Note: This endpoint takes the base coin symbol (e.g. 'BTC'), not the
 * full trading pair. Timestamps are in seconds, not milliseconds.
 */

const { request } = require('./client');
const { unwrapResponse, normalizeOhlcRecord, extractBaseCoin, average, last } = require('./normalize');
const defaults = require('../../config/defaults');

const PATH = '/api/futures/open-interest/aggregated-history';

/**
 * Classify OI trend by comparing most recent close to the close N bars ago.
 *
 * @param {number[]} closes
 * @returns {'rising'|'falling'|'flat'}
 */
function classifyOiTrend(closes) {
  if (closes.length < 2) return 'flat';
  const lookback  = Math.min(6, closes.length - 1); // compare last 6 periods
  const recent    = closes[closes.length - 1];
  const reference = closes[closes.length - 1 - lookback];
  const changePct = (recent - reference) / reference;

  if (changePct >  0.03) return 'rising';
  if (changePct < -0.03) return 'falling';
  return 'flat';
}

/**
 * Classify OI regime from the trend.
 *
 * @param {'rising'|'falling'|'flat'} trend
 * @returns {'expanding'|'contracting'|'stable'}
 */
function classifyOiRegime(trend) {
  if (trend === 'rising')  return 'expanding';
  if (trend === 'falling') return 'contracting';
  return 'stable';
}

/**
 * @typedef {object} OpenInterestContext
 * @property {number|null}  currentOI     - Most recent aggregated OI close value (USD)
 * @property {number|null}  averageOI     - Average over the lookback window
 * @property {string}       oiTrend       - 'rising' | 'falling' | 'flat'
 * @property {boolean}      oiExpansion   - true when OI is rising
 * @property {string}       oiRegime      - 'expanding' | 'contracting' | 'stable'
 * @property {number}       recordCount
 * @property {string}       source        - 'coinglass'
 * @property {string[]}     warnings
 */

/**
 * Fetch and normalize open interest context for a symbol.
 *
 * @param {string} symbol - Raw symbol (e.g. 'BINANCE:MMTUSDT.P', 'BTCUSDT', 'BTC')
 * @param {object} [options]
 * @param {string} [options.interval='4h']   - CoinGlass interval (1m,3m,5m,15m,30m,1h,4h,6h,8h,12h,1d,1w)
 * @param {number} [options.limit=42]        - Records (42 × 4h ≈ 7 days of context)
 * @param {number} [options.startTime]       - Start timestamp (seconds)
 * @param {number} [options.endTime]         - End timestamp (seconds)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<OpenInterestContext>}
 */
async function getOpenInterestContext(symbol, options = {}) {
  const {
    interval  = '4h',
    limit     = 42,
    startTime,
    endTime,
    timeoutMs = defaults.COINGLASS_TIMEOUT_MS,
  } = options;

  const coin     = extractBaseCoin(symbol);
  const warnings = [];

  const raw = await request(PATH, {
    symbol:    coin,
    interval,
    limit,
    startTime: startTime || undefined,
    endTime:   endTime   || undefined,
  }, timeoutMs);

  const data = unwrapResponse(raw);

  if (!Array.isArray(data) || data.length === 0) {
    warnings.push('CoinGlass returned no open interest records.');
    return {
      currentOI:   null,
      averageOI:   null,
      oiTrend:     'flat',
      oiExpansion: false,
      oiRegime:    'stable',
      recordCount: 0,
      source:      'coinglass',
      warnings,
    };
  }

  const records = data.map(normalizeOhlcRecord);
  const closes  = records.map((r) => r.close).filter((v) => !isNaN(v));

  const currentOI = last(closes);
  const averageOI = average(closes);
  const oiTrend   = classifyOiTrend(closes);
  const oiRegime  = classifyOiRegime(oiTrend);

  return {
    currentOI,
    averageOI,
    oiTrend,
    oiExpansion: oiTrend === 'rising',
    oiRegime,
    recordCount: records.length,
    source:      'coinglass',
    warnings,
  };
}

module.exports = { getOpenInterestContext };
