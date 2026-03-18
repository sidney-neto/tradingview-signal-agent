'use strict';

module.exports = {
  /** Default number of candles to request per fetch */
  CANDLE_COUNT: 300,

  /** Minimum candles required before returning a result */
  MIN_CANDLES: 50,

  /** WebSocket fetch timeout in milliseconds */
  CANDLE_FETCH_TIMEOUT_MS: 20_000,

  /** Pivot detection lookback (bars on each side of pivot point) */
  PIVOT_LOOKBACK: 5,

  /** ATR period */
  ATR_PERIOD: 14,

  /** RSI period */
  RSI_PERIOD: 14,

  /** Average volume period */
  AVG_VOLUME_PERIOD: 20,

  /** EMA periods to compute */
  EMA_PERIODS: [20, 50, 100, 200],

  /** SMA periods to compute */
  SMA_PERIODS: [200],

  /** Minimum pivot points needed to construct a trendline */
  MIN_PIVOTS_FOR_TRENDLINE: 2,

  /** Consolidation range threshold as fraction of ATR (price compressing within N * ATR) */
  CONSOLIDATION_ATR_MULTIPLIER: 1.5,

  /** Lookback window (candles) for zone detection */
  ZONE_LOOKBACK: 40,

  /** Fraction of ATR within which price must close to be considered a "near trendline" touch */
  TRENDLINE_TOUCH_ATR_FRACTION: 0.5,

  /**
   * Minimum retracement from the most recent confirmed pivot high, expressed in ATR units,
   * required to qualify as a pullback. 0.5 ATR means price has fallen at least half an
   * average-range candle from the local high.
   */
  PULLBACK_RETRACEMENT_ATR_MIN: 0.5,

  /**
   * Distance from an EMA level (in ATR units) within which price is considered to be
   * "near" that EMA for the purpose of support-interaction scoring in pullback detection.
   */
  PULLBACK_SUPPORT_ATR_FRACTION: 0.5,

  // ── CoinGecko adapter ─────────────────────────────────────────────────────

  /** Default request timeout for CoinGecko API calls (ms) */
  COINGECKO_TIMEOUT_MS: 10_000,

  /** Default number of coins per page for /coins/markets */
  COINGECKO_MARKETS_PER_PAGE: 50,

  /** Default number of days for /coins/{id}/market_chart */
  COINGECKO_HISTORY_DAYS: 30,

  // ── CoinGlass adapter ──────────────────────────────────────────────────────

  /** Default request timeout for CoinGlass API calls (ms) */
  COINGLASS_TIMEOUT_MS: 10_000,

  /** Default number of funding rate records to fetch */
  COINGLASS_FUNDING_LIMIT: 24,

  /** Default number of open interest records to fetch */
  COINGLASS_OI_LIMIT: 42,

  /** Default number of long/short ratio records to fetch */
  COINGLASS_LS_LIMIT: 24,
};
