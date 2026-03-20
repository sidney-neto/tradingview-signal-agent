'use strict';

/**
 * Bybit adapter — public API.
 *
 * Exposes all public read-only market data functions and error classes.
 *
 * Usage:
 *   const {
 *     getInstrumentInfo,
 *     getTickerContext,
 *     getFundingContext,
 *     getOpenInterestContext,
 *     getLongShortContext,
 *   } = require('./src/adapters/bybit');
 *
 * All functions use public Bybit V5 endpoints.
 * No API key required for the functions exposed here.
 *
 * ── What is NOT here (future work) ──────────────────────────────────────────
 * - WebSocket streaming  → add src/adapters/bybit/ws.js
 * - Private/authenticated endpoints (orders, positions, account)
 *   → add src/adapters/bybit/privateClient.js with HMAC-SHA256 signing
 * - Analyst integration into the signal waterfall
 *   → wire through src/analyzer/bybitContext.js (similar to perpContext.js)
 */

const { getInstrumentInfo }     = require('./instruments');
const { getTickerContext }       = require('./tickers');
const { getFundingContext }      = require('./funding');
const { getOpenInterestContext } = require('./openInterest');
const { getLongShortContext }    = require('./longShort');

const errors = require('./errors');

module.exports = {
  // Market data functions
  getInstrumentInfo,
  getTickerContext,
  getFundingContext,
  getOpenInterestContext,
  getLongShortContext,

  // Error classes — for instanceof checks in callers
  errors,
};
