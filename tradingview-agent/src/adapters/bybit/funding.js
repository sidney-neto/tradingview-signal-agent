'use strict';

/**
 * Bybit funding rate adapter.
 *
 * Endpoint: GET /v5/market/funding/history
 * Docs:     https://bybit-exchange.github.io/docs/v5/market/history-fund-rate
 *
 * Fetches recent funding rate history and produces a normalized funding context:
 * - currentFunding    — most recent rate
 * - averageFunding    — mean over the fetched window
 * - fundingBias       — directional crowd label
 * - fundingRegime     — intensity classification
 * - latestTimestamp   — timestamp of the most recent record (ms)
 * - source            — 'bybit'
 * - warnings          — non-fatal issues
 *
 * Funding bias thresholds (annualized intuition; per-8h rates):
 *   > +0.05%  (0.0005)  → long_crowded
 *   > +0.01%  (0.0001)  → neutral_positive
 *   < -0.05%  (-0.0005) → short_crowded
 *   < -0.01%  (-0.0001) → neutral_negative
 *   otherwise           → neutral
 */

const defaults = require('../../config/defaults');
const { request }         = require('./client');
const {
  normalizeBybitSymbol,
  normalizeFundingRecord,
  average,
  last,
} = require('./normalize');
const { MissingSymbolError, InvalidSymbolError } = require('./errors');

const FUNDING_PATH = '/v5/market/funding/history';

/**
 * Classify the directional bias from average funding.
 *
 * @param {number} avg
 * @returns {string}
 */
function classifyFundingBias(avg) {
  if (avg >  0.0005) return 'long_crowded';
  if (avg >  0.0001) return 'neutral_positive';
  if (avg < -0.0005) return 'short_crowded';
  if (avg < -0.0001) return 'neutral_negative';
  return 'neutral';
}

/**
 * Classify the intensity regime from average funding.
 *
 * @param {number} avg
 * @returns {string}
 */
function classifyFundingRegime(avg) {
  if (avg >  0.001)  return 'extremely_crowded_long';
  if (avg >  0.0003) return 'crowded_long';
  if (avg < -0.001)  return 'extremely_crowded_short';
  if (avg < -0.0003) return 'crowded_short';
  return 'balanced';
}

/**
 * Fetch and normalize the funding context for a symbol.
 *
 * @param {string} symbol         - Symbol in any supported format
 * @param {object} [options={}]
 * @param {string} [options.category='linear'] - Bybit category
 * @param {number} [options.limit]             - Number of records (default: BYBIT_FUNDING_LIMIT)
 * @param {number} [options.timeoutMs]         - Request timeout override
 * @returns {Promise<object>} Normalized funding context
 * @throws {MissingSymbolError}
 * @throws {InvalidSymbolError}
 */
async function getFundingContext(symbol, options = {}) {
  if (!symbol) throw new MissingSymbolError();

  const bybitSymbol = normalizeBybitSymbol(symbol);
  if (!bybitSymbol) throw new InvalidSymbolError(symbol);

  const category = options.category || 'linear';
  const limit    = options.limit    || defaults.BYBIT_FUNDING_LIMIT;

  const result = await request(
    FUNDING_PATH,
    { category, symbol: bybitSymbol, limit },
    options.timeoutMs
  );

  const warnings = [];
  const rawList  = (result && result.list) || [];

  if (rawList.length === 0) {
    warnings.push('No funding records returned — funding context unavailable.');
    return {
      currentFunding:  null,
      averageFunding:  null,
      fundingBias:     'neutral',
      fundingRegime:   'balanced',
      latestTimestamp: null,
      source:          'bybit',
      warnings,
    };
  }

  const records = rawList.map(normalizeFundingRecord).filter(Boolean);
  const rates   = records.map((r) => r.fundingRate).filter((v) => v !== null);

  // Bybit returns records newest-first. records[0] is the most recent settlement.
  const currentRecord  = records[0] || null;
  const currentFunding = currentRecord ? currentRecord.fundingRate : null;
  const averageFunding = average(rates);

  if (rates.length < rawList.length) {
    warnings.push(`${rawList.length - rates.length} funding record(s) had invalid rate values.`);
  }

  return {
    currentFunding,
    averageFunding,
    fundingBias:     averageFunding !== null ? classifyFundingBias(averageFunding)  : 'neutral',
    fundingRegime:   averageFunding !== null ? classifyFundingRegime(averageFunding) : 'balanced',
    latestTimestamp: currentRecord ? currentRecord.timestamp : null,
    source:          'bybit',
    warnings,
  };
}

module.exports = { getFundingContext, classifyFundingBias, classifyFundingRegime };
