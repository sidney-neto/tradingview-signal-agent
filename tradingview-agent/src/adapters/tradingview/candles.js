'use strict';

const { Client } = require('@mathieuc/tradingview');
const { normalizePeriods } = require('./normalize');
const {
  MarketDataUnavailableError,
  CandleFetchTimeoutError,
  InsufficientCandlesError,
  SessionError,
} = require('./errors');
const defaults = require('../../config/defaults');

/**
 * Fetch OHLCV candles for a symbol + timeframe using a one-shot WebSocket session.
 *
 * Opens a Client, creates a ChartSession, waits for candle data, then closes everything.
 * Does NOT maintain long-lived sessions.
 *
 * @param {string} symbolId - Exchange-qualified symbol (e.g. "BINANCE:BTCUSDT")
 * @param {string} tvTimeframe - TradingView chart timeframe token (e.g. "60", "1D")
 * @param {object} [options]
 * @param {number} [options.candleCount]    - Number of candles to request
 * @param {number} [options.timeoutMs]      - Fetch timeout in milliseconds
 * @param {number} [options.minCandles]     - Minimum acceptable candle count
 * @param {string} [options.token]          - TradingView session token (optional)
 * @param {string} [options.signature]      - TradingView session signature (optional)
 * @returns {Promise<Array>} Normalized candle array sorted oldest-first
 */
async function fetchCandles(symbolId, tvTimeframe, options = {}) {
  const {
    candleCount = defaults.CANDLE_COUNT,
    timeoutMs   = defaults.CANDLE_FETCH_TIMEOUT_MS,
    minCandles  = defaults.MIN_CANDLES,
    token,
    signature,
  } = options;

  return new Promise((resolve, reject) => {
    let client;
    let settled = false;
    let timer;

    function finish(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // Best-effort cleanup
      try { client && client.end(); } catch (_) {}

      if (err) reject(err);
      else resolve(result);
    }

    // Timeout guard
    timer = setTimeout(() => {
      finish(new CandleFetchTimeoutError(symbolId, tvTimeframe, timeoutMs));
    }, timeoutMs);

    try {
      const clientOptions = {};
      if (token)     clientOptions.token     = token;
      if (signature) clientOptions.signature = signature;

      client = new Client(clientOptions);

      client.onError((...args) => {
        finish(new SessionError(`Client error: ${args.join(' ')}`));
      });

      client.onConnected(() => {
        let chart;

        try {
          chart = new client.Session.Chart();
        } catch (err) {
          finish(new SessionError('Failed to create ChartSession', err));
          return;
        }

        chart.onError((...args) => {
          finish(new MarketDataUnavailableError(symbolId, new Error(args.join(' '))));
        });

        // onSymbolLoaded fires after the symbol resolves; periods are populated on onUpdate
        chart.onUpdate(() => {
          // Wait until we have enough candles (TradingView may fire multiple updates)
          const periods = chart.periods;
          if (!periods || periods.length < minCandles) return;

          const candles = normalizePeriods(periods);
          if (candles.length < minCandles) return;

          finish(null, candles);
        });

        try {
          chart.setMarket(symbolId, {
            timeframe: tvTimeframe,
            range:     candleCount,
          });
        } catch (err) {
          finish(new MarketDataUnavailableError(symbolId, err));
        }
      });

    } catch (err) {
      finish(new SessionError('Failed to create TradingView client', err));
    }
  }).then((candles) => {
    if (candles.length < minCandles) {
      throw new InsufficientCandlesError(symbolId, minCandles, candles.length);
    }
    return candles;
  });
}

module.exports = { fetchCandles };
