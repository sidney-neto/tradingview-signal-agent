'use strict';

/**
 * Bybit adapter normalization helpers.
 *
 * Provides:
 * - normalizeBybitSymbol()     — 'BINANCE:BTCUSDT.P' → 'BTCUSDT'
 * - safeFloat()                — parse float safely, returns null on NaN
 * - safeInt()                  — parse int safely, returns null on NaN
 * - average()                  — arithmetic mean, null-safe
 * - last()                     — last array element, null-safe
 * - normalizeInstrument()      — raw Bybit instrument record → app shape
 * - normalizeTicker()          — raw Bybit ticker record → app shape
 * - normalizeFundingRecord()   — raw funding history item → {fundingRate, timestamp}
 * - normalizeOIRecord()        — raw OI history item → {openInterest, timestamp}
 * - normalizeLSRecord()        — raw account-ratio item → {buyRatio, sellRatio, timestamp}
 */

/**
 * Normalize a raw symbol string into a Bybit-compatible contract symbol.
 *
 * Handles:
 *   'BINANCE:BTCUSDT.P' → 'BTCUSDT'
 *   'BTCUSDT.P'         → 'BTCUSDT'
 *   'BTCUSDT'           → 'BTCUSDT'
 *   'btcusdt'           → 'BTCUSDT'
 *
 * @param {string} symbol
 * @returns {string|null} Uppercased Bybit symbol, or null if input is invalid
 */
function normalizeBybitSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return null;

  let s = symbol.trim().toUpperCase();

  // Strip exchange prefix (e.g. 'BINANCE:')
  const colonIdx = s.indexOf(':');
  if (colonIdx !== -1) s = s.slice(colonIdx + 1);

  // Strip perpetual suffix (.P or .PERP)
  s = s.replace(/\.(P|PERP)$/, '');

  return s || null;
}

/**
 * Parse a value as a float. Returns null if falsy, NaN, or Infinity.
 *
 * @param {*} value
 * @returns {number|null}
 */
function safeFloat(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a value as an integer. Returns null if falsy or NaN.
 *
 * @param {*} value
 * @returns {number|null}
 */
function safeInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute the arithmetic mean of a numeric array.
 * Returns null if the array is empty or falsy.
 *
 * @param {number[]} values
 * @returns {number|null}
 */
function average(values) {
  if (!values || values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/**
 * Return the last element of an array, or null if empty/falsy.
 *
 * @param {*[]} arr
 * @returns {*}
 */
function last(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1];
}

/**
 * Normalize a Bybit instruments-info list item.
 *
 * Raw shape (linear category):
 *   { symbol, contractType, status, baseCoin, quoteCoin, settleCoin,
 *     launchTime, priceScale, priceFilter: { tickSize }, lotSizeFilter: { qtyStep } }
 *
 * @param {object} raw
 * @param {string} [category] - Category override (default: 'linear')
 * @returns {object}
 */
function normalizeInstrument(raw, category) {
  if (!raw || typeof raw !== 'object') return null;

  const priceFilter = raw.priceFilter   || {};
  const lotFilter   = raw.lotSizeFilter || {};

  return {
    symbol:       raw.symbol       || null,
    category:     category         || raw.category || null,
    baseCoin:     raw.baseCoin     || null,
    quoteCoin:    raw.quoteCoin    || null,
    settleCoin:   raw.settleCoin   || null,
    contractType: raw.contractType || null,
    status:       raw.status       || null,
    tickSize:     safeFloat(priceFilter.tickSize),
    qtyStep:      safeFloat(lotFilter.qtyStep),
    launchTime:   safeInt(raw.launchTime),
    source:       'bybit',
    warnings:     [],
  };
}

/**
 * Normalize a Bybit tickers list item (linear category).
 *
 * Raw shape:
 *   { symbol, lastPrice, markPrice, indexPrice, fundingRate, openInterest,
 *     openInterestValue, basis, volume24h, turnover24h, nextFundingTime, ... }
 *
 * @param {object} raw
 * @returns {object}
 */
function normalizeTicker(raw) {
  if (!raw || typeof raw !== 'object') return null;

  return {
    symbol:            raw.symbol || null,
    lastPrice:         safeFloat(raw.lastPrice),
    markPrice:         safeFloat(raw.markPrice),
    indexPrice:        safeFloat(raw.indexPrice),
    fundingRate:       safeFloat(raw.fundingRate),
    openInterest:      safeFloat(raw.openInterest),
    openInterestValue: safeFloat(raw.openInterestValue),
    basis:             safeFloat(raw.basis),
    volume24h:         safeFloat(raw.volume24h),
    turnover24h:       safeFloat(raw.turnover24h),
    nextFundingTime:   safeInt(raw.nextFundingTime),
    source:            'bybit',
    warnings:          [],
  };
}

/**
 * Normalize a single Bybit funding history record.
 *
 * Raw shape: { symbol, fundingRate, fundingRateTimestamp }
 *
 * @param {object} raw
 * @returns {{ fundingRate: number|null, timestamp: number|null }}
 */
function normalizeFundingRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    fundingRate: safeFloat(raw.fundingRate),
    timestamp:   safeInt(raw.fundingRateTimestamp),
  };
}

/**
 * Normalize a single Bybit open interest history record.
 *
 * Raw shape: { openInterest, timestamp }
 *
 * @param {object} raw
 * @returns {{ openInterest: number|null, timestamp: number|null }}
 */
function normalizeOIRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    openInterest: safeFloat(raw.openInterest),
    timestamp:    safeInt(raw.timestamp),
  };
}

/**
 * Normalize a single Bybit account-ratio (long/short) record.
 *
 * Raw shape: { symbol, buyRatio, sellRatio, timestamp }
 *
 * @param {object} raw
 * @returns {{ buyRatio: number|null, sellRatio: number|null, timestamp: number|null }}
 */
function normalizeLSRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    buyRatio:  safeFloat(raw.buyRatio),
    sellRatio: safeFloat(raw.sellRatio),
    timestamp: safeInt(raw.timestamp),
  };
}

module.exports = {
  normalizeBybitSymbol,
  safeFloat,
  safeInt,
  average,
  last,
  normalizeInstrument,
  normalizeTicker,
  normalizeFundingRecord,
  normalizeOIRecord,
  normalizeLSRecord,
};
