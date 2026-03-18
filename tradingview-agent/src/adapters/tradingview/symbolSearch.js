'use strict';

const { searchMarketV3 } = require('@mathieuc/tradingview');
const { normalizeSymbol } = require('./normalize');
const { SymbolNotFoundError } = require('./errors');

/**
 * Resolve a user query string to a single normalized symbol descriptor.
 *
 * Strategy:
 *  1. If the query looks like an exact exchange-qualified ID (e.g. "BINANCE:BTCUSDT"), try it directly.
 *  2. Otherwise, search and pick the best match using a simple scoring heuristic.
 *
 * @param {string} query - Symbol name or search term (e.g. "BTC", "AAPL", "BINANCE:BTCUSDT")
 * @param {{ filter?: string, maxResults?: number }} [options]
 * @returns {Promise<{ id: string, symbol: string, exchange: string, description: string, type: string }>}
 * @throws {SymbolNotFoundError}
 */
async function resolveSymbol(query, options = {}) {
  const { filter = '', maxResults = 30 } = options;
  const trimmed = query.trim();

  let results;
  try {
    results = await searchMarketV3(trimmed, filter, 0);
  } catch (err) {
    throw new SymbolNotFoundError(trimmed);
  }

  if (!results || results.length === 0) {
    throw new SymbolNotFoundError(trimmed);
  }

  const normalized = results.slice(0, maxResults).map(normalizeSymbol);
  const best = pickBestMatch(trimmed, normalized);

  if (!best) {
    throw new SymbolNotFoundError(trimmed);
  }

  return best;
}

/**
 * Pick the best-matching symbol from a list of normalized results.
 *
 * Scoring heuristic (higher = better):
 * - Exact symbol match (case-insensitive): +100
 * - Symbol starts with query:              +50
 * - Exact exchange:symbol match:           +80
 * - Crypto markets preferred for BTC/ETH-style queries: +20
 * - Preferred exchanges (BINANCE, NASDAQ, NYSE, COINBASE): +10
 *
 * @param {string} query
 * @param {Array} candidates
 * @returns {object|null}
 */
function pickBestMatch(query, candidates) {
  if (candidates.length === 0) return null;

  const q = query.toUpperCase();

  // If query is exchange-qualified, try an exact id match first
  if (q.includes(':')) {
    const exact = candidates.find(
      (c) => c.id.toUpperCase() === q
    );
    if (exact) return exact;
  }

  const PREFERRED_EXCHANGES = new Set(['BINANCE', 'NASDAQ', 'NYSE', 'COINBASE', 'CBOE', 'LSE', 'TSX']);

  const scored = candidates.map((c) => {
    let score = 0;
    const sym = (c.symbol || '').toUpperCase();
    const id  = (c.id || '').toUpperCase();

    if (sym === q)              score += 100;
    else if (sym.startsWith(q)) score +=  50;
    if (id === q)               score +=  80;

    if (PREFERRED_EXCHANGES.has((c.exchange || '').toUpperCase())) score += 10;

    // Crypto tickers often appended with USDT/USD – reward exact base match
    if (sym === q + 'USDT' || sym === q + 'USD') score += 30;

    return { candidate: c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].candidate;
}

/**
 * Search for symbols matching a query, returning up to `maxResults` normalized results.
 * Useful for disambiguation or listing suggestions.
 *
 * @param {string} query
 * @param {{ filter?: string, maxResults?: number }} [options]
 * @returns {Promise<Array>}
 */
async function searchSymbols(query, options = {}) {
  const { filter = '', maxResults = 10 } = options;
  const results = await searchMarketV3(query.trim(), filter, 0);
  if (!results || results.length === 0) return [];
  return results.slice(0, maxResults).map(normalizeSymbol);
}

module.exports = { resolveSymbol, searchSymbols };
