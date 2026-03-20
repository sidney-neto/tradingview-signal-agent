'use strict';

/**
 * Backtesting framework — barrel export.
 *
 * Public surface:
 *   analyzeCandles       — run the analysis pipeline on pre-loaded candles (no network)
 *   runBacktest          — rolling-window replay over a historical candle array
 *   evaluateOutcome      — determine win/loss/expired for a single signal
 *   computeExcursions    — compute MFE/MAE for a signal over a forward window
 *   buildReport          — aggregate step results into a summary report
 *   aggregateReports     — combine multiple per-fixture reports into one
 *   formatTable          — render a report as a plain-text table string
 *   validateFixture      — validate a raw candle fixture array (throws FixtureValidationError)
 *   FixtureValidationError — error class thrown by validateFixture
 *   DEFAULT_BUCKETS      — default confidence bucket definitions
 *   assignBucket         — assign a confidence score to a bucket label
 */

const { analyzeCandles }                      = require('./analyzeCandles');
const { runBacktest }                         = require('./runner');
const { evaluateOutcome, computeExcursions }  = require('./evaluate');
const { buildReport, aggregateReports, formatTable } = require('./report');
const { validateFixture, FixtureValidationError }    = require('./validateFixture');
const { DEFAULT_BUCKETS, assignBucket }              = require('./buckets');

module.exports = {
  analyzeCandles,
  runBacktest,
  evaluateOutcome,
  computeExcursions,
  buildReport,
  aggregateReports,
  formatTable,
  validateFixture,
  FixtureValidationError,
  DEFAULT_BUCKETS,
  assignBucket,
};
