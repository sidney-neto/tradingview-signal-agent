'use strict';

/**
 * Forward outcome evaluation for backtesting.
 *
 * Given a signal type and a slice of future candles, determines whether
 * the signal produced a win, a loss, or expired without hitting either target.
 *
 * Assumptions (documented explicitly):
 *   - Entry is at the OPEN of the FIRST forward candle (next bar after signal).
 *   - A bullish signal (breakout_watch, pullback_watch) wins if price hits
 *     +winPct% from entry before hitting -lossPct% from entry.
 *   - A bearish signal (bearish_breakdown_watch) wins if price hits
 *     -winPct% from entry before hitting +lossPct% from entry.
 *   - no_trade signals are excluded from evaluation (returned as 'skipped').
 *   - If neither threshold is hit within lookahead bars, outcome is 'expired'.
 *   - High and low of each bar are used — not just close — so intrabar moves count.
 *
 * These are the simplest useful rules. Do not mistake them for a trading system.
 */

const BULLISH_SIGNALS = new Set(['breakout_watch', 'pullback_watch']);
const BEARISH_SIGNALS = new Set(['bearish_breakdown_watch']);

/**
 * Evaluate the forward outcome of a single signal.
 *
 * @param {object} params
 * @param {string} params.signal              — signal type from analyzeCandles
 * @param {Array}  params.forwardCandles      — slice of candles AFTER the signal bar (oldest-first)
 * @param {number} [params.winPct=1.5]        — % gain (bullish) or % drop (bearish) needed for a win
 * @param {number} [params.lossPct=0.75]      — % move against the signal direction that counts as a loss
 * @param {number} [params.entryPrice]        — explicit entry price; defaults to forwardCandles[0].open
 *
 * @returns {'win'|'loss'|'expired'|'skipped'}
 */
function evaluateOutcome({ signal, forwardCandles, winPct = 1.5, lossPct = 0.75, entryPrice }) {
  if (signal === 'no_trade') return 'skipped';

  if (!Array.isArray(forwardCandles) || forwardCandles.length === 0) return 'expired';

  const isBullish = BULLISH_SIGNALS.has(signal);
  const isBearish = BEARISH_SIGNALS.has(signal);

  if (!isBullish && !isBearish) return 'skipped';  // unknown signal type

  // entryPrice is explicit when runner uses 'close' entry mode;
  // defaults to next-bar open for backward compatibility.
  const entry = (entryPrice != null) ? entryPrice : forwardCandles[0].open;
  if (!entry || entry <= 0) return 'expired';

  const winThreshold  = entry * (1 + (isBullish ?  winPct  : -winPct)  / 100);
  const lossThreshold = entry * (1 + (isBullish ? -lossPct :  lossPct) / 100);

  for (const candle of forwardCandles) {
    if (isBullish) {
      if (candle.high  >= winThreshold)  return 'win';
      if (candle.low   <= lossThreshold) return 'loss';
    } else {
      if (candle.low   <= winThreshold)  return 'win';
      if (candle.high  >= lossThreshold) return 'loss';
    }
  }

  return 'expired';
}

/**
 * Compute max favorable excursion (MFE) and max adverse excursion (MAE)
 * for a given signal over the forward window.
 *
 * MFE: largest unrealized gain from entry
 * MAE: largest unrealized loss from entry
 *
 * @param {string} signal
 * @param {number} entryPrice
 * @param {Array}  forwardCandles
 * @returns {{ mfePct: number, maePct: number }}
 */
function computeExcursions(signal, entryPrice, forwardCandles) {
  if (!forwardCandles || !forwardCandles.length || !entryPrice) {
    return { mfePct: 0, maePct: 0 };
  }

  const isBullish = BULLISH_SIGNALS.has(signal);
  let mfePct = 0;
  let maePct = 0;

  for (const candle of forwardCandles) {
    const highPct = (candle.high - entryPrice) / entryPrice * 100;
    const lowPct  = (candle.low  - entryPrice) / entryPrice * 100;

    if (isBullish) {
      mfePct = Math.max(mfePct,  highPct);
      maePct = Math.min(maePct,  lowPct);
    } else {
      mfePct = Math.max(mfePct, -lowPct);   // favorable for bearish = price dropping
      maePct = Math.min(maePct, -highPct);  // adverse for bearish = price rising
    }
  }

  return {
    mfePct: Math.round(mfePct * 100) / 100,
    maePct: Math.round(maePct * 100) / 100,
  };
}

module.exports = { evaluateOutcome, computeExcursions, BULLISH_SIGNALS, BEARISH_SIGNALS };
