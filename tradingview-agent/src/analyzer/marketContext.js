'use strict';

/**
 * marketContext — bridge between the CoinGecko adapter and the analysis engine.
 *
 * Fetches market breadth (top coins) and trending data from CoinGecko concurrently,
 * then normalizes the combined result into two compact output shapes:
 *
 *   marketBreadthContext — broad market tone (regime, gainers/losers ratio)
 *   trendingContext      — is the analyzed symbol currently trending on CoinGecko?
 *
 * Also provides a pure confidence-adjustment function:
 *
 *   computeMarketContextAdjustment() — small optional confidence delta for altcoin
 *     bullish setups, based on breadth regime and trending status.
 *     Max effect: [-0.05, +0.08]. BTC and ETH are excluded.
 *     Only applied to pullback_watch and breakout_watch signals.
 *
 * Design principles:
 *  - Entirely optional: if COINGECKO_API_KEY is absent, returns null/null silently.
 *  - Resilient: each CoinGecko fetch is individually caught via Promise.allSettled.
 *  - Never throws: all errors are captured; caller always gets a safe result.
 *  - Pure helpers are exported for testability without any live API calls.
 */

const { getTopCoins }  = require('../adapters/coingecko/markets');
const { getTrending }  = require('../adapters/coingecko/trending');
const { extractBaseCoin } = require('../adapters/coinglass/normalize');

/**
 * Extract the uppercase base coin from a raw symbol string.
 * Returns null on any parse failure.
 *
 * @param {string} symbol
 * @returns {string|null}
 */
function extractBase(symbol) {
  try {
    return extractBaseCoin(symbol) || null;
  } catch {
    return null;
  }
}

/**
 * Build a compact `marketBreadthContext` from a `getTopCoins()` result.
 *
 * Strips the large `leaders[]` array — only the breadth summary is surfaced.
 *
 * @param {{ marketBreadth: object, vsCurrency: string }} marketsData
 * @returns {{
 *   regime: string,
 *   total: number,
 *   gainers: number,
 *   losers: number,
 *   neutral: number,
 *   gainersPercent: number,
 *   vsCurrency: string,
 *   source: string,
 * }}
 */
function buildMarketBreadthContext(marketsData) {
  const b = marketsData.marketBreadth;
  return {
    regime:         b.regime,
    total:          b.total,
    gainers:        b.gainers,
    losers:         b.losers,
    neutral:        b.neutral,
    gainersPercent: b.gainersPercent,
    vsCurrency:     marketsData.vsCurrency,
    source:         'coingecko',
  };
}

/**
 * Build a compact `trendingContext` from a `getTrending()` result and a raw symbol string.
 *
 * Matching strategy:
 *  1. Extract the base coin from the symbol (e.g. 'BINANCE:MMTUSDT.P' → 'MMT').
 *  2. Compare (case-insensitive) against the `trendingSymbols` array from getTrending().
 *  3. Rank = 1-based index in the trending list (CoinGecko scores them 0, 1, 2 ...).
 *
 * If the base coin cannot be extracted or no match is found, returns isTrending: false.
 *
 * @param {{ trendingSymbols: string[], trendingIds: string[], topTrending: object[] }} trendingData
 * @param {string} symbol  - Raw symbol string from the analysis (e.g. 'BINANCE:MMTUSDT.P')
 * @returns {{
 *   isTrending: boolean,
 *   trendingRank: number|null,
 *   matchedSymbol: string|null,
 *   matchedName: string|null,
 *   source: string,
 * }}
 */
function buildTrendingContext(trendingData, symbol) {
  const base = extractBase(symbol);

  if (!base) {
    return { isTrending: false, trendingRank: null, matchedSymbol: null, matchedName: null, source: 'coingecko' };
  }

  const upperBase = base.toUpperCase();

  // Primary match: trendingSymbols (already uppercased by normalizeTrendingCoin)
  const idx = trendingData.trendingSymbols.findIndex(
    (s) => s.toUpperCase() === upperBase
  );

  if (idx === -1) {
    return { isTrending: false, trendingRank: null, matchedSymbol: null, matchedName: null, source: 'coingecko' };
  }

  const match = trendingData.topTrending[idx];
  return {
    isTrending:    true,
    trendingRank:  idx + 1,                          // 1-based
    matchedSymbol: match?.symbol ?? upperBase,
    matchedName:   match?.name   ?? null,
    source:        'coingecko',
  };
}

/**
 * Fetch market breadth and trending context for a given symbol.
 *
 * Fetches both CoinGecko endpoints concurrently. Individual failures are
 * isolated — a breadth failure does not prevent a trending result and vice versa.
 *
 * Returns `{ marketBreadthContext: null, trendingContext: null }` silently
 * when COINGECKO_API_KEY is absent (public tier with no key is skipped to
 * avoid rate-limit noise in production environments that haven't opted in).
 *
 * @param {string} symbol           - Raw symbol string (e.g. 'BINANCE:MMTUSDT.P')
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{
 *   marketBreadthContext: object|null,
 *   trendingContext: object|null,
 * }>}
 */
async function fetchMarketContext(symbol, options = {}) {
  // No API key → skip silently. CoinGecko public tier has very aggressive rate
  // limits; we only run it when the user has explicitly configured a key.
  if (!process.env.COINGECKO_API_KEY) {
    return { marketBreadthContext: null, trendingContext: null };
  }

  const cgOptions = { timeoutMs: options.timeoutMs };

  const [marketsResult, trendingResult] = await Promise.allSettled([
    getTopCoins(cgOptions),
    getTrending(cgOptions),
  ]);

  const marketBreadthContext = marketsResult.status === 'fulfilled'
    ? buildMarketBreadthContext(marketsResult.value)
    : null;

  const trendingContext = trendingResult.status === 'fulfilled'
    ? buildTrendingContext(trendingResult.value, symbol)
    : null;

  return { marketBreadthContext, trendingContext };
}

// ── Confidence adjustment ──────────────────────────────────────────────────

/**
 * Coins treated as "majors" for the purpose of CoinGecko adjustments.
 * BTC and ETH are excluded: breadth is self-referential for BTC, and ETH is
 * treated conservatively because its size makes it partially drive the breadth
 * numbers rather than merely reflect them.
 */
const MAJOR_COINS = new Set(['BTC', 'ETH']);

/** Signals eligible for a CoinGecko confidence adjustment */
const ELIGIBLE_SIGNALS = new Set(['pullback_watch', 'breakout_watch']);

/**
 * Breadth regime → per-signal delta table (altcoins only).
 * 'mixed' is absent — no adjustment for genuinely ambiguous breadth.
 */
const BREADTH_DELTA = {
  risk_on:  { breakout_watch: +0.03, pullback_watch: +0.03 },
  risk_off: { breakout_watch: -0.05, pullback_watch: -0.03 },
};

/** Total CoinGecko adjustment bounds */
const CGKO_ADJ_MIN = -0.05;
const CGKO_ADJ_MAX = +0.08;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Compute a small optional confidence adjustment from CoinGecko market context.
 *
 * Rules:
 *  - Only applied to altcoins (BTC + ETH excluded).
 *  - Only applied to `pullback_watch` and `breakout_watch` signals.
 *  - `mixed` breadth regime → no adjustment.
 *  - Trending effect only when isTrending=true; stronger for rank ≤ 3.
 *  - Total delta is capped at [-0.05, +0.08].
 *
 * Reason string format follows the CoinGlass pattern:
 *   "label: +0.03"  (signed float at the end for parseReasonDelta compatibility)
 *
 * @param {object} params
 * @param {object|null} params.breadthContext   - from buildMarketBreadthContext()
 * @param {object|null} params.trendingCtx      - from buildTrendingContext()
 * @param {string}      params.signal           - current signal from classifySignal()
 * @param {string}      params.symbol           - raw symbol string (e.g. 'MMTUSDT.P')
 * @returns {{ adjustment: number, reasons: string[] }}
 */
function computeMarketContextAdjustment({ breadthContext, trendingCtx, signal, symbol }) {
  // Gate 1: only actionable bullish signals
  if (!ELIGIBLE_SIGNALS.has(signal)) {
    return { adjustment: 0, reasons: [] };
  }

  // Gate 2: only altcoins
  const base = extractBase(symbol);
  if (!base || MAJOR_COINS.has(base.toUpperCase())) {
    return { adjustment: 0, reasons: [] };
  }

  let delta   = 0;
  const reasons = [];

  // ── Breadth adjustment ─────────────────────────────────────────────────────
  if (breadthContext) {
    const regimeTable = BREADTH_DELTA[breadthContext.regime];
    if (regimeTable) {
      const adj = regimeTable[signal] || 0;
      if (adj !== 0) {
        delta += adj;
        const sign = adj > 0 ? '+' : '';
        reasons.push(`breadth_${breadthContext.regime}_${signal}: ${sign}${adj.toFixed(2)}`);
      }
    }
  }

  // ── Trending adjustment ────────────────────────────────────────────────────
  if (trendingCtx && trendingCtx.isTrending) {
    const rank    = trendingCtx.trendingRank;
    const topRank = rank !== null && rank <= 3;
    let trendAdj  = 0;

    if (signal === 'breakout_watch') {
      trendAdj = topRank ? 0.05 : 0.03;
    } else { // pullback_watch
      trendAdj = topRank ? 0.03 : 0.02;
    }

    delta += trendAdj;
    const rankLabel = topRank ? `_top3(rank=${rank})` : `(rank=${rank})`;
    reasons.push(`trending_${signal}${rankLabel}: +${trendAdj.toFixed(2)}`);
  }

  const capped = round2(Math.min(CGKO_ADJ_MAX, Math.max(CGKO_ADJ_MIN, delta)));
  return { adjustment: capped, reasons };
}

module.exports = {
  fetchMarketContext,
  buildMarketBreadthContext,
  buildTrendingContext,
  computeMarketContextAdjustment,
  extractBase,
};
