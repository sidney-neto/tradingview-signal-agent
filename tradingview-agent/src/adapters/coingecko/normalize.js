'use strict';

/**
 * CoinGecko normalization helpers.
 *
 * Provides:
 * - normalizeCoin()          — raw /coins/markets record → compact app shape
 * - normalizeTrendingCoin()  — raw /search/trending coin item → compact app shape
 * - normalizeCategory()      — raw trending category item → compact shape
 * - normalizePricePoint()    — [timestamp, price] tuple → { time, price }
 * - resolveVsCurrency()      — validate/default the vs_currency param
 * - safeFloat()              — parse a numeric value safely
 */

/** Accepted quote currencies for price lookups */
const SUPPORTED_VS_CURRENCIES = new Set(['usd', 'eur', 'btc', 'eth']);

/**
 * Normalize a single record from GET /coins/markets into a compact, app-friendly shape.
 *
 * @param {object} raw
 * @returns {{
 *   id: string,
 *   symbol: string,
 *   name: string,
 *   rank: number|null,
 *   price: number|null,
 *   marketCap: number|null,
 *   priceChange24h: number|null,
 *   priceChangePercent24h: number|null,
 *   volume24h: number|null,
 *   high24h: number|null,
 *   low24h: number|null,
 *   thumb: string|null,
 * }}
 */
function normalizeCoin(raw) {
  return {
    id:                    raw.id            || '',
    symbol:                (raw.symbol       || '').toUpperCase(),
    name:                  raw.name          || '',
    rank:                  safeInt(raw.market_cap_rank),
    price:                 safeFloat(raw.current_price),
    marketCap:             safeFloat(raw.market_cap),
    priceChange24h:        safeFloat(raw.price_change_24h),
    priceChangePercent24h: safeFloat(raw.price_change_percentage_24h),
    volume24h:             safeFloat(raw.total_volume),
    high24h:               safeFloat(raw.high_24h),
    low24h:                safeFloat(raw.low_24h),
    thumb:                 raw.image || null,
  };
}

/**
 * Normalize a single trending coin item from GET /search/trending.
 *
 * The raw shape wraps each entry as `{ item: { id, coin_id, name, symbol, ... } }`.
 *
 * @param {{ item: object }} raw
 * @returns {{
 *   id: string,
 *   symbol: string,
 *   name: string,
 *   marketCapRank: number|null,
 *   priceChangePercent24h: number|null,
 *   score: number|null,
 *   thumb: string|null,
 * }}
 */
function normalizeTrendingCoin(raw) {
  const item = raw.item || raw;
  const data = item.data || {};
  return {
    id:                    item.id        || '',
    symbol:                (item.symbol   || '').toUpperCase(),
    name:                  item.name      || '',
    marketCapRank:         safeInt(item.market_cap_rank),
    // price_change_percentage_24h may be nested under item.data on newer API versions
    priceChangePercent24h: safeFloat(data.price_change_percentage_24h?.usd ?? item.price_change_percentage_24h),
    score:                 safeInt(item.score),
    thumb:                 item.thumb || item.small || null,
  };
}

/**
 * Normalize a trending category item from GET /search/trending.
 *
 * @param {object} raw
 * @returns {{
 *   id: string,
 *   name: string,
 *   marketCap1hChange: number|null,
 * }}
 */
function normalizeCategory(raw) {
  return {
    id:                raw.id              || '',
    name:              raw.name            || '',
    marketCap1hChange: safeFloat(raw.market_cap_1h_change),
  };
}

/**
 * Normalize a raw [timestamp_ms, value] price/volume data point
 * from GET /coins/{id}/market_chart into { time, value }.
 *
 * @param {[number, number]} tuple
 * @returns {{ time: number, value: number }}
 */
function normalizePricePoint(tuple) {
  return { time: tuple[0], value: tuple[1] };
}

/**
 * Validate and normalise a vs_currency param.
 * Falls back to 'usd' for unknown currencies.
 *
 * @param {string} [raw]
 * @returns {string}
 */
function resolveVsCurrency(raw) {
  const lower = (raw || 'usd').toLowerCase().trim();
  return SUPPORTED_VS_CURRENCIES.has(lower) ? lower : 'usd';
}

/**
 * Safely parse a value as a float. Returns null for NaN / null / undefined.
 *
 * @param {*} v
 * @returns {number|null}
 */
function safeFloat(v) {
  if (v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/**
 * Safely parse a value as an integer. Returns null for NaN / null / undefined.
 *
 * @param {*} v
 * @returns {number|null}
 */
function safeInt(v) {
  if (v === null || v === undefined) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

module.exports = {
  normalizeCoin,
  normalizeTrendingCoin,
  normalizeCategory,
  normalizePricePoint,
  resolveVsCurrency,
  safeFloat,
  safeInt,
};
