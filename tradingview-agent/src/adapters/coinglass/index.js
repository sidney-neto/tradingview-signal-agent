'use strict';

/**
 * CoinGlass adapter — public API.
 *
 * Exposes the five context functions and all error classes.
 * Each function is independently importable from its own module,
 * but this barrel makes it convenient to import from one place.
 *
 * Usage:
 *   const { getFundingContext, getMacroContext } = require('./src/adapters/coinglass');
 *
 * All functions require COINGLASS_API_KEY to be set in the environment.
 * They throw MissingApiKeyError synchronously on the first call if the key is absent.
 */

const { getFundingContext }      = require('./funding');
const { getOpenInterestContext } = require('./openInterest');
const { getLongShortContext }    = require('./longShort');
const { getLiquidationContext }  = require('./liquidation');
const { getMacroContext }        = require('./macro');

const errors = require('./errors');

module.exports = {
  // Context functions
  getFundingContext,
  getOpenInterestContext,
  getLongShortContext,
  getLiquidationContext,
  getMacroContext,

  // Error classes — for instanceof checks in callers
  errors,
};
