'use strict';

/**
 * OpenClaw delivery provider.
 *
 * HTTP POSTs the formatted payload to a configured endpoint.
 * Uses Node.js native fetch (no external HTTP library).
 *
 * Required env vars:
 *   OPENCLAW_DELIVERY_URL — full URL to POST to (e.g. https://openclaw.internal/ingest)
 *
 * Optional:
 *   OPENCLAW_API_KEY          — sent as Authorization: Bearer <key>
 *   OPENCLAW_SEND_FULL_ANALYSIS — "true" to include full analysis object (default: false)
 *   DELIVERY_TIMEOUT_MS       — HTTP request timeout in ms (default: 5000)
 */

const logger = require('../../logger');

const DELIVERY_URL       = process.env.OPENCLAW_DELIVERY_URL       || '';
const API_KEY            = process.env.OPENCLAW_API_KEY             || '';
const SEND_FULL_ANALYSIS = (process.env.OPENCLAW_SEND_FULL_ANALYSIS || '').toLowerCase() === 'true';

/**
 * Returns true when the provider is fully configured.
 */
function isConfigured() {
  return Boolean(DELIVERY_URL);
}

/**
 * Returns the SEND_FULL_ANALYSIS flag (used by dispatcher to build the payload).
 */
function sendFullAnalysis() {
  return SEND_FULL_ANALYSIS;
}

/**
 * POST a payload to the OpenClaw delivery endpoint.
 *
 * @param {object} payload   — pre-formatted OpenClaw payload object
 * @param {number} timeoutMs — request timeout in ms
 * @returns {Promise<{ provider: string, attempted: boolean, success: boolean, statusCode?: number, error?: string }>}
 */
async function send(payload, timeoutMs = 5000) {
  if (!isConfigured()) {
    return {
      provider:  'openclaw',
      attempted: false,
      success:   false,
      error:     'Provider not configured (OPENCLAW_DELIVERY_URL missing).',
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  let res;
  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);

    res = await fetch(DELIVERY_URL, {
      method:  'POST',
      headers,
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    });

    clearTimeout(timer);
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    logger.warn('delivery.openclaw.error', {
      error: isTimeout ? 'timeout' : err.message,
    });
    return {
      provider:  'openclaw',
      attempted: true,
      success:   false,
      error:     isTimeout ? `Request timed out after ${timeoutMs}ms` : err.message,
    };
  }

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (_) { /* ignore */ }
    logger.warn('delivery.openclaw.http_error', { statusCode: res.status, detail });
    return {
      provider:   'openclaw',
      attempted:  true,
      success:    false,
      statusCode: res.status,
      error:      `OpenClaw endpoint returned ${res.status}.`,
    };
  }

  return { provider: 'openclaw', attempted: true, success: true, statusCode: res.status };
}

module.exports = { send, isConfigured, sendFullAnalysis };
