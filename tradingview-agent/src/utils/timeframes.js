'use strict';

/**
 * Map from user-facing timeframe labels to TradingView chart timeframe tokens.
 * TradingView tokens for minutes are numeric strings; daily/weekly use letter suffixes.
 */
const TIMEFRAME_MAP = {
  '1m':  '1',
  '3m':  '3',
  '5m':  '5',
  '15m': '15',
  '30m': '30',
  '1h':  '60',
  '2h':  '120',
  '4h':  '240',
  '6h':  '360',
  '12h': '720',
  '1d':  '1D',
  '1w':  '1W',
};

/** Set of supported user-facing timeframe labels */
const SUPPORTED_TIMEFRAMES = new Set(Object.keys(TIMEFRAME_MAP));

/**
 * Resolve a user-facing timeframe string to a TradingView chart token.
 * Accepts both canonical labels ('1h') and raw TV tokens ('60') for convenience.
 *
 * @param {string} timeframe
 * @returns {string} TradingView chart timeframe token
 * @throws {Error} if the timeframe is not supported
 */
function resolveTimeframe(timeframe) {
  if (!timeframe || typeof timeframe !== 'string') {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }

  const normalized = timeframe.trim().toLowerCase();

  // Direct match in our label map
  if (TIMEFRAME_MAP[normalized]) {
    return TIMEFRAME_MAP[normalized];
  }

  // Accept raw TV tokens directly (e.g. '60', '240', '1D', '1W')
  const rawTokens = new Set(Object.values(TIMEFRAME_MAP));
  if (rawTokens.has(timeframe.trim())) {
    return timeframe.trim();
  }

  throw new Error(
    `Unsupported timeframe: "${timeframe}". Supported values: ${[...SUPPORTED_TIMEFRAMES].join(', ')}`
  );
}

/**
 * Returns the set of supported user-facing timeframe labels.
 * @returns {string[]}
 */
function getSupportedTimeframes() {
  return [...SUPPORTED_TIMEFRAMES];
}

module.exports = { resolveTimeframe, getSupportedTimeframes, TIMEFRAME_MAP };
