'use strict';

/**
 * CoinGlass Funding Rate adapter.
 *
 * Endpoint: GET /api/futures/funding-rate/history
 *
 * Returns OHLC-aggregated funding rate data for a given exchange + symbol pair.
 * Used to identify crowded long/short conditions and sustained funding regimes.
 *
 * Normalized output: getFundingContext() → FundingContext
 */

const { request } = require('./client');
const { unwrapResponse, normalizeOhlcRecord, normalizeTradingPair, average, last } = require('./normalize');
const defaults = require('../../config/defaults');

const PATH = '/api/futures/funding-rate/history';

/**
 * Funding rate thresholds (decimal, not percentage).
 * Binance typical range: -0.0003 to +0.001
 */
const THRESHOLDS = {
  EXTREME_LONG:   0.001,   // > 0.10% per 8h — extreme long crowding
  LONG_HEAVY:     0.0003,  // > 0.03% — longs paying meaningfully
  SHORT_HEAVY:   -0.0001,  // < -0.01% — shorts paying
  EXTREME_SHORT: -0.0005,  // < -0.05% — extreme short crowding
};

/**
 * Classify funding bias from a single funding rate value.
 *
 * @param {number} rate - Decimal funding rate (e.g. 0.0001 = 0.01%)
 * @returns {'long_crowded'|'short_crowded'|'neutral'}
 */
function classifyFundingBias(rate) {
  if (rate >= THRESHOLDS.LONG_HEAVY)  return 'long_crowded';
  if (rate <= THRESHOLDS.SHORT_HEAVY) return 'short_crowded';
  return 'neutral';
}

/**
 * Classify a funding regime from the average rate over a lookback window.
 *
 * @param {number} avg - Average decimal funding rate
 * @returns {'extreme_long'|'long_heavy'|'neutral'|'short_heavy'|'extreme_short'}
 */
function classifyFundingRegime(avg) {
  if (avg >= THRESHOLDS.EXTREME_LONG)   return 'extreme_long';
  if (avg >= THRESHOLDS.LONG_HEAVY)     return 'long_heavy';
  if (avg <= THRESHOLDS.EXTREME_SHORT)  return 'extreme_short';
  if (avg <= THRESHOLDS.SHORT_HEAVY)    return 'short_heavy';
  return 'neutral';
}

/**
 * @typedef {object} FundingContext
 * @property {number|null}  currentFunding  - Most recent funding rate (decimal)
 * @property {number|null}  averageFunding  - Average over the lookback window (decimal)
 * @property {number|null}  minFunding      - Minimum over the window (decimal)
 * @property {number|null}  maxFunding      - Maximum over the window (decimal)
 * @property {string}       fundingBias     - 'long_crowded' | 'short_crowded' | 'neutral'
 * @property {string}       fundingRegime   - 'extreme_long' | 'long_heavy' | 'neutral' | 'short_heavy' | 'extreme_short'
 * @property {number}       recordCount     - Number of records returned
 * @property {string}       source          - 'coinglass'
 * @property {string[]}     warnings        - Non-fatal issues
 */

/**
 * Fetch and normalize funding rate context for a symbol.
 *
 * @param {string} symbol - Raw symbol string (e.g. 'BINANCE:MMTUSDT.P', 'BTCUSDT', 'BTC')
 * @param {object} [options]
 * @param {string} [options.exchange='Binance']  - Exchange name
 * @param {string} [options.interval='1h']       - CoinGlass interval (1m, 5m, 1h, 4h, 1d, 1w)
 * @param {number} [options.limit=24]            - Number of records (24 × 1h = 24 h of context)
 * @param {number} [options.startTime]           - Start timestamp (ms)
 * @param {number} [options.endTime]             - End timestamp (ms)
 * @param {number} [options.timeoutMs]           - Request timeout override
 * @returns {Promise<FundingContext>}
 */
async function getFundingContext(symbol, options = {}) {
  const {
    exchange   = 'Binance',
    interval   = '1h',
    limit      = 24,
    startTime,
    endTime,
    timeoutMs  = defaults.COINGLASS_TIMEOUT_MS,
  } = options;

  const pair = normalizeTradingPair(symbol);
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
    warnings.push('CoinGlass returned no funding rate records.');
    return {
      currentFunding: null,
      averageFunding: null,
      minFunding:     null,
      maxFunding:     null,
      fundingBias:    'neutral',
      fundingRegime:  'neutral',
      recordCount:    0,
      source:         'coinglass',
      warnings,
    };
  }

  const records = data.map(normalizeOhlcRecord);
  const closes  = records.map((r) => r.close).filter((v) => !isNaN(v));

  const currentFunding = last(closes);
  const averageFunding = average(closes);
  const minFunding     = closes.length > 0 ? Math.min(...closes) : null;
  const maxFunding     = closes.length > 0 ? Math.max(...closes) : null;

  return {
    currentFunding,
    averageFunding,
    minFunding,
    maxFunding,
    fundingBias:   classifyFundingBias(currentFunding),
    fundingRegime: classifyFundingRegime(averageFunding),
    recordCount:   records.length,
    source:        'coinglass',
    warnings,
  };
}

module.exports = { getFundingContext };
