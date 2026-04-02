'use strict';

/**
 * analyzeMarket — the primary tool function for conversational market analysis.
 *
 * Designed to be called by an OpenClaw agent or any other AI orchestration layer.
 * Accepts a natural-language-friendly symbol query and a timeframe label, then returns
 * a fully structured, deterministic analysis result.
 *
 * Usage:
 *   const { analyzeMarket } = require('./analyzeMarket');
 *   const result = await analyzeMarket({ query: 'BTC', timeframe: '15m' });
 *
 * Input:
 *   { query: string, timeframe: string, options?: object }
 *
 * Output:
 *   { symbol, symbolId, timeframe, price, trend, momentum, volumeState,
 *     volatilityState, signal, confidence, invalidation, targets, summary,
 *     indicators, trendlineState, zoneState,
 *     perpContext, macroContext, confidenceBreakdown,
 *     dataQuality, warnings }
 */

const { resolveTimeframe } = require('../utils/timeframes');
const { validateAnalyzeParams } = require('../utils/validation');
const defaults = require('../config/defaults');
const logger   = require('../logger');

const { computePullbackContext }         = require('../analyzer/rules');
const { buildSummary }                   = require('../analyzer/summary');
const { computeBybitContextAdjustment }  = require('../analyzer/bybitContext');
const { computeMarketContextAdjustment } = require('../analyzer/marketContext');
const { computeAnalysisPipeline }        = require('../analyzer/pipeline');
const { computeTradeQualification }      = require('../analyzer/tradeQualification');
const { computeMarketRegime }            = require('../analyzer/marketRegime');

// TTL-cached wrappers for network I/O — fall through to originals when cache is disabled.
// Set CACHE_ENABLED=true to activate; see src/cache/ for TTL env vars.
const { resolveSymbolCached: resolveSymbol }             = require('../cache/symbolCache');
const { fetchCandlesCached: fetchCandles }               = require('../cache/candleCache');
const { fetchPerpContextCached: fetchPerpContext }       = require('../cache/overlayCache');
const { fetchBybitContextCached: fetchBybitContext }     = require('../cache/overlayCache');
const { fetchMarketContextCached: fetchMarketContext }   = require('../cache/overlayCache');

function candleTimeToIso(time) {
  if (typeof time !== 'number') return null;
  const ms = time < 1e12 ? time * 1000 : time;
  return new Date(ms).toISOString();
}

/**
 * @typedef {object} AnalyzeOptions
 * @property {number} [candleCount]      - How many candles to fetch (default: 300)
 * @property {number} [timeoutMs]        - WebSocket fetch timeout (default: 20000)
 * @property {string} [token]            - TradingView session token (optional)
 * @property {string} [signature]        - TradingView session signature (optional)
 * @property {string} [symbolFilter]     - Market filter for symbol search (e.g. 'crypto')
 */

/**
 * Analyze a market symbol and return a structured analysis object.
 *
 * @param {object} params
 * @param {string} params.query          - Symbol name or search query (e.g. "BTC", "AAPL", "BINANCE:BTCUSDT")
 * @param {string} params.timeframe      - Timeframe label (e.g. "15m", "1h", "4h", "1d")
 * @param {AnalyzeOptions} [params.options]
 * @returns {Promise<object>} Structured analysis result
 */
async function analyzeMarket({ query, timeframe, options = {} }) {
  // --- 1. Validate inputs ---
  validateAnalyzeParams({ query, timeframe });

  const tvTimeframe = resolveTimeframe(timeframe);

  logger.info('analysis.start', { query, timeframe });

  // --- 2. Resolve symbol ---
  const symbol = await resolveSymbol(query, {
    filter: options.symbolFilter || '',
  });

  // --- 3. Fetch candles ---
  let candles;
  try {
    candles = await fetchCandles(symbol.id, tvTimeframe, {
      candleCount: options.candleCount || defaults.CANDLE_COUNT,
      timeoutMs:   options.timeoutMs   || defaults.CANDLE_FETCH_TIMEOUT_MS,
      minCandles:  defaults.MIN_CANDLES,
      token:       options.token,
      signature:   options.signature,
    });
  } catch (err) {
    logger.error('candle.fetch.failed', { symbolId: symbol.id, timeframe, error: err.message, code: err.code || null });
    throw err;
  }

  // --- 4–12. Core candle-based analysis (shared deterministic pipeline) ---
  const core = computeAnalysisPipeline({
    candles,
    symbol:  symbol.symbol,
    timeframe,
    options: { skipPatterns: options.skipPatterns },
  });

  // Log pattern detection failures surfaced by the pipeline (it is silent by design).
  const patternWarn = core.warnings.find((w) => w.startsWith('pattern_detection_failed'));
  if (patternWarn) logger.warn('pattern.detection.failed', { error: patternWarn });

  const {
    price: currentPrice,
    indicators,
    volumeState,
    volatilityState,
    trendlineState,
    zoneState,
    chartPatterns,
    trend,
    momentum,
    signal,
    baseConfidence,
    dataQuality,
    invalidation,
    targets,
  } = core;

  const warnings = core.warnings;           // mutable; overlays will push to this
  let confidence = core.confidence;         // quality-adjusted; overlays modify this
  const qualityAdjustedConfidence = confidence;

  // --- 12b. Optional CoinGlass perp context (additive overlay) ---
  //
  // Only attempted when COINGLASS_API_KEY is present in the environment.
  // If the key is absent or any request fails, the engine degrades to the
  // quality-adjusted confidence above — the failure surfaces in warnings[] and logs.
  //
  // PARALLELIZATION: CoinGecko fetch is started here concurrently with the
  // CoinGlass+Bybit chain. CoinGecko is independent of both and does not need
  // to wait for perp context to be resolved.
  //
  // Confidence is only adjusted for actionable bullish signals (pullback_watch,
  // breakout_watch). For no_trade and bearish_breakdown_watch, perpContext and
  // macroContext are populated for information but confidence is left unchanged.

  // Start CoinGecko in the background immediately — it is independent of CoinGlass/Bybit.
  // We will await this promise after the CoinGlass+Bybit chain completes.
  const cgkoFetchPromise = (!options.skipCoinGecko)
    ? fetchMarketContext(symbol.symbol, { timeoutMs: options.cgkoTimeoutMs })
    : Promise.resolve(null);

  let perpContext    = null;
  let macroContext   = null;
  let cgProviderStatus = null;

  // Bybit context (populated in step 12b.5)
  let bybitContext            = null;
  let bybitAdjustmentApplied = 0;
  let bybitReasons           = [];

  // CoinGecko context (populated in step 12c)
  let marketBreadthContext  = null;
  let trendingContext       = null;
  let cgkoAdjustmentApplied = 0;
  let cgkoReasons           = [];

  // Shared helpers for confidence adjustment arithmetic
  const round2 = (n) => Math.round(n * 100) / 100;

  // Parse the signed delta embedded at the end of each reason string.
  // Reason format: "source_label(...): +0.05" or "source_label: -0.03"
  const parseReasonDelta = (r) => {
    const m = r.match(/([+-]\d+\.\d+)\s*$/);
    return m ? parseFloat(m[1]) : 0;
  };

  if (!options.skipCoinGlass) {
    try {
      const cgData = await fetchPerpContext(symbol.symbol, {
        exchange:  options.cgExchange,
        timeoutMs: options.cgTimeoutMs,
      });

      cgProviderStatus = cgData.providerStatus || null;

      if (cgData.available) {
        const ctxResult = computePullbackContext({
          fundingRate:    cgData.fundingRate,
          oiTrend:        cgData.oiTrend,
          fearGreedIndex: cgData.fearGreedIndex,
          btcDominance:   cgData.btcDominance,
          altcoinIndex:   cgData.altcoinIndex,
          isAltcoin:      cgData.isAltcoin,
          signal,
        });

        // Split reasons by domain: perp = funding/OI, macro = fear-greed/dominance/altcoin
        const perpReasons  = ctxResult.reasons.filter((r) => /^(funding|oi)_/.test(r));
        const macroReasons = ctxResult.reasons.filter((r) => /^(fear_greed|btc_dominance|altcoin_season)_/.test(r));

        // Partial adjustment totals per domain (rounded to 2dp)
        const perpAdj  = round2(perpReasons.reduce((s, r)  => s + parseReasonDelta(r), 0));
        const macroAdj = round2(macroReasons.reduce((s, r) => s + parseReasonDelta(r), 0));

        // Apply the combined delta only for actionable bullish setups
        const isBullishSetup = signal === 'pullback_watch' || signal === 'breakout_watch';
        if (isBullishSetup && ctxResult.confidenceAdjustment !== 0) {
          confidence = round2(Math.min(1, Math.max(0, confidence + ctxResult.confidenceAdjustment)));
        }

        const cgFetchWarnings = cgData.warnings.filter((w) => w.startsWith('coinglass_'));

        perpContext = {
          fundingBias:       cgData.fundingBias,
          fundingRegime:     cgData.fundingRegime,
          oiTrend:           cgData.oiTrend,
          oiExpansion:       cgData.oiExpansion,
          contextAdjustment: isBullishSetup ? perpAdj  : 0,
          reasons:           perpReasons,
          warnings:          cgFetchWarnings,
          source:            'coinglass',
        };

        macroContext = {
          fearGreed:         cgData.fearGreedIndex != null
            ? { value: cgData.fearGreedIndex, label: cgData.fearGreedLabel }
            : null,
          bitcoinDominance:  cgData.btcDominance,
          altcoinSeason:     cgData.altcoinIndex,
          contextAdjustment: isBullishSetup ? macroAdj : 0,
          reasons:           macroReasons,
          source:            'coinglass',
        };
      }
    } catch (err) {
      // Failure is surfaced as a warning + log; pipeline continues with degraded confidence.
      logger.warn('overlay.fetch.failed', { source: 'coinglass', error: err.message });
      warnings.push(`CoinGlass context skipped: ${err.message}`);
    }
  }

  // --- 12b.5. Optional Bybit perp context (additive overlay — fallback for CoinGlass) ---
  //
  // Only activated when CoinGlass did NOT provide perp context (perpContext === null),
  // meaning COINGLASS_API_KEY is absent or the plan is restricted.
  // This prevents double-counting funding/OI signals from two sources simultaneously.
  //
  // Uses public Bybit V5 endpoints — no API key required.
  // Failures are surfaced in warnings[] and logs; pipeline continues.
  const afterCGConfidence = confidence; // save before Bybit delta

  if (!options.skipBybit && perpContext === null) {
    try {
      const bybitData = await fetchBybitContext(symbol.symbol, {
        category:  options.bybitCategory,
        timeoutMs: options.bybitTimeoutMs,
      });

      if (bybitData.available) {
        const bybitResult = computeBybitContextAdjustment({
          fundingBias: bybitData.fundingBias,
          oiRegime:    bybitData.oiRegime,
          signal,
        });

        const isBullishSetup = signal === 'pullback_watch' || signal === 'breakout_watch';
        if (isBullishSetup && bybitResult.adjustment !== 0) {
          confidence = round2(Math.min(1, Math.max(0, confidence + bybitResult.adjustment)));
        }

        bybitAdjustmentApplied = round2(confidence - afterCGConfidence);
        bybitReasons           = bybitResult.reasons;

        bybitContext = {
          liveFundingRate:   bybitData.liveFundingRate,
          averageFunding:    bybitData.averageFunding,
          fundingBias:       bybitData.fundingBias,
          fundingRegime:     bybitData.fundingRegime,
          oiTrend:           bybitData.oiTrend,
          oiExpansion:       bybitData.oiExpansion,
          oiRegime:          bybitData.oiRegime,
          crowdBias:         bybitData.crowdBias,
          crowdingRisk:      bybitData.crowdingRisk,
          markPrice:         bybitData.markPrice,
          openInterest:      bybitData.openInterest,
          openInterestValue: bybitData.openInterestValue,
          contextAdjustment: isBullishSetup ? bybitAdjustmentApplied : 0,
          reasons:           bybitReasons,
          warnings:          bybitData.warnings,
          source:            'bybit',
        };
      }
    } catch (err) {
      // Failure is surfaced as a warning + log; pipeline continues.
      logger.warn('overlay.fetch.failed', { source: 'bybit', error: err.message });
      warnings.push(`Bybit context skipped: ${err.message}`);
    }
  }

  // --- 12c. Optional CoinGecko market breadth + trending context (additive overlay) ---
  //
  // cgkoFetchPromise was started before the CoinGlass/Bybit chain so that CoinGecko
  // runs concurrently. We await it here — it is likely already settled by this point.
  //
  // Confidence is only adjusted for altcoin pullback_watch and breakout_watch signals.
  // Failures are surfaced in warnings[] and logs.
  const afterCoinGlassConfidence = confidence; // save before CoinGecko delta

  if (!options.skipCoinGecko) {
    try {
      const cgkoData = await cgkoFetchPromise;
      if (cgkoData !== null) {
        marketBreadthContext = cgkoData.marketBreadthContext;
        trendingContext      = cgkoData.trendingContext;

        if (marketBreadthContext !== null || trendingContext !== null) {
          const cgkoResult = computeMarketContextAdjustment({
            breadthContext: marketBreadthContext,
            trendingCtx:    trendingContext,
            signal,
            symbol:         symbol.symbol,
          });

          if (cgkoResult.adjustment !== 0) {
            confidence = round2(Math.min(1, Math.max(0, confidence + cgkoResult.adjustment)));
          }

          cgkoAdjustmentApplied = round2(confidence - afterCoinGlassConfidence);
          cgkoReasons           = cgkoResult.reasons;
        }
      }
    } catch (err) {
      // Failure is surfaced as a warning + log; pipeline continues.
      logger.warn('overlay.fetch.failed', { source: 'coingecko', error: err.message });
      warnings.push(`CoinGecko context skipped: ${err.message}`);
    }
  }

  // --- 12d. Market regime (pure — consolidated context layer) ---
  //
  // Combines all available context signals into a single regime classification.
  // Used by tradeQualification to adjust setup quality.
  // Does not alter confidence directly — that is handled by the CoinGlass/Bybit/CoinGecko
  // overlay chain above.
  const marketRegime = computeMarketRegime({
    macroContext,
    marketBreadthContext,
  });

  // Confidence breakdown — always present, regardless of overlay availability.
  // Chain: base → afterQuality → cgAdjustment (CoinGlass) → bybitAdjustment (Bybit fallback) → cgkoAdjustment (CoinGecko) → final
  const cgAdjustmentApplied = round2(afterCGConfidence - qualityAdjustedConfidence);
  const confidenceBreakdown = {
    base:             baseConfidence,
    afterQuality:     qualityAdjustedConfidence,
    cgAdjustment:     cgAdjustmentApplied,
    bybitAdjustment:  bybitAdjustmentApplied,
    cgkoAdjustment:   cgkoAdjustmentApplied,
    final:            confidence,
    cgAvailable:      perpContext !== null || macroContext !== null,
    cgReason:         cgProviderStatus,
    bybitAvailable:   bybitContext !== null,
    bybitReasons:     bybitReasons,
    cgkoAvailable:    marketBreadthContext !== null || trendingContext !== null,
    cgkoReasons:      cgkoReasons,
    regimeAvailable:  marketRegime.available,
    regime:           marketRegime.regime,
  };

  // --- 12e. Trade qualification layer (pure — no network I/O) ---
  //
  // Produces structured, numerical trade plan metadata from the pipeline output
  // and all available context.
  // mtfQualification is null here — only available at the MTF wrapper level.
  const tradeQualification = computeTradeQualification({
    signal,
    confidence,
    trend,
    momentum,
    indicators,
    currentPrice,
    trendlineState,
    zoneState,
    volumeState,
    volatilityState,
    mtfQualification: null,  // filled in by analyzeMarketMTF
    marketRegime,
  });

  // --- 13. Summary ---
  const summary = buildSummary({
    symbol:          symbol.symbol,
    timeframe,
    price:           currentPrice,
    trend,
    momentum,
    signal,
    confidence,
    volumeState,
    volatilityState,
    indicators,
    trendlineState,
    zoneState,
    targets,
    invalidation,
  });

  logger.info('analysis.complete', {
    query,
    timeframe,
    symbol: symbol.symbol,
    signal,
    confidence,
    dataQuality,
    warningCount: warnings.length,
  });

  // --- 14. Return structured result ---
  const lastCandle = candles[candles.length - 1] || null;

  return {
    symbol:          symbol.symbol,
    symbolId:        symbol.id,
    exchange:        symbol.exchange,
    description:     symbol.description,
    timeframe,
    price:           currentPrice,
    trend,
    momentum,
    volumeState,
    volatilityState,
    signal,
    confidence,
    invalidation:    invalidation || null,
    targets:         targets || [],
    summary,
    indicators,
    trendlineState,
    zoneState,
    perpContext,
    macroContext,
    bybitContext,
    marketBreadthContext,
    trendingContext,
    confidenceBreakdown,
    dataQuality,
    warnings,
    chartPatterns,
    marketRegime,
    tradeQualification,
    candleCount:     candles.length,
    lastCandleTime:  lastCandle ? candleTimeToIso(lastCandle.time) : null,
    timestamp:       new Date().toISOString(),
  };
}

module.exports = { analyzeMarket };
