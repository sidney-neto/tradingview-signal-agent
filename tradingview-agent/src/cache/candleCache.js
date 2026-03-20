'use strict';

/**
 * TTL-cached wrapper for fetchCandles.
 *
 * Candle data is time-sensitive, so the default TTL is intentionally short
 * (60 s). Caching is only useful for burst scenarios where the same symbol
 * and timeframe are requested repeatedly in quick succession (e.g., a
 * multi-timeframe run that hits a shared lower timeframe).
 *
 * Cache key: "<symbolId>:<tvTimeframe>:<candleCount>"
 *
 * Environment variables:
 *   CACHE_ENABLED          — set to "true" to enable (default: false)
 *   CACHE_TTL_CANDLES_MS   — TTL for candle data in ms (default: 60000 = 1 min)
 *
 * Behavior:
 *   - If CACHE_ENABLED≠true, calls pass through to the original fetchCandles.
 *   - Errors are never cached.
 *   - Returns the same array shape as fetchCandles (oldest-first OHLCV).
 */

const { TtlCache } = require('./ttlCache');
const logger = require('../logger');

const { fetchCandles } = require('../adapters/tradingview/candles');

// ── Configuration ─────────────────────────────────────────────────────────────

const CACHE_ENABLED  = process.env.CACHE_ENABLED        === 'true';
const CANDLE_TTL_MS  = parseInt(process.env.CACHE_TTL_CANDLES_MS || '60000', 10);

const cache = new TtlCache({
  ttlMs:           CANDLE_TTL_MS,
  sweepIntervalMs: Math.max(CANDLE_TTL_MS / 2, 15_000),
});

// ── Exported cached wrapper ───────────────────────────────────────────────────

/**
 * Cached wrapper for fetchCandles.
 * Signature matches the original exactly.
 *
 * @param {string} symbolId
 * @param {string} tvTimeframe
 * @param {object} [options]
 * @returns {Promise<Array>}
 */
async function fetchCandlesCached(symbolId, tvTimeframe, options = {}) {
  if (!CACHE_ENABLED) return fetchCandles(symbolId, tvTimeframe, options);

  const candleCount = options.candleCount || 300;
  const key = `${symbolId}:${tvTimeframe}:${candleCount}`;

  const cached = cache.get(key);
  if (cached !== undefined) {
    logger.debug('candle.cache.hit', { symbolId, timeframe: tvTimeframe });
    return cached;
  }

  logger.debug('candle.cache.miss', { symbolId, timeframe: tvTimeframe });
  const result = await fetchCandles(symbolId, tvTimeframe, options);  // throws on error
  cache.set(key, result);
  return result;
}

/** Expose cache instance for testing and manual invalidation. */
function _getCache() { return cache; }

module.exports = { fetchCandlesCached, _getCache, CACHE_ENABLED };
