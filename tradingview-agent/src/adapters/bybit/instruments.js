'use strict';

/**
 * Bybit instruments adapter.
 *
 * Endpoint: GET /v5/market/instruments-info
 * Docs:     https://bybit-exchange.github.io/docs/v5/market/instrument
 *
 * Returns contract metadata: symbol, category, status, tick sizes, launch time, etc.
 * Useful for:
 *   - validating a symbol before other API calls
 *   - discovering contract specs (tickSize, qtyStep) for order sizing (future use)
 *   - detecting contract type (LinearPerpetual, LinearFutures, etc.)
 */

const { request } = require('./client');
const { normalizeBybitSymbol, normalizeInstrument } = require('./normalize');
const { MissingSymbolError, InvalidSymbolError, InvalidResponseError } = require('./errors');

const INSTRUMENTS_PATH = '/v5/market/instruments-info';

/**
 * Fetch and normalize instrument metadata for a single symbol.
 *
 * @param {string} symbol         - Symbol in any supported format (e.g. 'BTCUSDT', 'BTCUSDT.P', 'BINANCE:BTCUSDT.P')
 * @param {object} [options={}]
 * @param {string} [options.category='linear'] - Bybit category: 'linear' | 'inverse' | 'spot' | 'option'
 * @param {number} [options.timeoutMs]         - Request timeout override
 * @returns {Promise<object>} Normalized instrument info
 * @throws {MissingSymbolError}  if symbol is absent
 * @throws {InvalidSymbolError}  if symbol normalizes to empty or is not found
 * @throws {InvalidResponseError} if the API response shape is unexpected
 */
async function getInstrumentInfo(symbol, options = {}) {
  if (!symbol) throw new MissingSymbolError();

  const bybitSymbol = normalizeBybitSymbol(symbol);
  if (!bybitSymbol) throw new InvalidSymbolError(symbol);

  const category = options.category || 'linear';

  const result = await request(
    INSTRUMENTS_PATH,
    { category, symbol: bybitSymbol },
    options.timeoutMs
  );

  const list = result && result.list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new InvalidSymbolError(bybitSymbol);
  }

  return normalizeInstrument(list[0], category);
}

module.exports = { getInstrumentInfo };
