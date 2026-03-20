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

const { resolveSymbol }   = require('../adapters/tradingview/symbolSearch');
const { fetchCandles }    = require('../adapters/tradingview/candles');
const { resolveTimeframe } = require('../utils/timeframes');
const { validateAnalyzeParams } = require('../utils/validation');
const defaults = require('../config/defaults');

const { multiEma, multiSma, lastValue } = require('../analyzer/indicators');
const { rsi: computeRsi }               = require('../analyzer/rsi');
const { atr: computeAtr, classifyVolatility } = require('../analyzer/atr');
const { avgVolume, classifyVolume }     = require('../analyzer/volume');
const { detectPivots }                  = require('../analyzer/pivots');
const { analyzeTrendlines }             = require('../analyzer/trendlines');
const { detectZone }                    = require('../analyzer/zones');
const { classifyTrend, classifyMomentum, classifySignal, computePullbackContext } = require('../analyzer/rules');
const { assessDataQuality, adjustConfidence } = require('../analyzer/scoring');
const { buildSummary }                  = require('../analyzer/summary');
const { fetchPerpContext }              = require('../analyzer/perpContext');
const { fetchBybitContext, computeBybitContextAdjustment } = require('../analyzer/bybitContext');
const { fetchMarketContext, computeMarketContextAdjustment } = require('../analyzer/marketContext');
const { detectChartPatterns } = require('../analyzer/patterns');

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

  // --- 2. Resolve symbol ---
  const symbol = await resolveSymbol(query, {
    filter: options.symbolFilter || '',
  });

  // --- 3. Fetch candles ---
  const candles = await fetchCandles(symbol.id, tvTimeframe, {
    candleCount: options.candleCount || defaults.CANDLE_COUNT,
    timeoutMs:   options.timeoutMs   || defaults.CANDLE_FETCH_TIMEOUT_MS,
    minCandles:  defaults.MIN_CANDLES,
    token:       options.token,
    signature:   options.signature,
  });

  // --- 4. Extract close/high/low/vol series ---
  const closes  = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];

  // --- 5. Compute indicators ---
  const emaMap  = multiEma(closes, defaults.EMA_PERIODS);
  const smaMap  = multiSma(closes, defaults.SMA_PERIODS);
  const rsiSeries  = computeRsi(closes, defaults.RSI_PERIOD);
  const atrSeries  = computeAtr(candles, defaults.ATR_PERIOD);
  const avgVolSeries = avgVolume(candles, defaults.AVG_VOLUME_PERIOD);

  const ema20  = lastValue(emaMap[20]);
  const ema50  = lastValue(emaMap[50]);
  const ema100 = lastValue(emaMap[100]);
  const ema200 = lastValue(emaMap[200]);
  const ma200  = lastValue(smaMap[200]);
  const rsi14  = lastValue(rsiSeries);
  const atr14  = lastValue(atrSeries);
  const avgVol = lastValue(avgVolSeries);
  const currentVolume = candles[candles.length - 1].volume;

  const indicators = { ema20, ema50, ema100, ema200, ma200, rsi14, avgVolume20: avgVol, atr14 };

  // --- 6. Volume + volatility classification ---
  const volumeState     = classifyVolume(currentVolume, avgVol);
  const volatilityState = classifyVolatility(atr14, currentPrice);

  // --- 7. Pivot detection ---
  const { pivotHighs, pivotLows } = detectPivots(candles, defaults.PIVOT_LOOKBACK);

  // --- 8. Trendline analysis ---
  const trendlineState = analyzeTrendlines({
    pivotHighs,
    pivotLows,
    candles,
    currentPrice,
    atrValue: atr14,
  });

  // --- 9. Zone detection ---
  const zoneState = detectZone({
    candles,
    atrValue:  atr14,
    atrSeries,
    lookback:  defaults.ZONE_LOOKBACK,
  });

  // --- 9b. Chart pattern detection (optional overlay, never throws) ---
  let chartPatterns = [];
  if (!options.skipPatterns) {
    try {
      chartPatterns = detectChartPatterns(candles, {
        atr:        atr14,
        avgVolume:  avgVol,
        timeframe,
      });
    } catch (_) {
      // Pattern detection is best-effort — never surface errors to callers
    }
  }

  // --- 10. Trend + momentum classification ---
  const trend = classifyTrend({
    price: currentPrice,
    ema20, ema50, ema100, ema200, ma200,
    trendlineState,
  });

  const momentum = classifyMomentum({
    rsi14,
    volumeState,
    trendlineBreak: trendlineState.lineBreakDirection,
    zoneType:       zoneState.zoneType,
  });

  // --- 11. Signal classification ---
  const { signal, confidence: baseConfidence, invalidation, targets } = classifySignal({
    trend, momentum, volumeState, volatilityState,
    trendlineState, zoneState,
    indicators,      // needed by isValidBullishPullback for EMA/ATR proximity checks
    currentPrice,    // needed by isValidBullishPullback for price-vs-EMA comparisons
  });

  // --- 12. Data quality + confidence adjustment ---
  const { score: dataQuality, warnings } = assessDataQuality({
    indicators,
    trendlineState,
    zoneState,
    candleCount: candles.length,
  });

  let confidence = adjustConfidence(baseConfidence, dataQuality);
  const qualityAdjustedConfidence = confidence; // save for breakdown before CG delta

  // --- 12b. Optional CoinGlass perp context (additive overlay) ---
  //
  // Only attempted when COINGLASS_API_KEY is present in the environment.
  // If the key is absent or any request fails, the engine degrades to the
  // quality-adjusted confidence above — no exception is ever surfaced to callers.
  //
  // Confidence is only adjusted for actionable bullish signals (pullback_watch,
  // breakout_watch). For no_trade and bearish_breakdown_watch, perpContext and
  // macroContext are populated for information but confidence is left unchanged.
  //
  // Output fields:
  //   perpContext   — funding + OI context, partial adjustment, reasons
  //   macroContext  — fearGreed + BTC dominance + altcoin season, partial adjustment, reasons
  //   confidenceBreakdown — full chain: base → afterQuality → cgAdjustment → final
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

  // Shared helpers for confidence adjustment arithmetic (used by both CoinGlass and CoinGecko blocks)
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
      // Never surface CoinGlass errors to the caller — this is a best-effort overlay.
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
  // Failures are fully absorbed; the engine degrades silently to the current confidence.
  //
  // Confidence is only adjusted for actionable bullish signals (pullback_watch, breakout_watch).
  // For no_trade and bearish_breakdown_watch, bybitContext is populated for information only.
  //
  // Output fields:
  //   bybitContext  — funding bias, OI regime, crowd context, mark price
  //   confidenceBreakdown.bybitAdjustment — delta applied to confidence
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
      // Never surface Bybit errors to the caller — this is a best-effort overlay.
      warnings.push(`Bybit context skipped: ${err.message}`);
    }
  }

  // --- 12c. Optional CoinGecko market breadth + trending context (additive overlay) ---
  //
  // Only attempted when COINGECKO_API_KEY is present in the environment.
  // Failures are fully absorbed — neither field ever breaks the main pipeline.
  //
  // Confidence is only adjusted for altcoin pullback_watch and breakout_watch signals.
  // BTC and ETH are excluded (breadth is self-referential for majors).
  // For no_trade and bearish_breakdown_watch, context fields are populated for
  // information only — confidence is left unchanged.
  //
  // Output fields:
  //   marketBreadthContext — broad market regime snapshot
  //   trendingContext      — whether the asset is currently trending on CoinGecko
  //   confidenceBreakdown  — cgkoAdjustment + cgkoReasons fields added
  const afterCoinGlassConfidence = confidence; // save before CoinGecko delta

  if (!options.skipCoinGecko) {
    try {
      const cgkoData = await fetchMarketContext(symbol.symbol, {
        timeoutMs: options.cgkoTimeoutMs,
      });
      marketBreadthContext = cgkoData.marketBreadthContext;
      trendingContext      = cgkoData.trendingContext;

      // Apply adjustment only when at least one context field is available
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
    } catch (err) {
      // Never surface CoinGecko errors to the caller.
      warnings.push(`CoinGecko context skipped: ${err.message}`);
    }
  }

  // Confidence breakdown — always present, regardless of overlay availability.
  // Chain: base → afterQuality → cgAdjustment (CoinGlass) → bybitAdjustment (Bybit fallback) → cgkoAdjustment (CoinGecko) → final
  // afterCGConfidence = confidence after CoinGlass block (before Bybit) — isolates cgAdjustment correctly.
  // afterCoinGlassConfidence = confidence after Bybit block (before CoinGecko) — isolates cgkoAdjustment correctly.
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
  };

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

  // --- 14. Return structured result ---
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
    candleCount:     candles.length,
    timestamp:       new Date().toISOString(),
  };
}

module.exports = { analyzeMarket };
