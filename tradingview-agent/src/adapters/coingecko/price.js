'use strict';

/**
 * CoinGecko Price adapter.
 *
 * Endpoint: GET /simple/price
 *
 * Provides a lightweight current-price lookup by CoinGecko coin ID.
 * Returns USD price, 24h change, and optional market cap.
 *
 * Note: this endpoint requires a CoinGecko ID (e.g. 'bitcoin', 'ethereum'),
 * not a trading symbol. For symbol → ID resolution, use the /search endpoint
 * (future: add resolveId() helper via /search if needed).
 *
 * Use cases in this project:
 *  - Quick price sanity checks during agent discovery flows
 *  - Cross-referencing spot price against TradingView perpetual price
 *  - Optional enrichment for watchlist/discovery features
 *
 * NOT used as the primary price source for analyzeMarket() signal logic.
 */

const { request } = require('./client');
const { resolveVsCurrency, safeFloat } = require('./normalize');
const { SymbolNotFoundError } = require('./errors');
const defaults = require('../../config/defaults');

const PATH = '/simple/price';

/**
 * @typedef {object} PriceResult
 * @property {string}      id
 * @property {string}      vsCurrency
 * @property {number|null} price
 * @property {number|null} change24h
 * @property {number|null} changePercent24h
 * @property {number|null} marketCap
 * @property {string}      source
 */

/**
 * Fetch the current price for one or more CoinGecko coin IDs.
 *
 * @param {string|string[]} ids    - CoinGecko coin ID(s), e.g. 'bitcoin' or ['bitcoin','ethereum']
 * @param {object} [options]
 * @param {string} [options.vsCurrency='usd']
 * @param {boolean} [options.includeMarketCap=false]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<PriceResult[]>}
 */
async function getPrice(ids, options = {}) {
  const vsCurrency     = resolveVsCurrency(options.vsCurrency);
  const includeMarketCap = options.includeMarketCap || false;
  const timeoutMs      = options.timeoutMs || defaults.COINGECKO_TIMEOUT_MS;

  const idList = Array.isArray(ids) ? ids : [ids];
  if (idList.length === 0) throw new SymbolNotFoundError('(empty id list)');

  const raw = await request(PATH, {
    ids:                    idList.join(','),
    vs_currencies:          vsCurrency,
    include_24hr_change:    true,
    include_market_cap:     includeMarketCap,
  }, timeoutMs);

  if (!raw || typeof raw !== 'object') {
    return idList.map((id) => ({
      id,
      vsCurrency,
      price:           null,
      change24h:       null,
      changePercent24h:null,
      marketCap:       null,
      source:          'coingecko',
    }));
  }

  return idList.map((id) => {
    const entry = raw[id] || {};
    return {
      id,
      vsCurrency,
      price:           safeFloat(entry[vsCurrency]),
      change24h:       safeFloat(entry[`${vsCurrency}_24h_change`]),
      changePercent24h:safeFloat(entry[`${vsCurrency}_24h_change`]),
      marketCap:       safeFloat(entry[`${vsCurrency}_market_cap`] ?? null),
      source:          'coingecko',
    };
  });
}

module.exports = { getPrice };
