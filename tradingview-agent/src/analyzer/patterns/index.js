'use strict';

/**
 * Chart Pattern Detection — main entrypoint.
 *
 * detectChartPatterns(candles, options)
 *
 * Orchestrates all pattern detectors over the supplied candle series.
 * Returns a ranked array of detected patterns (strongest first).
 *
 * Design principles:
 *   - Deterministic: same candles always produce the same result
 *   - Conservative: under-detection preferred over false positives
 *   - No lookahead: only the current bar and history are used
 *   - Timeframe-aware: detectors use ATR-relative tolerances, not fixed prices
 *   - Non-blocking: a single detector throwing never kills the whole pipeline
 *
 * @param {Array<{time,open,high,low,close,volume}>} candles  Oldest-first OHLCV
 * @param {object} [options]
 * @param {number} [options.atr]         Current ATR value (recommended)
 * @param {number} [options.avgVolume]   20-bar average volume
 * @param {string} [options.timeframe]   Timeframe label (e.g. '1h')
 * @param {number} [options.lookback]    Pivot lookback override (default 5)
 * @param {number} [options.maxPatterns] Maximum patterns to return (default 5)
 * @returns {Array<object>}              Sorted by quality desc
 */

const { detectPivots } = require('../pivots');

const { detectHeadAndShoulders, detectInverseHeadAndShoulders } = require('./headShoulders');
const { detectDoubleTop, detectDoubleBottom }                   = require('./doubleTopBottom');
const { detectAscendingTriangle, detectDescendingTriangle, detectSymmetricalTriangle } = require('./triangles');
const { detectFlag, detectPennant }                            = require('./flags');
const { detectRisingWedge, detectFallingWedge }                = require('./wedges');
const { detectCupAndHandle }                                   = require('./cupHandle');
const { detectRectangle }                                      = require('./rectangles');

// Minimum candles required to attempt pattern detection
const MIN_CANDLES_REQUIRED = 40;
// Default maximum patterns to return
const DEFAULT_MAX_PATTERNS = 5;

/**
 * Run a single detector safely, swallowing any exceptions.
 * Returns the result or null.
 *
 * @param {Function} detectorFn
 * @param {Array} args
 * @returns {object|null}
 */
function safeDetect(detectorFn, args) {
  try {
    return detectorFn(...args);
  } catch (_) {
    return null;
  }
}

/**
 * Detect all supported chart patterns in the candle series.
 *
 * @param {Array} candles
 * @param {object} [options]
 * @returns {Array<object>}
 */
function detectChartPatterns(candles, options = {}) {
  if (!Array.isArray(candles) || candles.length < MIN_CANDLES_REQUIRED) {
    return [];
  }

  const atr        = options.atr        || estimateAtr(candles);
  const avgVol     = options.avgVolume  || 0;
  const timeframe  = options.timeframe  || null;
  const lookback   = options.lookback   || 5;
  const maxResults = options.maxPatterns || DEFAULT_MAX_PATTERNS;

  if (atr <= 0) return [];

  // Use a rolling window for pattern detection (most recent candles)
  // Long patterns (cup) may need more bars; shorter patterns use a tighter window
  const window200 = candles.slice(-200);
  const window150 = candles.slice(-150);

  // Detect pivots with standard lookback for most patterns
  const { pivotHighs, pivotLows } = detectPivots(window200, lookback);

  // Detect pivots with slightly larger lookback for large patterns (H&S, cup)
  const largeLookback = Math.max(lookback, 7);
  const { pivotHighs: largeHighs, pivotLows: largeLows } = detectPivots(window200, largeLookback);

  // Run all detectors
  const candidates = [
    // Large reversal patterns — use larger lookback pivots
    safeDetect(detectHeadAndShoulders,         [window200, largeHighs, atr, avgVol, timeframe]),
    safeDetect(detectInverseHeadAndShoulders,  [window200, largeLows,  atr, avgVol, timeframe]),
    safeDetect(detectDoubleTop,                [window150, pivotHighs, atr, avgVol, timeframe]),
    safeDetect(detectDoubleBottom,             [window150, pivotLows,  atr, avgVol, timeframe]),

    // Continuation / consolidation patterns
    safeDetect(detectAscendingTriangle,        [window150, pivotHighs, pivotLows, atr, avgVol, timeframe]),
    safeDetect(detectDescendingTriangle,       [window150, pivotHighs, pivotLows, atr, avgVol, timeframe]),
    safeDetect(detectSymmetricalTriangle,      [window150, pivotHighs, pivotLows, atr, avgVol, timeframe]),

    safeDetect(detectFlag,    ['bull', window150, atr, avgVol, timeframe]),
    safeDetect(detectFlag,    ['bear', window150, atr, avgVol, timeframe]),
    safeDetect(detectPennant, ['bull', window150, atr, avgVol, timeframe]),
    safeDetect(detectPennant, ['bear', window150, atr, avgVol, timeframe]),

    safeDetect(detectRisingWedge,  [window150, pivotHighs, pivotLows, atr, avgVol, timeframe]),
    safeDetect(detectFallingWedge, [window150, pivotHighs, pivotLows, atr, avgVol, timeframe]),

    // Cup and Handle — needs more history
    safeDetect(detectCupAndHandle, [window200, largeHighs, atr, avgVol, timeframe]),

    // Rectangle — needs enough bounces to build a range
    safeDetect(detectRectangle, [window150, pivotHighs, pivotLows, atr, avgVol, timeframe]),
  ];

  // Filter nulls and invalidated patterns; sort by quality descending
  const results = candidates
    .filter((p) => p !== null && p.status !== 'invalidated')
    .sort((a, b) => b.quality - a.quality)
    .slice(0, maxResults);

  return results;
}

/**
 * Fallback ATR estimation using average true range of recent candles.
 * Used when no pre-computed ATR is provided.
 *
 * @param {Array} candles
 * @returns {number}
 */
function estimateAtr(candles) {
  const slice = candles.slice(-14);
  if (slice.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const c    = slice[i];
    const prev = slice[i - 1];
    const tr   = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low  - prev.close),
    );
    sum += tr;
  }
  return sum / (slice.length - 1);
}

module.exports = { detectChartPatterns };
