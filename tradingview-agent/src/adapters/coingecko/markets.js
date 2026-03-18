'use strict';

/**
 * CoinGecko Markets adapter.
 *
 * Endpoint: GET /coins/markets
 *
 * Fetches broad market leaders sorted by market cap descending.
 * Normalizes each record into a compact app shape and derives simple
 * market breadth metrics (gainers vs losers ratio).
 *
 * Use cases in this project:
 *  - Market leadership snapshot for agent context
 *  - Market breadth overlay ("are the top 50 coins mostly green or red?")
 *  - Future category/sector strength analysis
 *  - Discovery: is a given symbol in the top N by market cap?
 *
 * No API key required for the public tier, but rate limits are aggressive.
 * A demo or paid key is recommended for reliable access.
 */

const { request } = require('./client');
const { normalizeCoin, resolveVsCurrency } = require('./normalize');
const defaults = require('../../config/defaults');

const PATH = '/coins/markets';

/**
 * @typedef {object} MarketLeader
 * @property {string}      id
 * @property {string}      symbol
 * @property {string}      name
 * @property {number|null} rank
 * @property {number|null} price
 * @property {number|null} marketCap
 * @property {number|null} priceChange24h
 * @property {number|null} priceChangePercent24h
 * @property {number|null} volume24h
 * @property {number|null} high24h
 * @property {number|null} low24h
 * @property {string|null} thumb
 */

/**
 * @typedef {object} MarketBreadth
 * @property {number} total
 * @property {number} gainers         - coins with positive 24h change
 * @property {number} losers          - coins with negative 24h change
 * @property {number} neutral         - coins with no change data
 * @property {number} gainersPercent  - percentage of total that are green
 * @property {'risk_on'|'risk_off'|'mixed'} regime
 */

/**
 * @typedef {object} MarketsContext
 * @property {MarketLeader[]} leaders
 * @property {MarketBreadth}  marketBreadth
 * @property {string}         vsCurrency
 * @property {string[]}       warnings
 * @property {string}         source
 */

/**
 * Derive a simple breadth regime label from the gainers/total ratio.
 *
 * @param {number} gainersPercent - 0–100
 * @returns {'risk_on'|'risk_off'|'mixed'}
 */
function classifyBreadthRegime(gainersPercent) {
  if (gainersPercent >= 60) return 'risk_on';
  if (gainersPercent <= 40) return 'risk_off';
  return 'mixed';
}

/**
 * Fetch and normalize top-market-cap coin leaders from CoinGecko.
 *
 * @param {object} [options]
 * @param {string} [options.vsCurrency='usd']  - Quote currency
 * @param {number} [options.perPage=50]        - Number of coins to fetch (max 250)
 * @param {number} [options.page=1]            - Page number
 * @param {number} [options.timeoutMs]
 * @returns {Promise<MarketsContext>}
 */
async function getTopCoins(options = {}) {
  const vsCurrency = resolveVsCurrency(options.vsCurrency);
  const perPage    = Math.min(options.perPage || defaults.COINGECKO_MARKETS_PER_PAGE, 250);
  const page       = options.page      || 1;
  const timeoutMs  = options.timeoutMs || defaults.COINGECKO_TIMEOUT_MS;
  const warnings   = [];

  const raw = await request(PATH, {
    vs_currency: vsCurrency,
    order:       'market_cap_desc',
    per_page:    perPage,
    page,
    sparkline:   false,
  }, timeoutMs);

  if (!Array.isArray(raw)) {
    warnings.push('CoinGecko markets response was not an array.');
    return {
      leaders:      [],
      marketBreadth: { total: 0, gainers: 0, losers: 0, neutral: 0, gainersPercent: 0, regime: 'mixed' },
      vsCurrency,
      warnings,
      source: 'coingecko',
    };
  }

  const leaders = raw.map(normalizeCoin);

  // Breadth computation
  let gainers = 0;
  let losers  = 0;
  let neutral = 0;
  for (const c of leaders) {
    if (c.priceChangePercent24h === null) { neutral++; }
    else if (c.priceChangePercent24h > 0) { gainers++; }
    else if (c.priceChangePercent24h < 0) { losers++;  }
    else                                  { neutral++; }
  }
  const total          = leaders.length;
  const gainersPercent = total > 0 ? Math.round((gainers / total) * 100) : 0;
  const regime         = classifyBreadthRegime(gainersPercent);

  return {
    leaders,
    marketBreadth: { total, gainers, losers, neutral, gainersPercent, regime },
    vsCurrency,
    warnings,
    source: 'coingecko',
  };
}

module.exports = { getTopCoins };
