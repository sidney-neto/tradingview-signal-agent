'use strict';

/**
 * computeAnalysisPipeline — shared deterministic analysis core.
 *
 * This is the single source of truth for pure candle-based analysis.
 * Both `analyzeMarket` (live runtime) and `analyzeCandles` (backtesting)
 * delegate to this function so that indicator math, classification rules,
 * scoring logic, and summary generation never diverge between the two paths.
 *
 * What belongs here (network-free, deterministic):
 *   - Indicator computation (EMA, SMA, RSI, ATR, volume)
 *   - Pivot detection
 *   - Trendline analysis
 *   - Zone detection
 *   - Chart pattern detection (best-effort)
 *   - Trend + momentum classification
 *   - Signal classification
 *   - Data quality assessment
 *   - Confidence adjustment (quality-only; live overlays applied by caller)
 *   - Summary string generation
 *
 * What does NOT belong here:
 *   - Symbol resolution    (live network I/O)
 *   - Candle fetching      (live network I/O)
 *   - External overlays    (CoinGlass, Bybit, CoinGecko — live network I/O)
 *   - Logging (callers log; pipeline is silent to keep it testable)
 *
 * @param {object} params
 * @param {Array}  params.candles    — OHLCV array, oldest-first
 *                                     Required fields: { time, open, high, low, close, volume }
 * @param {string} params.symbol     — Symbol label for summary generation (e.g. "BTCUSDT")
 * @param {string} params.timeframe  — Timeframe label for summary + pattern detection (e.g. "1h")
 * @param {object} [params.options]
 * @param {boolean} [params.options.skipPatterns] — skip chart pattern detection (default: false)
 *
 * @returns {object} Core analysis result. Callers may extend this with overlay adjustments.
 * @returns {number}   .price              — last close price
 * @returns {object}   .indicators         — { ema20, ema50, ema100, ema200, ma200, rsi14, avgVolume20, atr14 }
 * @returns {string}   .volumeState
 * @returns {string}   .volatilityState
 * @returns {object}   .trendlineState
 * @returns {object}   .zoneState
 * @returns {Array}    .chartPatterns      — detected patterns (empty when skipPatterns=true)
 * @returns {string}   .trend
 * @returns {string}   .momentum
 * @returns {string}   .signal
 * @returns {number}   .baseConfidence     — raw confidence before quality adjustment
 * @returns {number}   .confidence         — quality-adjusted confidence (before live overlays)
 * @returns {string|null} .invalidation
 * @returns {Array}    .targets
 * @returns {string}   .dataQuality        — 'good' | 'fair' | 'poor'
 * @returns {string[]} .warnings           — data quality + pattern warnings
 * @returns {string}   .summary            — PT-BR human-readable summary
 * @returns {number}   .candleCount
 */

const defaults = require('../config/defaults');

const { multiEma, multiSma, lastValue } = require('./indicators');
const { rsi: computeRsi }               = require('./rsi');
const { atr: computeAtr, classifyVolatility } = require('./atr');
const { avgVolume, classifyVolume }     = require('./volume');
const { detectPivots }                  = require('./pivots');
const { analyzeTrendlines }             = require('./trendlines');
const { detectZone }                    = require('./zones');
const { classifyTrend, classifyMomentum, classifySignal } = require('./rules');
const { assessDataQuality, adjustConfidence } = require('./scoring');
const { buildSummary }                  = require('./summary');
const { detectChartPatterns }           = require('./patterns');

/**
 * Run the shared deterministic analysis pipeline on pre-loaded candles.
 *
 * @param {object} params
 * @returns {object}
 */
function computeAnalysisPipeline({ candles, symbol, timeframe, options = {} }) {
  // ── 1. Extract series ──────────────────────────────────────────────────────

  const closes       = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];

  // ── 2. Indicators ──────────────────────────────────────────────────────────

  const emaMap       = multiEma(closes, defaults.EMA_PERIODS);
  const smaMap       = multiSma(closes, defaults.SMA_PERIODS);
  const rsiSeries    = computeRsi(closes, defaults.RSI_PERIOD);
  const atrSeries    = computeAtr(candles, defaults.ATR_PERIOD);
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

  // ── 3. Volume + volatility ─────────────────────────────────────────────────

  const volumeState     = classifyVolume(currentVolume, avgVol);
  const volatilityState = classifyVolatility(atr14, currentPrice);

  // ── 4. Structure (pivots → trendlines → zones) ────────────────────────────

  const { pivotHighs, pivotLows } = detectPivots(candles, defaults.PIVOT_LOOKBACK);

  const trendlineState = analyzeTrendlines({
    pivotHighs,
    pivotLows,
    candles,
    currentPrice,
    atrValue: atr14,
  });

  const zoneState = detectZone({
    candles,
    atrValue:  atr14,
    atrSeries,
    lookback:  defaults.ZONE_LOOKBACK,
  });

  // ── 5. Chart patterns (best-effort overlay) ────────────────────────────────
  //
  // A failure in any single detector is swallowed by safeDetect() inside
  // detectChartPatterns. The only case where we surface a warning here is if
  // the top-level orchestrator itself throws. Both outcomes are now explicit.

  let chartPatterns = [];
  let patternWarning = null;

  if (!options.skipPatterns) {
    try {
      chartPatterns = detectChartPatterns(candles, {
        atr:       atr14,
        avgVolume: avgVol,
        timeframe,
      });
    } catch (err) {
      // Pattern detection is best-effort — failure adds a warning but never
      // aborts the pipeline. Caller may also log this if appropriate.
      patternWarning = `pattern_detection_failed: ${err.message}`;
    }
  }

  // ── 6. Classification (trend → momentum → signal) ─────────────────────────

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

  const { signal, confidence: baseConfidence, invalidation, targets } = classifySignal({
    trend, momentum, volumeState, volatilityState,
    trendlineState, zoneState,
    indicators,
    currentPrice,
  });

  // ── 7. Data quality + confidence ───────────────────────────────────────────

  const { score: dataQuality, warnings } = assessDataQuality({
    indicators,
    trendlineState,
    zoneState,
    candleCount: candles.length,
  });

  // Surface pattern warning through the shared warnings array
  if (patternWarning) {
    warnings.push(patternWarning);
  }

  const confidence = adjustConfidence(baseConfidence, dataQuality);

  // ── 8. Summary (pure string generation) ───────────────────────────────────

  const summary = buildSummary({
    symbol,
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

  // ── 9. Return core result ─────────────────────────────────────────────────
  //
  // `baseConfidence` and `confidence` are both returned so callers can apply
  // additive overlay adjustments on top of the quality-adjusted value and
  // still reconstruct the full confidence breakdown chain.

  return {
    price:           currentPrice,
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
    confidence,              // quality-adjusted; overlays added by caller
    invalidation:    invalidation || null,
    targets:         targets    || [],
    dataQuality,
    warnings,                // mutable; caller may push additional warnings
    summary,
    candleCount:     candles.length,
  };
}

module.exports = { computeAnalysisPipeline };
