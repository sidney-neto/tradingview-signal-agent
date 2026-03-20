'use strict';

/**
 * In-memory per-IP rate limiter.
 *
 * Uses a simple fixed-window counter per client IP. No external dependencies.
 *
 * Environment variables:
 *   RATE_LIMIT_WINDOW_MS      — rolling window size in ms (default: 60000 = 1 minute)
 *   RATE_LIMIT_MAX_REQUESTS   — max requests per IP per window (default: 20)
 *
 * Limitations to document for operators:
 *   - State is in-process only. In multi-instance deployments each instance has
 *     its own counter, so effective limit scales with instance count.
 *   - If the server sits behind a reverse proxy (nginx, Cloudflare, etc.) that
 *     terminates TLS, req.ip may be the proxy IP rather than the real client IP.
 *     Set `app.set('trust proxy', 1)` in server.js and configure the proxy to
 *     forward X-Forwarded-For to address this.
 *   - For production multi-instance deployments consider Redis-backed rate limiting.
 *
 * Response:
 *   429 — rate limit exceeded (JSON with error + code fields)
 *
 * Headers set on every response:
 *   X-RateLimit-Limit     — the maximum allowed per window
 *   X-RateLimit-Remaining — remaining requests in the current window
 *   X-RateLimit-Reset     — Unix timestamp (seconds) when the window resets
 */

const logger = require('../../logger');

const WINDOW_MS    = parseInt(process.env.RATE_LIMIT_WINDOW_MS    || '60000', 10);
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '20',    10);

// Map<ip, { count: number, resetAt: number }>
const store = new Map();

// Background sweep: evict expired windows to prevent unbounded memory growth.
// Runs every window length; `unref()` ensures it doesn't prevent process exit.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of store.entries()) {
    if (entry.resetAt <= now) store.delete(ip);
  }
}, WINDOW_MS).unref();

/**
 * Express middleware that enforces per-IP rate limiting.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function rateLimit(req, res, next) {
  const ip  = req.ip || 'unknown';
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }

  entry.count += 1;

  const remaining = Math.max(0, MAX_REQUESTS - entry.count);
  const resetSec  = Math.ceil(entry.resetAt / 1000);

  res.set('X-RateLimit-Limit',     String(MAX_REQUESTS));
  res.set('X-RateLimit-Remaining', String(remaining));
  res.set('X-RateLimit-Reset',     String(resetSec));

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    logger.warn('rate_limit.exceeded', { ip, count: entry.count, limit: MAX_REQUESTS, retryAfterSec: retryAfter });
    return res.status(429).json({
      error: `Rate limit exceeded. Try again in ${retryAfter} second(s).`,
      code:  'rate_limited',
    });
  }

  return next();
}

/**
 * Expose internals for testing only — do not use in production code.
 * @internal
 */
function _resetStore() {
  store.clear();
}

/**
 * Factory: create an independent rate limiter with custom settings.
 *
 * Useful for endpoints that need different limits than the default.
 * Each call returns a fresh { middleware, _resetStore, windowMs, maxRequests } object
 * backed by its own independent in-memory store.
 *
 * @param {object} opts
 * @param {number} opts.windowMs    — window size in ms
 * @param {number} opts.maxRequests — max requests per IP per window
 * @param {string} [opts.label]     — log label prefix (default: 'rate_limit')
 * @returns {{ middleware: Function, _resetStore: Function, windowMs: number, maxRequests: number }}
 */
function createRateLimit({ windowMs, maxRequests, label = 'rate_limit' }) {
  const localStore = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of localStore.entries()) {
      if (entry.resetAt <= now) localStore.delete(ip);
    }
  }, windowMs).unref();

  function middleware(req, res, next) {
    const ip  = req.ip || 'unknown';
    const now = Date.now();

    let entry = localStore.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      localStore.set(ip, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSec  = Math.ceil(entry.resetAt / 1000);

    res.set('X-RateLimit-Limit',     String(maxRequests));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset',     String(resetSec));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      logger.warn(`${label}.exceeded`, { ip, count: entry.count, limit: maxRequests, retryAfterSec: retryAfter });
      return res.status(429).json({
        error: `Rate limit exceeded. Try again in ${retryAfter} second(s).`,
        code:  'rate_limited',
      });
    }

    return next();
  }

  return {
    middleware,
    _resetStore: () => localStore.clear(),
    windowMs,
    maxRequests,
  };
}

module.exports = { rateLimit, _resetStore, WINDOW_MS, MAX_REQUESTS, createRateLimit };
