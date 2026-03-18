'use strict';

/**
 * CoinGecko Trending adapter.
 *
 * Endpoint: GET /search/trending
 *
 * Returns the top-7 trending coins (updated every 10–15 minutes by CoinGecko),
 * trending NFTs, and trending categories. This adapter normalizes coins and
 * categories into compact, agent-friendly shapes.
 *
 * Use cases in this project:
 *  - Market discovery context for agent responses
 *  - Future watchlist scan enrichment ("is this coin trending?")
 *  - Market breadth overlay ("are trending coins bullish/bearish?")
 *
 * No API key required for the public tier, but rate limits are aggressive.
 * A demo or paid key is recommended for reliable access.
 */

const { request } = require('./client');
const {
  normalizeTrendingCoin,
  normalizeCategory,
} = require('./normalize');
const defaults = require('../../config/defaults');

const PATH = '/search/trending';

/**
 * @typedef {object} TrendingCoin
 * @property {string}      id
 * @property {string}      symbol
 * @property {string}      name
 * @property {number|null} marketCapRank
 * @property {number|null} priceChangePercent24h
 * @property {number|null} score
 * @property {string|null} thumb
 */

/**
 * @typedef {object} TrendingCategory
 * @property {string}      id
 * @property {string}      name
 * @property {number|null} marketCap1hChange
 */

/**
 * @typedef {object} TrendingContext
 * @property {TrendingCoin[]}     topTrending
 * @property {string[]}           trendingIds
 * @property {string[]}           trendingSymbols
 * @property {TrendingCategory[]} categories
 * @property {string[]}           warnings
 * @property {string}             source
 */

/**
 * Fetch and normalize trending market context from CoinGecko.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<TrendingContext>}
 */
async function getTrending(options = {}) {
  const timeoutMs = options.timeoutMs || defaults.COINGECKO_TIMEOUT_MS;
  const warnings  = [];

  const raw = await request(PATH, {}, timeoutMs);

  if (!raw || typeof raw !== 'object') {
    warnings.push('CoinGecko trending response was empty or malformed.');
    return { topTrending: [], trendingIds: [], trendingSymbols: [], categories: [], warnings, source: 'coingecko' };
  }

  // Normalize coins
  let topTrending = [];
  if (Array.isArray(raw.coins)) {
    topTrending = raw.coins.map(normalizeTrendingCoin);
  } else {
    warnings.push('CoinGecko trending: coins field missing or unexpected shape.');
  }

  // Normalize categories (optional — may not be present on all tiers)
  let categories = [];
  if (Array.isArray(raw.categories)) {
    categories = raw.categories.map(normalizeCategory);
  }

  return {
    topTrending,
    trendingIds:     topTrending.map((c) => c.id).filter(Boolean),
    trendingSymbols: topTrending.map((c) => c.symbol).filter(Boolean),
    categories,
    warnings,
    source: 'coingecko',
  };
}

module.exports = { getTrending };
