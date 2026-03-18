'use strict';

/**
 * CoinGlass Liquidation adapter.
 *
 * Endpoint: GET /api/futures/liquidation/history
 *
 * Returns individual liquidation events for a symbol on a given exchange.
 * Used to detect recent squeeze/flush context and interpret forced moves.
 *
 * Response record shape:
 *   { exchange_name, symbol, base_asset, price, usd_value, side, time }
 *
 * Side semantics:
 *   side=1 (Buy)  → a LONG position was liquidated (engine bought back)
 *   side=2 (Sell) → a SHORT position was liquidated (engine sold)
 */

const { request } = require('./client');
const { unwrapResponse, normalizeTradingPair } = require('./normalize');
const defaults = require('../../config/defaults');

const PATH = '/api/futures/liquidation/history';

/** Minimum liquidation USD size to include in context. */
const DEFAULT_MIN_LIQUIDATION_AMOUNT = '1000';

/**
 * Classify liquidation bias from long vs short USD totals.
 *
 * @param {number} longUsd
 * @param {number} shortUsd
 * @returns {'long_dominated'|'short_dominated'|'mixed'}
 */
function classifyLiquidationBias(longUsd, shortUsd) {
  const total = longUsd + shortUsd;
  if (total === 0) return 'mixed';
  const longShare = longUsd / total;
  if (longShare >= 0.65) return 'long_dominated';
  if (longShare <= 0.35) return 'short_dominated';
  return 'mixed';
}

/**
 * Classify squeeze risk from the total recent liquidation volume (USD).
 *
 * Thresholds are deliberately generous — this is context, not a signal.
 *
 * @param {number} totalUsd
 * @returns {'high'|'moderate'|'low'}
 */
function classifySqueezeRisk(totalUsd) {
  if (totalUsd >= 5_000_000)  return 'high';
  if (totalUsd >= 500_000)    return 'moderate';
  return 'low';
}

/**
 * @typedef {object} LiquidationContext
 * @property {number}   recentLongLiquidations   - Total USD value of long liquidations
 * @property {number}   recentShortLiquidations  - Total USD value of short liquidations
 * @property {number}   totalLiquidations        - Combined USD value
 * @property {number}   eventCount               - Number of individual events
 * @property {string}   liquidationBias          - 'long_dominated' | 'short_dominated' | 'mixed'
 * @property {string}   squeezeRisk              - 'high' | 'moderate' | 'low'
 * @property {string}   source                   - 'coinglass'
 * @property {string[]} warnings
 */

/**
 * Fetch and normalize liquidation context for a symbol.
 *
 * @param {string} symbol - Raw symbol (e.g. 'BINANCE:BTCUSDT.P', 'BTCUSDT')
 * @param {object} [options]
 * @param {string} [options.exchange='Binance']
 * @param {string} [options.minLiquidationAmount='1000']  - Minimum USD threshold per event
 * @param {number} [options.startTime]                    - Start timestamp (ms)
 * @param {number} [options.endTime]                      - End timestamp (ms)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<LiquidationContext>}
 */
async function getLiquidationContext(symbol, options = {}) {
  const {
    exchange              = 'Binance',
    minLiquidationAmount  = DEFAULT_MIN_LIQUIDATION_AMOUNT,
    startTime,
    endTime,
    timeoutMs             = defaults.COINGLASS_TIMEOUT_MS,
  } = options;

  const pair     = normalizeTradingPair(symbol);
  const warnings = [];

  const raw = await request(PATH, {
    exchange,
    symbol:                 pair,
    min_liquidation_amount: String(minLiquidationAmount),
    start_time:             startTime || undefined,
    end_time:               endTime   || undefined,
  }, timeoutMs);

  const data = unwrapResponse(raw);

  if (!Array.isArray(data) || data.length === 0) {
    warnings.push('CoinGlass returned no liquidation records for this period.');
    return {
      recentLongLiquidations:  0,
      recentShortLiquidations: 0,
      totalLiquidations:       0,
      eventCount:              0,
      liquidationBias:         'mixed',
      squeezeRisk:             'low',
      source:                  'coinglass',
      warnings,
    };
  }

  let longUsd  = 0;
  let shortUsd = 0;

  for (const event of data) {
    const usd  = typeof event.usd_value === 'number' ? event.usd_value : parseFloat(event.usd_value) || 0;
    const side = event.side;

    if (side === 1) {
      // Buy order executed → long position liquidated
      longUsd += usd;
    } else if (side === 2) {
      // Sell order executed → short position liquidated
      shortUsd += usd;
    }
  }

  const totalUsd = longUsd + shortUsd;

  return {
    recentLongLiquidations:  longUsd,
    recentShortLiquidations: shortUsd,
    totalLiquidations:       totalUsd,
    eventCount:              data.length,
    liquidationBias:         classifyLiquidationBias(longUsd, shortUsd),
    squeezeRisk:             classifySqueezeRisk(totalUsd),
    source:                  'coinglass',
    warnings,
  };
}

module.exports = { getLiquidationContext };
