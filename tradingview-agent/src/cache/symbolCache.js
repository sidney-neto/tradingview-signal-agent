'use strict';

/**
 * TTL-cached wrapper for resolveSymbol.
 *
 * Symbol resolution results are stable over minutes/hours, making them
 * ideal caching targets. A long TTL (5 min default) is appropriate since
 * symbol metadata (exchange, symbolId) very rarely changes.
 *
 * Cache key: "<query.toLowerCase()>:<filter>"
 *
 * Environment variables:
 *   CACHE_ENABLED        — set to "true" to enable (default: false)
 *   CACHE_TTL_SYMBOL_MS  — TTL for symbol resolution in ms (default: 300000 = 5 min)
 *
 * Behavior:
 *   - If CACHE_ENABLED≠true, calls pass through to resolveSymbol.
 *   - Errors are never cached.
 */

const { TtlCache } = require('./ttlCache');
const logger = require('../logger');

const { resolveSymbol } = require('../adapters/tradingview/symbolSearch');

// ── Configuration ─────────────────────────────────────────────────────────────

const CACHE_ENABLED = process.env.CACHE_ENABLED       === 'true';
const SYMBOL_TTL_MS = parseInt(process.env.CACHE_TTL_SYMBOL_MS || '300000', 10);

const cache = new TtlCache({
  ttlMs:           SYMBOL_TTL_MS,
  sweepIntervalMs: Math.max(SYMBOL_TTL_MS / 2, 60_000),
});

// ── Exported cached wrapper ───────────────────────────────────────────────────

/**
 * Cached wrapper for resolveSymbol.
 * Signature matches the original exactly.
 *
 * @param {string} query
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function resolveSymbolCached(query, options = {}) {
  if (!CACHE_ENABLED) return resolveSymbol(query, options);

  const filter = options.filter || '';
  const key    = `${query.toLowerCase()}:${filter}`;

  const cached = cache.get(key);
  if (cached !== undefined) {
    logger.debug('symbol.cache.hit', { query, filter });
    return cached;
  }

  logger.debug('symbol.cache.miss', { query, filter });
  const result = await resolveSymbol(query, options);  // throws on error
  cache.set(key, result);
  return result;
}

/** Expose cache instance for testing and manual invalidation. */
function _getCache() { return cache; }

module.exports = { resolveSymbolCached, _getCache, CACHE_ENABLED };
