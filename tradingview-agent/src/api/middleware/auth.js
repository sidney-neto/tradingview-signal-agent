'use strict';

/**
 * API key authentication middleware.
 *
 * Protects endpoints that require authentication.
 * Callers must supply a valid `x-api-key` header.
 *
 * Environment variables:
 *   API_KEY        — the expected API key value. Must be set for auth to work.
 *   DISABLE_AUTH   — set to "true" to bypass auth entirely (development only).
 *                    Logs a prominent warning at startup if used.
 *
 * Startup behavior:
 *   - If API_KEY is set       → enforce key on all protected routes.
 *   - If API_KEY is unset and DISABLE_AUTH=true → allow all requests (dev mode warning logged once).
 *   - If API_KEY is unset and DISABLE_AUTH≠true → reject every protected request with 401.
 *     This is the safe default: a misconfigured production deployment fails closed.
 *
 * Response codes:
 *   401 — x-api-key header is missing (or API_KEY is not configured and DISABLE_AUTH≠true)
 *   403 — x-api-key header is present but does not match API_KEY
 *
 * Security note:
 *   The provided key value is NEVER logged. Only the presence/absence is recorded.
 */

const logger = require('../../logger');

// Read once at module load — consistent within a server process.
const API_KEY      = process.env.API_KEY      || '';
const AUTH_DISABLED = process.env.DISABLE_AUTH === 'true';

// Emit a one-time startup advisory so the operator knows the auth posture.
if (AUTH_DISABLED) {
  logger.warn('auth.disabled', {
    reason: 'DISABLE_AUTH=true — all requests will be accepted without authentication (dev mode)',
  });
} else if (!API_KEY) {
  logger.warn('auth.no_key_configured', {
    reason: 'API_KEY is not set. All protected requests will be rejected with 401. ' +
            'Set API_KEY=<secret> or DISABLE_AUTH=true to run in dev mode.',
  });
}

/**
 * Express middleware that enforces x-api-key header authentication.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireApiKey(req, res, next) {
  if (AUTH_DISABLED) return next();

  const provided = req.headers['x-api-key'];

  // No header at all → 401 Unauthorized
  if (!provided) {
    logger.warn('auth.missing_key', { ip: req.ip, path: req.path });
    return res.status(401).json({
      error: 'Missing x-api-key header',
      code:  'unauthorized',
    });
  }

  // Key present but wrong (or API_KEY not configured) → 403 Forbidden
  // Never log the value of `provided` to avoid secret leakage.
  if (!API_KEY || provided !== API_KEY) {
    logger.warn('auth.invalid_key', { ip: req.ip, path: req.path });
    return res.status(403).json({
      error: 'Invalid API key',
      code:  'forbidden',
    });
  }

  return next();
}

module.exports = { requireApiKey, AUTH_DISABLED, API_KEY_CONFIGURED: !!API_KEY };
