'use strict';

/**
 * POST /webhook/tradingview
 *
 * Receives TradingView alert payloads, normalizes them, and triggers
 * the analysis pipeline. Returns a structured JSON response.
 *
 * Security: protected by requireWebhookSecret middleware (must be applied upstream).
 * Auth: shared secret via X-Webhook-Secret header OR "secret" field in payload.
 *
 * Payload shape (all fields except secret are optional with sensible fallbacks):
 * {
 *   "secret":    "your-secret",              // required (or in header)
 *   "query":     "BTCUSDT",                  // preferred: direct query string
 *   "symbol":    "BTCUSDT",                  // fallback if query absent
 *   "exchange":  "BINANCE",                  // optional, prepended to symbol
 *   "timeframe": "1h",                       // required
 *   "message":   "raw TradingView message"   // optional, logged only
 * }
 *
 * Query resolution priority:
 *   1. payload.query  — used as-is
 *   2. payload.exchange + payload.symbol  — joined as "EXCHANGE:SYMBOL"
 *   3. payload.symbol  — used as-is
 *
 * De-duplication (in-memory, short TTL):
 *   Identical (query, timeframe) pairs within WEBHOOK_DEDUP_TTL_MS are rejected
 *   with 409 Conflict to suppress duplicate TradingView alerts.
 *
 * Environment variables:
 *   WEBHOOK_DEDUP_TTL_MS  — de-duplication window in ms (default: 10000, 0 to disable)
 *
 * Response:
 *   200 — { status: "accepted", correlationId, normalizedRequest, analysis }
 *   409 — duplicate within TTL
 *   4xx — validation / auth errors
 *   500 — unexpected pipeline error
 */

const crypto      = require('crypto');
const logger      = require('../../logger');
const { analyzeMarket }   = require('../../tools/analyzeMarket');
const { getSupportedTimeframes } = require('../../utils/timeframes');
const { deliverAnalysis } = require('../../delivery');
const { isPersistenceEnabled, persistAnalysisSnapshot } = require('../../storage');

const DEDUP_TTL_MS          = parseInt(process.env.WEBHOOK_DEDUP_TTL_MS          || '10000',  10);
const NO_TRADE_DEDUP_TTL_MS = parseInt(process.env.WEBHOOK_NO_TRADE_DEDUP_TTL_MS || '300000', 10); // 5 min default
const SUPPRESS_NO_TRADE     = (process.env.WEBHOOK_SUPPRESS_NO_TRADE || '').toLowerCase() === 'true';

// Analysis-level dedup store: prevents redundant analysis runs for exact repeats.
// Key: SHA256(query|timeframe|null), Value: expiry timestamp.
// Intentionally simple — no Redis required. Resets on restart (by design).
const dedupStore = new Map();

// Delivery-level dedup store: prevents repeated deliveries of the same signal.
// Key: SHA256(query|timeframe|signal), Value: expiry timestamp.
// no_trade uses a much longer TTL to reduce operational noise.
const deliveryDedupStore = new Map();

// Sweep both stores every 60 s to prevent unbounded growth.
if (DEDUP_TTL_MS > 0 || NO_TRADE_DEDUP_TTL_MS > 0) {
  setInterval(() => {
    const now = Date.now();
    for (const [k, exp] of dedupStore.entries()) {
      if (exp <= now) dedupStore.delete(k);
    }
    for (const [k, exp] of deliveryDedupStore.entries()) {
      if (exp <= now) deliveryDedupStore.delete(k);
    }
  }, 60_000).unref();
}

/**
 * Normalize a raw TradingView webhook payload into an analysis request.
 *
 * @param {object} body
 * @returns {{ query: string, timeframe: string, message: string|null }}
 * @throws {Error} if normalization fails (missing required fields)
 */
function normalizePayload(body) {
  if (!body || typeof body !== 'object') {
    throw Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400, code: 'invalid_payload' });
  }

  const { query, symbol, exchange, timeframe, message } = body;

  // ── Resolve query ──────────────────────────────────────────────────────────

  let resolvedQuery = null;

  if (query && typeof query === 'string' && query.trim()) {
    resolvedQuery = query.trim();
  } else if (symbol && typeof symbol === 'string' && symbol.trim()) {
    const sym = symbol.trim().toUpperCase();
    const exc = exchange && typeof exchange === 'string' && exchange.trim()
      ? exchange.trim().toUpperCase()
      : null;
    resolvedQuery = exc ? `${exc}:${sym}` : sym;
  }

  if (!resolvedQuery) {
    throw Object.assign(
      new Error('Cannot resolve query: provide "query", "symbol", or "exchange"+"symbol".'),
      { statusCode: 400, code: 'invalid_payload' }
    );
  }

  // ── Validate timeframe ────────────────────────────────────────────────────

  if (!timeframe || typeof timeframe !== 'string' || !timeframe.trim()) {
    throw Object.assign(
      new Error('"timeframe" is required and must be a non-empty string.'),
      { statusCode: 400, code: 'invalid_payload' }
    );
  }

  const supported = getSupportedTimeframes();
  if (!supported.includes(timeframe.trim())) {
    throw Object.assign(
      new Error(`Unsupported timeframe "${timeframe}". Supported: ${supported.join(', ')}`),
      { statusCode: 400, code: 'unsupported_timeframe' }
    );
  }

  return {
    query:     resolvedQuery,
    timeframe: timeframe.trim(),
    message:   (message && typeof message === 'string') ? message : null,
  };
}

/**
 * Build a short dedup key for (query, timeframe, signal).
 * Including signal allows the same (query, timeframe) pair to fire a new alert
 * when the signal changes (e.g., from no_trade to breakout_watch).
 * Pass signal=null for the pre-analysis analysis dedup check.
 *
 * @param {string}      query
 * @param {string}      timeframe
 * @param {string|null} signal  - optional signal type from analysis result
 * @returns {string} hex hash prefix
 */
function dedupKey(query, timeframe, signal) {
  const sigPart = signal || 'unknown';
  return crypto.createHash('sha256')
    .update(`${query}|${timeframe}|${sigPart}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Route handler for POST /webhook/tradingview.
 * Must be mounted AFTER requireWebhookSecret + webhookRateLimit middleware.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function handleWebhook(req, res) {
  const correlationId = crypto.randomUUID();
  const startedAt     = Date.now();

  logger.info('webhook.received', { correlationId, ip: req.ip });

  // ── Normalize payload ────────────────────────────────────────────────────

  let normalized;
  try {
    normalized = normalizePayload(req.body);
  } catch (err) {
    logger.warn('webhook.invalid_payload', { correlationId, error: err.message, code: err.code });
    return res.status(err.statusCode || 400).json({
      error: err.message,
      code:  err.code || 'invalid_payload',
      correlationId,
    });
  }

  const { query, timeframe, message } = normalized;

  logger.info('webhook.normalized', { correlationId, query, timeframe, hasMessage: !!message });

  // ── De-duplication ───────────────────────────────────────────────────────

  if (DEDUP_TTL_MS > 0) {
    const key     = dedupKey(query, timeframe, null);  // signal unknown at this point
    const now     = Date.now();
    const expiry  = dedupStore.get(key);

    if (expiry && expiry > now) {
      const ttlRemaining = Math.ceil((expiry - now) / 1000);
      logger.info('webhook.dedup_rejected', { correlationId, query, timeframe, ttlRemaining });
      return res.status(409).json({
        status:       'duplicate',
        message:      `Duplicate alert for (${query}, ${timeframe}). Try again in ${ttlRemaining}s.`,
        correlationId,
        ttlRemainingS: ttlRemaining,
      });
    }

    dedupStore.set(key, now + DEDUP_TTL_MS);
  }

  // ── Analysis ─────────────────────────────────────────────────────────────

  let analysis;
  try {
    analysis = await analyzeMarket({ query, timeframe });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logger.error('webhook.analysis_error', {
      correlationId, query, timeframe,
      errorName: err.constructor.name,
      error:     err.message,
      durationMs,
    });

    // Map known domain errors to appropriate HTTP codes
    const code = err.constructor.name;
    if (code === 'SymbolNotFoundError')    return res.status(400).json({ error: err.message, code: 'symbol_not_found',    correlationId });
    if (code === 'AmbiguousSymbolError')   return res.status(400).json({ error: err.message, code: 'ambiguous_symbol',    correlationId });
    if (code === 'CandleFetchTimeoutError')return res.status(408).json({ error: err.message, code: 'candle_fetch_timeout',correlationId });
    if (code === 'InsufficientCandlesError')return res.status(422).json({ error: err.message, code: 'insufficient_candles',correlationId });

    return res.status(500).json({ error: 'Analysis failed unexpectedly.', code: 'internal_error', correlationId });
  }

  const durationMs = Date.now() - startedAt;

  logger.info('webhook.success', {
    correlationId,
    query,
    timeframe,
    signal:     analysis.signal,
    confidence: analysis.confidence,
    durationMs,
  });

  if (isPersistenceEnabled()) {
    persistAnalysisSnapshot({
      source: 'tradingview_webhook',
      correlationId,
      request: { query, timeframe },
      rawPayload: req.body || null,
      analysis,
    });
  }

  // ── Post-analysis delivery policy ────────────────────────────────────────
  //
  // 1. Suppress no_trade delivery if WEBHOOK_SUPPRESS_NO_TRADE=true.
  // 2. Deduplicate repeated same-signal deliveries with a per-signal TTL.
  //    no_trade uses a longer TTL (NO_TRADE_DEDUP_TTL_MS, default 5 min).
  //    Other signals use the standard DEDUP_TTL_MS.

  let skipDelivery = false;
  let skipReason   = null;

  if (analysis.signal === 'no_trade' && SUPPRESS_NO_TRADE) {
    skipDelivery = true;
    skipReason   = 'no_trade_suppressed';
  } else {
    const delivTtl = analysis.signal === 'no_trade'
      ? NO_TRADE_DEDUP_TTL_MS
      : DEDUP_TTL_MS;

    if (delivTtl > 0) {
      const delivKey = dedupKey(query, timeframe, analysis.signal);
      const now      = Date.now();
      const delivExp = deliveryDedupStore.get(delivKey);
      if (delivExp && delivExp > now) {
        skipDelivery = true;
        skipReason   = `signal_dedup(${analysis.signal})`;
        logger.info('webhook.delivery_dedup', {
          correlationId, query, timeframe, signal: analysis.signal,
          ttlRemainingS: Math.ceil((delivExp - now) / 1000),
        });
      } else {
        deliveryDedupStore.set(delivKey, now + delivTtl);
      }
    }
  }

  // ── Delivery (non-fatal) ─────────────────────────────────────────────────
  // Fire-and-await delivery before responding so the response includes
  // delivery results. Failures are isolated and never affect HTTP 200 status.

  let delivery = [];
  if (!skipDelivery) {
    try {
      delivery = await deliverAnalysis({
        source:       'tradingview_webhook',
        request:      { query, timeframe },
        analysis,
        rawPayload:   req.body,
        warnings:     analysis.warnings || [],
        correlationId,
      });
    } catch (err) {
      logger.error('webhook.delivery_crash', { correlationId, error: err.message });
    }
  } else {
    delivery = [{ provider: 'none', attempted: false, success: false, error: skipReason }];
    logger.info('webhook.delivery_skipped', {
      correlationId, query, timeframe, signal: analysis.signal, skipReason,
    });
  }

  return res.status(200).json({
    status:           'accepted',
    correlationId,
    normalizedRequest: { query, timeframe },
    warnings:         analysis.warnings || [],
    analysis,
    delivery,
  });
}

module.exports = { handleWebhook, normalizePayload };
