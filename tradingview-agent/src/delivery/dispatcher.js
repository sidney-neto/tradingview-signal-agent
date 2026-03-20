'use strict';

/**
 * Delivery dispatcher — fans out analysis results to configured providers.
 *
 * Environment variables:
 *   DELIVERY_ENABLED     — "true" to enable delivery (default: false)
 *   DELIVERY_PROVIDER    — comma-separated list: "telegram", "openclaw", or "telegram,openclaw"
 *   DELIVERY_TIMEOUT_MS  — per-provider HTTP timeout in ms (default: 5000)
 *
 * Provider failures are isolated: one failure does not prevent others from running.
 * Delivery failure never propagates to the caller — it is a non-fatal side effect.
 */

const logger    = require('../logger');
const formatter = require('./formatter');
const telegram  = require('./providers/telegram');
const openclaw  = require('./providers/openclaw');

const DELIVERY_ENABLED  = (process.env.DELIVERY_ENABLED  || '').toLowerCase() === 'true';
const DELIVERY_PROVIDER = (process.env.DELIVERY_PROVIDER || 'telegram').toLowerCase();
const DELIVERY_TIMEOUT_MS = parseInt(process.env.DELIVERY_TIMEOUT_MS || '5000', 10);

/**
 * Resolve which providers to use from the DELIVERY_PROVIDER env var.
 * Accepts comma-separated values: "telegram", "openclaw", "telegram,openclaw".
 *
 * @returns {string[]} list of provider names
 */
function resolveProviders() {
  return DELIVERY_PROVIDER
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p === 'telegram' || p === 'openclaw');
}

/**
 * Deliver an analysis result to all configured providers.
 *
 * @param {object} opts
 * @param {string} opts.source          — always 'tradingview_webhook'
 * @param {object} opts.request         — normalized request: { query, timeframe }
 * @param {object} opts.analysis        — full analysis result from analyzeMarket()
 * @param {object} opts.rawPayload      — original webhook body (secret will be stripped)
 * @param {string[]} opts.warnings      — analysis warnings
 * @param {string} opts.correlationId   — request correlation ID
 * @returns {Promise<Array<{ provider: string, attempted: boolean, success: boolean, statusCode?: number, error?: string }>>}
 */
async function deliverAnalysis({
  source = 'tradingview_webhook',
  request,
  analysis,
  rawPayload,
  warnings,
  correlationId,
}) {
  if (!DELIVERY_ENABLED) {
    return [{ provider: 'none', attempted: false, success: false, error: 'Delivery disabled.' }];
  }

  const providers = resolveProviders();
  if (providers.length === 0) {
    logger.warn('delivery.no_valid_providers', { DELIVERY_PROVIDER });
    return [{ provider: 'none', attempted: false, success: false, error: 'No valid providers configured.' }];
  }

  // Build provider-specific payloads once
  const telegramText     = providers.includes('telegram')
    ? formatter.formatTelegramMessage({ analysis, request, correlationId })
    : null;

  const openclawPayload  = providers.includes('openclaw')
    ? formatter.formatOpenClawPayload({
        source,
        request,
        analysis,
        rawPayload,
        warnings,
        correlationId,
        sendFullAnalysis: openclaw.sendFullAnalysis(),
      })
    : null;

  // Fan out — all providers run concurrently, failures are isolated
  const tasks = providers.map(async (provider) => {
    try {
      if (provider === 'telegram') {
        const result = await telegram.send(telegramText, DELIVERY_TIMEOUT_MS);
        logger.info('delivery.telegram.result', { correlationId, ...result });
        return result;
      }
      if (provider === 'openclaw') {
        const result = await openclaw.send(openclawPayload, DELIVERY_TIMEOUT_MS);
        logger.info('delivery.openclaw.result', { correlationId, ...result });
        return result;
      }
    } catch (err) {
      // Unexpected error in provider — must not propagate
      logger.error('delivery.provider_crash', { correlationId, provider, error: err.message });
      return { provider, attempted: true, success: false, error: err.message };
    }
  });

  return Promise.all(tasks);
}

module.exports = { deliverAnalysis, resolveProviders, DELIVERY_ENABLED };
