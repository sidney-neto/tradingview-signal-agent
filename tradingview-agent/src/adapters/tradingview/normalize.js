'use strict';

/**
 * Normalization helpers for raw TradingView data structures.
 *
 * The PricePeriod shape from tradingview-api is:
 *   { time, open, close, max, min, volume }
 *
 * We normalize to a consistent internal candle shape:
 *   { time, open, high, low, close, volume }
 */

/**
 * Normalize a single TradingView PricePeriod into a candle object.
 *
 * @param {{ time: number, open: number, close: number, max: number, min: number, volume: number }} period
 * @returns {{ time: number, open: number, high: number, low: number, close: number, volume: number }}
 */
function normalizePeriod(period) {
  return {
    time:   period.time,
    open:   period.open,
    high:   period.max,
    low:    period.min,
    close:  period.close,
    volume: period.volume,
  };
}

/**
 * Normalize an array of PricePeriods, filtering invalid entries, sorting oldest-first.
 *
 * @param {Array} periods - Raw PricePeriod array from ChartSession.periods
 * @returns {Array} Normalized candle array sorted ascending by time
 */
function normalizePeriods(periods) {
  if (!Array.isArray(periods)) return [];

  return periods
    .filter(
      (p) =>
        p &&
        typeof p.time === 'number' &&
        typeof p.open === 'number' &&
        typeof p.close === 'number'
    )
    .map(normalizePeriod)
    .sort((a, b) => a.time - b.time);
}

/**
 * Normalize a raw market search result into a minimal symbol descriptor.
 *
 * @param {object} raw - Raw result item from searchMarketV3
 * @returns {{ id: string, symbol: string, exchange: string, description: string, type: string }}
 */
function normalizeSymbol(raw) {
  return {
    id:          raw.id || `${raw.exchange}:${raw.symbol}`,
    symbol:      raw.symbol || '',
    exchange:    raw.exchange || raw.fullExchange || '',
    description: raw.description || '',
    type:        raw.type || '',
  };
}

module.exports = { normalizePeriod, normalizePeriods, normalizeSymbol };
