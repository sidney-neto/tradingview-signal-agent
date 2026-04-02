'use strict';

/**
 * analyzeCandles — pure-computation analysis on pre-loaded candle data.
 *
 * This is the backtesting-safe entry point: it runs the full deterministic
 * analysis pipeline (indicators → classification → signal → confidence) on
 * a caller-supplied candle array WITHOUT making any network calls.
 *
 * It intentionally omits:
 *   - Symbol resolution (TradingView WebSocket)
 *   - Candle fetching (TradingView WebSocket)
 *   - External overlays (CoinGlass, Bybit, CoinGecko)
 *
 * This makes it safe and reproducible for historical replay.
 *
 * @param {object} params
 * @param {Array}  params.candles    — OHLCV array, oldest-first
 *                                     Each element: { time, open, high, low, close, volume }
 * @param {string} params.symbol     — Symbol label (e.g. "BTCUSDT"), for output only
 * @param {string} params.symbolId   — Symbol ID (e.g. "BINANCE:BTCUSDT"), for output only
 * @param {string} params.timeframe  — Timeframe label (e.g. "1h"), for output only
 * @param {object} [params.options]
 * @param {boolean} [params.options.skipPatterns] — skip chart pattern detection (default: false)
 *
 * @returns {object} Same output shape as analyzeMarket, minus exchange/description
 *                   and with perpContext/macroContext/bybitContext always null.
 */

const defaults = require('../config/defaults');
const { computeAnalysisPipeline }   = require('../analyzer/pipeline');
const { computeTradeQualification } = require('../analyzer/tradeQualification');

function candleTimeToIso(time) {
  if (typeof time !== 'number') return null;
  const ms = time < 1e12 ? time * 1000 : time;
  return new Date(ms).toISOString();
}

function analyzeCandles({ candles, symbol, symbolId, timeframe, options = {} }) {
  if (!Array.isArray(candles) || candles.length < defaults.MIN_CANDLES) {
    throw new Error(
      `analyzeCandles: need at least ${defaults.MIN_CANDLES} candles, got ${candles ? candles.length : 0}`
    );
  }

  const core = computeAnalysisPipeline({ candles, symbol, timeframe, options });

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
    confidence,
    invalidation,
    targets,
    dataQuality,
    warnings,
    summary,
  } = core;

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
  });

  const confidenceBreakdown = {
    base:            baseConfidence,
    afterQuality:    confidence,
    cgAdjustment:    0,
    bybitAdjustment: 0,
    cgkoAdjustment:  0,
    final:           confidence,
    cgAvailable:     false,
    bybitAvailable:  false,
    cgkoAvailable:   false,
  };

  return {
    symbol,
    symbolId:             symbolId || symbol,
    timeframe,
    price:                currentPrice,
    trend,
    momentum,
    volumeState,
    volatilityState,
    signal,
    confidence,
    invalidation:         invalidation || null,
    targets:              targets || [],
    summary,
    indicators,
    trendlineState,
    zoneState,
    perpContext:          null,
    macroContext:         null,
    bybitContext:         null,
    marketBreadthContext: null,
    trendingContext:      null,
    confidenceBreakdown,
    dataQuality,
    warnings,
    chartPatterns,
    tradeQualification,
    candleCount:          candles.length,
    lastCandleTime:       candleTimeToIso(candles[candles.length - 1].time),
    timestamp:            candleTimeToIso(candles[candles.length - 1].time),
  };
}

module.exports = { analyzeCandles };
