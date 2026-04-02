'use strict';

/**
 * Backtesting runner — rolling-window signal replay.
 *
 * Iterates through a historical candle array step by step. At each eligible
 * position it runs analyzeCandles() using only candles available up to that
 * point (no lookahead), then evaluates the forward outcome over the next
 * `lookaheadBars` candles.
 *
 * This preserves strict temporal ordering — no future data is ever visible
 * to the analysis pipeline at any step.
 */

const defaults       = require('../config/defaults');
const { analyzeCandles } = require('./analyzeCandles');
const { evaluateOutcome, computeExcursions } = require('./evaluate');

/**
 * Run the backtesting loop over a candle array.
 *
 * @param {object} params
 * @param {Array}  params.candles         — full historical OHLCV array, oldest-first
 * @param {string} params.symbol          — symbol label (e.g. "BTCUSDT")
 * @param {string} params.symbolId        — symbol ID (e.g. "BINANCE:BTCUSDT")
 * @param {string} params.timeframe       — timeframe label (e.g. "1h")
 * @param {number} [params.minWindow]     — minimum candles before first analysis (default: MIN_CANDLES)
 * @param {number} [params.lookaheadBars] — forward bars for outcome evaluation (default: 10)
 * @param {number} [params.winPct]        — win threshold % (default: 1.5)
 * @param {number} [params.lossPct]       — loss threshold % (default: 0.75)
 * @param {number} [params.minConfidence] — skip signals below this confidence (default: 0.4)
 * @param {boolean} [params.skipPatterns] — skip chart pattern detection (default: true for speed)
 * @param {string} [params.entryMode]     — 'next-open' (default) or 'close' (signal-bar close)
 * @param {Function} [params.onStep]      — optional callback(stepResult) called after each step
 *
 * @returns {Array<object>} Array of step results (one per eligible analysis step)
 */
function runBacktest({
  candles,
  symbol,
  symbolId,
  timeframe,
  minWindow     = defaults.MIN_CANDLES,
  lookaheadBars = 10,
  winPct        = 1.5,
  lossPct       = 0.75,
  minConfidence = 0.4,
  skipPatterns  = true,
  entryMode     = 'next-open',   // 'next-open' | 'close'
  onStep        = null,
}) {
  if (!Array.isArray(candles) || candles.length < minWindow + lookaheadBars) {
    throw new Error(
      `runBacktest: need at least ${minWindow + lookaheadBars} candles ` +
      `(minWindow=${minWindow} + lookaheadBars=${lookaheadBars}), got ${candles ? candles.length : 0}`
    );
  }

  const steps = [];

  // The last valid signal position is `candles.length - 1 - lookaheadBars`
  // so that there are always `lookaheadBars` forward candles available.
  const lastSignalIdx = candles.length - 1 - lookaheadBars;

  for (let i = minWindow - 1; i <= lastSignalIdx; i++) {
    // Slice: candles[0..i] inclusive (no lookahead)
    const window = candles.slice(0, i + 1);

    let analysis;
    try {
      analysis = analyzeCandles({
        candles:    window,
        symbol,
        symbolId,
        timeframe,
        options:    { skipPatterns },
      });
    } catch (err) {
      // analyzeCandles can throw for very short windows or degenerate data
      // (e.g., all NaN indicators). Skip silently — don't abort the whole run.
      steps.push({
        index:      i,
        timestamp:  candles[i].time,
        skipped:    true,
        skipReason: err.message,
      });
      if (onStep) onStep(steps[steps.length - 1]);
      continue;
    }

    const { signal, confidence, trend, momentum, chartPatterns, tradeQualification } = analysis;
    const setupQuality = tradeQualification?.setupQuality || null;

    // Primary pattern: first confirmed or forming pattern (by confidence desc), or null.
    // Used for per-pattern breakdown in reports. When skipPatterns=true, chartPatterns is [].
    const primaryPattern = (Array.isArray(chartPatterns) && chartPatterns.length > 0)
      ? (chartPatterns.find((p) => p.status === 'confirmed') || chartPatterns[0]).type
      : null;

    // Forward candles for outcome evaluation
    const forwardCandles = candles.slice(i + 1, i + 1 + lookaheadBars);

    // Entry price depends on the configured entry mode:
    //   'next-open' — open of the bar immediately after the signal (default, realistic)
    //   'close'     — close of the signal bar (optimistic; useful for academic comparison)
    const entryPrice = entryMode === 'close'
      ? candles[i].close
      : (forwardCandles.length ? forwardCandles[0].open : null);

    // Evaluate outcome (always, even for no_trade — outcome will be 'skipped')
    const outcome = evaluateOutcome({ signal, forwardCandles, winPct, lossPct, entryPrice });

    // Excursions only for actionable signals that meet confidence threshold
    const isEligible = signal !== 'no_trade' && confidence >= minConfidence;
    const excursions = isEligible && entryPrice
      ? computeExcursions(signal, entryPrice, forwardCandles)
      : { mfePct: null, maePct: null };

    const step = {
      index:          i,
      timestamp:      candles[i].time,
      signal,
      confidence,
      trend,
      momentum,
      setupQuality,   // from tradeQualification: high|medium|low|rejected|null
      primaryPattern, // null when skipPatterns=true or no patterns detected
      entryPrice,
      outcome,
      isEligible,
      mfePct:         excursions.mfePct,
      maePct:         excursions.maePct,
    };

    steps.push(step);
    if (onStep) onStep(step);
  }

  return steps;
}

module.exports = { runBacktest };
