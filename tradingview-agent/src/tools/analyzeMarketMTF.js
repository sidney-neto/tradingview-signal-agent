'use strict';

/**
 * analyzeMarketMTF — multi-timeframe analysis wrapper.
 *
 * Runs analyzeMarket concurrently across multiple timeframes and assembles
 * the results into a structured object with a formatted PT-BR summary.
 *
 * Usage:
 *   const { analyzeMarketMTF } = require('./analyzeMarketMTF');
 *   const result = await analyzeMarketMTF({
 *     query: 'BTC',
 *     timeframes: ['1h', '4h', '1d'],
 *   });
 *
 * Input:
 *   { query: string, timeframes: string[], options?: object }
 *
 * Output:
 *   {
 *     query,
 *     timeframes,
 *     results:    { [timeframe]: analyzeMarketResult },
 *     errors:     { [timeframe]: { error: string, code: string|null } },
 *     warnings:   string[],
 *     mtfSummary: string | null,   — PT-BR multi-TF block (null if <2 succeeded)
 *   }
 */

const { analyzeMarket } = require('./analyzeMarket');
const { buildMTFSummary } = require('../analyzer/formatMTF');
const { getSupportedTimeframes } = require('../utils/timeframes');
const logger = require('../logger');

/**
 * Run analyzeMarket for each timeframe concurrently and aggregate results.
 *
 * @param {object} params
 * @param {string}   params.query       - Symbol name or search query
 * @param {string[]} params.timeframes  - Non-empty array of valid timeframe labels
 * @param {object}   [params.options]   - Options forwarded to each analyzeMarket call
 * @returns {Promise<object>}
 */
async function analyzeMarketMTF({ query, timeframes, options = {} }) {
  // --- Input validation ---
  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new Error('analyzeMarketMTF: query is required and must be a non-empty string');
  }

  if (!Array.isArray(timeframes) || timeframes.length === 0) {
    throw new Error('analyzeMarketMTF: timeframes must be a non-empty array');
  }

  const supported = getSupportedTimeframes();
  const unsupported = timeframes.filter((tf) => !supported.includes(tf));
  if (unsupported.length > 0) {
    throw new Error(
      `analyzeMarketMTF: unsupported timeframe(s): ${unsupported.join(', ')}. ` +
      `Supported: ${supported.join(', ')}`
    );
  }

  // Deduplicate while preserving order
  const uniqueTimeframes = [...new Set(timeframes)];

  logger.info('analysis.mtf.start', { query, timeframes: uniqueTimeframes });

  // --- Run all timeframes concurrently ---
  const settled = await Promise.allSettled(
    uniqueTimeframes.map((tf) => analyzeMarket({ query, timeframe: tf, options }))
  );

  const results  = {};
  const errors   = {};
  const warnings = [];

  settled.forEach((outcome, i) => {
    const tf = uniqueTimeframes[i];
    if (outcome.status === 'fulfilled') {
      results[tf] = outcome.value;
    } else {
      const err = outcome.reason;
      errors[tf] = { error: err.message, code: err.code || null };
      warnings.push(`analyzeMarketMTF: ${tf} failed — ${err.message}`);
      logger.warn('analysis.mtf.timeframe.failed', { query, timeframe: tf, error: err.message });
    }
  });

  // --- Build formatted MTF summary from successful results ---
  // buildMTFSummary expects results ordered shortest → longest TF.
  // We preserve the user-supplied order (which is typically ascending).
  const successfulResults = uniqueTimeframes
    .filter((tf) => results[tf])
    .map((tf) => results[tf]);

  const mtfSummary = successfulResults.length >= 2
    ? buildMTFSummary(successfulResults)
    : null;

  const successCount = successfulResults.length;
  const errorCount   = Object.keys(errors).length;

  logger.info('analysis.mtf.complete', { query, successCount, errorCount });

  return {
    query,
    timeframes: uniqueTimeframes,
    results,
    errors,
    warnings,
    mtfSummary,
  };
}

module.exports = { analyzeMarketMTF };
