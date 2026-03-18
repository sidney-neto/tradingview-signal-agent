'use strict';

const { getSupportedTimeframes } = require('./timeframes');

/**
 * Validate the inputs to analyzeMarket.
 * Throws a descriptive Error if any input is invalid.
 *
 * @param {object} params
 * @param {string} params.query - Symbol query string (e.g. "BTC", "AAPL", "BINANCE:BTCUSDT")
 * @param {string} params.timeframe - User-facing timeframe label (e.g. "1h")
 */
function validateAnalyzeParams({ query, timeframe } = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('Missing or invalid "query" parameter. Provide a symbol name or search term.');
  }

  if (!timeframe || typeof timeframe !== 'string' || !timeframe.trim()) {
    throw new Error(
      `Missing or invalid "timeframe" parameter. Supported values: ${getSupportedTimeframes().join(', ')}`
    );
  }
}

module.exports = { validateAnalyzeParams };
