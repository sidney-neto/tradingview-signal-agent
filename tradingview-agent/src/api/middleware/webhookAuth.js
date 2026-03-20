'use strict';

/**
 * Webhook secret authentication middleware.
 *
 * Verifies that incoming webhook requests carry the expected shared secret.
 * The secret can be supplied in either:
 *   1. X-Webhook-Secret request header
 *   2. JSON payload field "secret"
 *
 * Header takes priority over payload field when both are present.
 *
 * Environment variables:
 *   TRADINGVIEW_WEBHOOK_SECRET — shared secret (required for auth to work)
 *
 * Startup behavior:
 *   - If TRADINGVIEW_WEBHOOK_SECRET is set    → enforce secret on all webhook requests.
 *   - If TRADINGVIEW_WEBHOOK_SECRET is unset  → reject every webhook request with 401.
 *     This is the safe default: a misconfigured deployment fails closed.
 *
 * Response codes:
 *   401 — secret missing from both header and payload
 *   403 — secret present but does not match TRADINGVIEW_WEBHOOK_SECRET
 *
 * Security notes:
 *   - The secret value is NEVER logged.
 *   - Only the presence/absence of the header/field is recorded.
 *   - Use HTTPS in production so the secret is not transmitted in plaintext.
 */

const logger = require('../../logger');

// Read once at module load — consistent within a server process.
const WEBHOOK_SECRET          = process.env.TRADINGVIEW_WEBHOOK_SECRET || '';
const WEBHOOK_SECRET_CONFIGURED = !!WEBHOOK_SECRET;

if (!WEBHOOK_SECRET_CONFIGURED) {
  logger.warn('webhook_auth.no_secret_configured', {
    reason:
      'TRADINGVIEW_WEBHOOK_SECRET is not set. ' +
      'All webhook requests will be rejected with 401. ' +
      'Set TRADINGVIEW_WEBHOOK_SECRET=<secret> to enable webhook ingestion.',
  });
}

/**
 * Express middleware that enforces webhook secret authentication.
 *
 * @param {import('express').Request}      req
 * @param {import('express').Response}     res
 * @param {import('express').NextFunction} next
 */
function requireWebhookSecret(req, res, next) {
  // Prefer header; fall back to payload field.
  const provided =
    req.headers['x-webhook-secret'] ||
    (req.body && typeof req.body === 'object' ? req.body.secret : undefined);

  if (!provided) {
    logger.warn('webhook_auth.missing_secret', { ip: req.ip, path: req.path });
    return res.status(401).json({
      error:
        'Missing webhook secret. ' +
        'Provide X-Webhook-Secret header or a "secret" field in the JSON payload.',
      code: 'unauthorized',
    });
  }

  // Never log the value of `provided`.
  if (!WEBHOOK_SECRET_CONFIGURED || provided !== WEBHOOK_SECRET) {
    logger.warn('webhook_auth.invalid_secret', { ip: req.ip, path: req.path });
    return res.status(403).json({
      error: 'Invalid webhook secret.',
      code:  'forbidden',
    });
  }

  return next();
}

module.exports = { requireWebhookSecret, WEBHOOK_SECRET_CONFIGURED };
