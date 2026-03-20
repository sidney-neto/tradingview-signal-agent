'use strict';

/**
 * API server — minimal Express application.
 *
 * Exposes:
 *   GET  /health                  — liveness probe (public, no auth required)
 *   POST /analyze                 — single-timeframe market analysis (requires x-api-key)
 *   POST /webhook/tradingview     — TradingView alert ingestion (requires webhook secret)
 *
 * Environment variables:
 *   PORT                          — HTTP listen port (default: 3000)
 *   LOG_LEVEL                     — logger verbosity: debug | info | warn | error (default: info)
 *   API_KEY                       — required API key for /analyze
 *   DISABLE_AUTH                  — set to "true" to skip /analyze auth (dev only)
 *   RATE_LIMIT_WINDOW_MS          — /analyze rate limiting window in ms (default: 60000)
 *   RATE_LIMIT_MAX_REQUESTS       — /analyze max requests per IP per window (default: 20)
 *   TRADINGVIEW_WEBHOOK_SECRET    — shared secret for /webhook/tradingview
 *   WEBHOOK_RATE_LIMIT_WINDOW_MS  — webhook rate limiting window in ms (default: 60000)
 *   WEBHOOK_RATE_LIMIT_MAX_REQUESTS — webhook max requests per IP per window (default: 10)
 *   WEBHOOK_DEDUP_TTL_MS          — in-memory dedup window for identical alerts (default: 10000)
 *
 * Start:
 *   node src/api/server.js
 *   # or via npm:
 *   npm run start:api
 */

const express = require('express');
const logger  = require('../logger');

const { requireApiKey }        = require('./middleware/auth');
const { rateLimit, createRateLimit } = require('./middleware/rateLimit');
const { requireWebhookSecret } = require('./middleware/webhookAuth');

const healthRoute             = require('./routes/health');
const analyzeRoute            = require('./routes/analyze');
const { handleWebhook }       = require('./routes/webhookTradingView');

const PORT = parseInt(process.env.PORT || '3000', 10);

// Webhook-specific rate limiter with independent config
const webhookRateLimit = createRateLimit({
  windowMs:    parseInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS    || '60000', 10),
  maxRequests: parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX_REQUESTS || '10',    10),
  label:       'webhook_rate_limit',
});

const app = express();

// Parse JSON request bodies
app.use(express.json());

// Public route — no auth or rate limiting
app.use('/health', healthRoute);

// Protected routes — apply auth then rate limiting
app.use('/analyze', requireApiKey, rateLimit, analyzeRoute);

// Webhook route — shared secret auth + independent rate limiting
app.post('/webhook/tradingview', webhookRateLimit.middleware, requireWebhookSecret, handleWebhook);

// 404 — unmatched routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'not_found' });
});

// 500 — uncaught errors from route handlers
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('api.unhandled_error', { error: err.message });
  res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
});

/**
 * Start the HTTP server.
 * Returns a Promise that resolves with the net.Server instance.
 *
 * @returns {Promise<import('http').Server>}
 */
function start() {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, (err) => {
      if (err) return reject(err);
      logger.info('api.started', { port: PORT });
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { app, start };
