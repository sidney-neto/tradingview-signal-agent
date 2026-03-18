'use strict';

/**
 * CoinGecko adapter barrel export.
 *
 * Exposes all public adapter functions and the full error class set.
 *
 * Usage:
 *   const { getTrending, getTopCoins, getPrice, getMarketChart } = require('./src/adapters/coingecko');
 */

const { getTrending }    = require('./trending');
const { getTopCoins }    = require('./markets');
const { getPrice }       = require('./price');
const { getMarketChart } = require('./history');
const errors             = require('./errors');

module.exports = {
  // Data functions
  getTrending,
  getTopCoins,
  getPrice,
  getMarketChart,

  // Error classes (re-exported for instanceof checks by callers)
  ...errors,
};
