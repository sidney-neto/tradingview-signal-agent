'use strict';

/**
 * Bybit tickers adapter.
 *
 * Endpoint: GET /v5/market/tickers
 * Docs:     https://bybit-exchange.github.io/docs/v5/market/tickers
 *
 * Returns a compact perpetual snapshot: last price, mark price, index price,
 * current funding rate, open interest, basis, 24h volume/turnover, and next
 * funding time.
 *
 * This is the fastest way to get a combined perp context snapshot without
 * multiple separate requests.
 */

const { request }         = require('./client');
const { normalizeBybitSymbol, normalizeTicker } = require('./normalize');
const { MissingSymbolError, InvalidSymbolError, InvalidResponseError } = require('./errors');

const TICKERS_PATH = '/v5/market/tickers';

/**
 * Fetch and normalize the ticker snapshot for a single perpetual symbol.
 *
 * @param {string} symbol         - Symbol in any supported format
 * @param {object} [options={}]
 * @param {string} [options.category='linear'] - Bybit category
 * @param {number} [options.timeoutMs]         - Request timeout override
 * @returns {Promise<object>} Normalized ticker context
 * @throws {MissingSymbolError}
 * @throws {InvalidSymbolError}
 * @throws {InvalidResponseError}
 */
async function getTickerContext(symbol, options = {}) {
  if (!symbol) throw new MissingSymbolError();

  const bybitSymbol = normalizeBybitSymbol(symbol);
  if (!bybitSymbol) throw new InvalidSymbolError(symbol);

  const category = options.category || 'linear';

  const result = await request(
    TICKERS_PATH,
    { category, symbol: bybitSymbol },
    options.timeoutMs
  );

  const list = result && result.list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new InvalidSymbolError(bybitSymbol);
  }

  return normalizeTicker(list[0]);
}

module.exports = { getTickerContext };
