'use strict';

/**
 * CoinGlass response normalization helpers.
 *
 * Provides:
 * - unwrapResponse()        — validates and unwraps the standard CG envelope
 * - normalizeOhlcRecord()   — {t, o, h, l, c} → typed numbers
 * - extractBaseCoin()       — 'BINANCE:MMTUSDT.P' → 'MMT'
 * - normalizeTradingPair()  — 'BINANCE:MMTUSDT.P' → 'MMTUSDT'
 * - average()               — numeric mean, null-safe
 * - last()                  — last element, null-safe
 */

const { InvalidResponseError, InvalidSymbolError, PlanRestrictedError } = require('./errors');

/** Quote assets to strip when extracting the base coin from a trading pair symbol. */
const QUOTE_ASSETS = ['USDT', 'USDC', 'USD', 'BUSD', 'FDUSD', 'TUSD', 'DAI', 'BTC', 'ETH'];

/**
 * Validate and unwrap a standard CoinGlass API response envelope.
 *
 * CoinGlass wraps every response as:
 *   { code: '0', msg: 'success', data: <payload> }
 *
 * A code of '0' (or 0) indicates success. Any other code is treated as an
 * application-level error distinct from HTTP errors.
 *
 * @param {*} raw - Parsed JSON response
 * @returns {*}   - The `data` payload
 * @throws {InvalidResponseError}
 */
function unwrapResponse(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new InvalidResponseError('Expected a JSON object response from CoinGlass.');
  }

  // Accept both string '0' and numeric 0
  if (raw.code !== '0' && raw.code !== 0) {
    const msg = (raw.msg || '').toLowerCase();
    if (msg.includes('upgrade') || msg.includes('plan')) {
      throw new PlanRestrictedError(raw.msg);
    }
    throw new InvalidResponseError(
      `CoinGlass API error: code=${raw.code} msg=${raw.msg || '(no message)'}`
    );
  }

  if (raw.data === undefined) {
    throw new InvalidResponseError('CoinGlass response is missing the "data" field.');
  }

  return raw.data;
}

/**
 * Normalize a single CoinGlass OHLC record.
 *
 * Raw shape:  { t: number, o: string, h: string, l: string, c: string }
 * Returns:    { time: number, open: number, high: number, low: number, close: number }
 *
 * @param {{ t: number, o: string|number, h: string|number, l: string|number, c: string|number }} record
 * @returns {{ time: number, open: number, high: number, low: number, close: number }}
 */
function normalizeOhlcRecord(record) {
  return {
    time:  record.t,
    open:  parseFloat(record.o),
    high:  parseFloat(record.h),
    low:   parseFloat(record.l),
    close: parseFloat(record.c),
  };
}

/**
 * Extract the base coin from a raw symbol string.
 *
 * Handles:
 *   'BINANCE:MMTUSDT.P' → 'MMT'
 *   'BTCUSDT'           → 'BTC'
 *   'BTC'               → 'BTC'
 *   'ETHUSDT.P'         → 'ETH'
 *
 * @param {string} raw
 * @returns {string} Uppercased base coin
 * @throws {InvalidSymbolError} if input is missing or not a string
 */
function extractBaseCoin(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new InvalidSymbolError(raw);
  }

  // Strip exchange prefix (e.g., 'BINANCE:')
  const stripped = raw.includes(':') ? raw.split(':')[1] : raw;

  // Strip perpetual suffix (.P or .PERP)
  const withoutSuffix = stripped.replace(/\.(P|PERP)$/i, '');

  // Strip known quote asset suffix
  for (const quote of QUOTE_ASSETS) {
    if (withoutSuffix.toUpperCase().endsWith(quote) && withoutSuffix.length > quote.length) {
      return withoutSuffix.slice(0, -quote.length).toUpperCase();
    }
  }

  return withoutSuffix.toUpperCase();
}

/**
 * Normalize a symbol into a CoinGlass-compatible exchange trading pair.
 *
 * Strips exchange prefix and perpetual suffix; keeps the full pair including quote asset.
 *
 *   'BINANCE:MMTUSDT.P' → 'MMTUSDT'
 *   'BTCUSDT.P'         → 'BTCUSDT'
 *   'BTCUSDT'           → 'BTCUSDT'
 *
 * @param {string} raw
 * @returns {string} Uppercased trading pair
 * @throws {InvalidSymbolError}
 */
function normalizeTradingPair(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new InvalidSymbolError(raw);
  }

  const stripped = raw.includes(':') ? raw.split(':')[1] : raw;
  return stripped.replace(/\.(P|PERP)$/i, '').toUpperCase();
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

module.exports = {
  unwrapResponse,
  normalizeOhlcRecord,
  extractBaseCoin,
  normalizeTradingPair,
  average,
  last,
};
