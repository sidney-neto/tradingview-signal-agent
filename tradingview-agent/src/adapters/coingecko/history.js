'use strict';

/**
 * CoinGecko History adapter.
 *
 * Endpoint: GET /coins/{id}/market_chart
 *
 * Fetches historical price, market cap, and volume data for a given coin.
 * Returns a compact normalized series suitable for research, discovery,
 * and future regime/overlay analysis.
 *
 * Granularity (automatically chosen by CoinGecko based on `days`):
 *   days = 1          → 5-minute intervals
 *   days = 2–90       → hourly intervals
 *   days = 91–max     → daily intervals (00:00 UTC)
 *
 * Use cases in this project:
 *  - Historical market snapshot for agent research flows
 *  - Trend context for discovery (e.g. "has BTC been trending up over 30 days?")
 *  - Future: macro regime overlay (bull/bear market state over N days)
 *  - NOT the primary candle source — TradingView remains the core engine
 *
 * Requires a coin ID (e.g. 'bitcoin'), not a trading symbol.
 */

const { request } = require('./client');
const { resolveVsCurrency, normalizePricePoint } = require('./normalize');
const defaults = require('../../config/defaults');

/**
 * @typedef {object} PricePoint
 * @property {number} time   - Unix timestamp in milliseconds
 * @property {number} value  - Price / market cap / volume value
 */

/**
 * @typedef {object} MarketChartResult
 * @property {string}       id
 * @property {string}       vsCurrency
 * @property {number}       days
 * @property {PricePoint[]} prices
 * @property {PricePoint[]} marketCaps
 * @property {PricePoint[]} volumes
 * @property {string}       source
 */

/**
 * Fetch historical market chart data for a coin.
 *
 * @param {string} id             - CoinGecko coin ID, e.g. 'bitcoin'
 * @param {object} [options]
 * @param {string} [options.vsCurrency='usd']
 * @param {number} [options.days=30]         - Number of days of history (1–max)
 * @param {boolean} [options.pricesOnly=false] - Only return prices, skip caps/volumes
 * @param {number} [options.timeoutMs]
 * @returns {Promise<MarketChartResult>}
 */
async function getMarketChart(id, options = {}) {
  const vsCurrency = resolveVsCurrency(options.vsCurrency);
  const days       = options.days       || defaults.COINGECKO_HISTORY_DAYS;
  const pricesOnly = options.pricesOnly || false;
  const timeoutMs  = options.timeoutMs  || defaults.COINGECKO_TIMEOUT_MS;

  const path = `/coins/${encodeURIComponent(id)}/market_chart`;
  const raw  = await request(path, { vs_currency: vsCurrency, days }, timeoutMs);

  const prices     = Array.isArray(raw.prices)      ? raw.prices.map(normalizePricePoint)      : [];
  const marketCaps = (!pricesOnly && Array.isArray(raw.market_caps))
    ? raw.market_caps.map(normalizePricePoint) : [];
  const volumes    = (!pricesOnly && Array.isArray(raw.total_volumes))
    ? raw.total_volumes.map(normalizePricePoint) : [];

  return {
    id,
    vsCurrency,
    days,
    prices,
    marketCaps,
    volumes,
    source: 'coingecko',
  };
}

module.exports = { getMarketChart };
