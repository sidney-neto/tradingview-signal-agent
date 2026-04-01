'use strict';

/**
 * TTL-cached wrappers for external overlay fetch functions.
 *
 * Wraps fetchPerpContext (CoinGlass), fetchBybitContext (Bybit), and
 * fetchMarketContext (CoinGecko) with an in-memory TTL cache. This
 * reduces repeated identical API calls during high-frequency analysis runs.
 *
 * Cache is keyed on (source, normalizedSymbol) so that the same symbol
 * in different formats always maps to the same entry.
 *
 * Environment variables:
 *   CACHE_ENABLED        — set to "true" to enable (default: false)
 *   CACHE_TTL_OVERLAYS_MS — TTL for all overlay data in ms (default: 300000 = 5 min)
 *
 * Behavior:
 *   - If CACHE_ENABLED≠true, calls pass straight through to the originals.
 *   - Errors are never cached — a failed fetch always triggers a fresh attempt.
 *   - Cache hits are logged at debug level; misses at debug level.
 *   - Output shape is identical to the original functions.
 */

const { TtlCache } = require('./ttlCache');
const logger = require('../logger');

const {
  fetchPerpContext,
} = require('../analyzer/perpContext');

const {
  fetchBybitContext,
} = require('../analyzer/bybitContext');

const {
  fetchMarketContext,
} = require('../analyzer/marketContext');

// ── Configuration ────────────────────────────────────────────────────────────

const CACHE_ENABLED   = process.env.CACHE_ENABLED        === 'true';
const OVERLAY_TTL_MS  = parseInt(process.env.CACHE_TTL_OVERLAYS_MS || '300000', 10);

// Sweep every half-TTL to keep memory tidy
const cache = new TtlCache({
  ttlMs:           OVERLAY_TTL_MS,
  sweepIntervalMs: Math.max(OVERLAY_TTL_MS / 2, 30_000),
});

// ── Key helpers ───────────────────────────────────────────────────────────────

/**
 * Normalize a symbol string to a plain uppercase pair (e.g., "BTCUSDT").
 * Strips exchange prefixes and .P/.PERP suffixes so that
 * "BINANCE:BTCUSDT.P" and "BTCUSDT" share the same cache entry.
 */
function normalizeKey(source, symbol) {
  const clean = String(symbol)
    .replace(/^[A-Z0-9]+:/, '')  // strip exchange prefix
    .replace(/\.(P|PERP)$/i, '') // strip futures suffix
    .toUpperCase();
  return `${source}:${clean}`;
}

// ── Generic wrapper ───────────────────────────────────────────────────────────

async function withCache(source, symbol, fetchFn, options) {
  if (!CACHE_ENABLED) return fetchFn(symbol, options);

  const key = normalizeKey(source, symbol);

  const cached = cache.get(key);
  if (cached !== undefined) {
    logger.debug('overlay.cache.hit', { source, symbol: key });
    return cached;
  }

  logger.debug('overlay.cache.miss', { source, symbol: key });
  const result = await fetchFn(symbol, options);  // throws on error — not cached
  cache.set(key, result);
  return result;
}

// ── Provider registry ─────────────────────────────────────────────────────────

/**
 * Create a TTL-cached wrapper for any context provider fetch function.
 *
 * New providers can be cached with one line:
 *   const fetchXCached = createCachedProvider('source', fetchX);
 *
 * @param {string}   source   - Provider name (used as cache key prefix and log label)
 * @param {Function} fetchFn  - Async function(symbol, options) → context data
 * @returns {Function}        - Cached async function with the same signature as fetchFn
 */
function createCachedProvider(source, fetchFn) {
  return async function cachedFetch(symbol, options) {
    return withCache(source, symbol, fetchFn, options);
  };
}

// ── Exported cached wrappers ──────────────────────────────────────────────────

/** Cached wrapper for fetchPerpContext (CoinGlass). */
const fetchPerpContextCached   = createCachedProvider('coinglass',  fetchPerpContext);

/** Cached wrapper for fetchBybitContext. */
const fetchBybitContextCached  = createCachedProvider('bybit',      fetchBybitContext);

/** Cached wrapper for fetchMarketContext (CoinGecko). */
const fetchMarketContextCached = createCachedProvider('coingecko',  fetchMarketContext);

/** Expose cache instance for testing and manual invalidation. */
function _getCache() { return cache; }

module.exports = {
  fetchPerpContextCached,
  fetchBybitContextCached,
  fetchMarketContextCached,
  createCachedProvider,  // exported for new providers
  _getCache,
  CACHE_ENABLED,
};
