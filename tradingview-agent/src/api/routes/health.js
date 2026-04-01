'use strict';

const { Router }  = require('express');
const { version } = require('../../../package.json');
const { getSupportedTimeframes } = require('../../utils/timeframes');
const { CACHE_ENABLED } = require('../../cache/overlayCache');

const router    = Router();
const startedAt = Date.now();

/**
 * GET /health
 *
 * Returns a structured health payload including:
 *   - API version and uptime
 *   - Provider configuration status (which API keys are configured)
 *   - Cache status
 *   - Delivery configuration
 *   - Supported timeframes
 *
 * This endpoint does NOT perform live checks against external providers.
 * It reports configuration state only — for speed and reliability.
 */
router.get('/', (_req, res) => {
  const uptimeSec = Math.round((Date.now() - startedAt) / 1000);

  const providers = {
    coinglass: {
      configured: !!process.env.COINGLASS_API_KEY,
    },
    bybit: {
      configured: true, // Bybit uses public endpoints — always available
    },
    coingecko: {
      configured: !!process.env.COINGECKO_API_KEY,
      tier: process.env.COINGECKO_API_TIER || 'demo',
    },
  };

  const delivery = {
    enabled:   (process.env.DELIVERY_ENABLED || '').toLowerCase() === 'true',
    providers: (process.env.DELIVERY_PROVIDER || 'telegram').split(',').map((p) => p.trim()),
  };

  const cache = {
    enabled: CACHE_ENABLED,
  };

  res.json({
    status:     'ok',
    version,
    uptimeSec,
    providers,
    cache,
    delivery,
    timeframes: getSupportedTimeframes(),
    timestamp:  new Date().toISOString(),
  });
});

module.exports = router;
