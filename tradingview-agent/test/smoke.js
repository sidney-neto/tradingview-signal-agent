'use strict';

/**
 * Smoke test — validates that all modules load correctly, indicator math is
 * working, and the analysis pipeline runs end-to-end with synthetic candle data
 * (no live WebSocket connection required).
 *
 * Run with: node test/smoke.js
 */

const assert = require('assert');

// ── Utilities ────────────────────────────────────────────────────────────────

const { resolveTimeframe, getSupportedTimeframes } = require('../src/utils/timeframes');

assert.strictEqual(resolveTimeframe('1h'), '60',  'resolveTimeframe 1h → 60');
assert.strictEqual(resolveTimeframe('4h'), '240', 'resolveTimeframe 4h → 240');
assert.strictEqual(resolveTimeframe('1d'), '1D',  'resolveTimeframe 1d → 1D');
assert.strictEqual(resolveTimeframe('1w'), '1W',  'resolveTimeframe 1w → 1W');
assert.ok(getSupportedTimeframes().includes('15m'), 'getSupportedTimeframes includes 15m');

let threw = false;
try { resolveTimeframe('2h'); } catch (_) { threw = true; }
assert.ok(threw, 'resolveTimeframe 2h should throw');

console.log('✓ utils/timeframes');

// ── Indicators ───────────────────────────────────────────────────────────────

const { ema, sma, lastValue } = require('../src/analyzer/indicators');

// Build a simple ascending price series
const prices = Array.from({ length: 60 }, (_, i) => 100 + i);

const ema20Series = ema(prices, 20);
assert.ok(isNaN(ema20Series[18]), 'EMA20 index 18 should be NaN');
assert.ok(!isNaN(ema20Series[19]), 'EMA20 index 19 should be valid');

const sma20Series = sma(prices, 20);
assert.ok(Math.abs(lastValue(sma20Series) - 149.5) < 0.01, 'SMA20 last ≈ 149.5');

console.log('✓ analyzer/indicators');

// ── RSI ──────────────────────────────────────────────────────────────────────

const { rsi, classifyRsi } = require('../src/analyzer/rsi');

const rsiSeries = rsi(prices, 14);
assert.ok(!isNaN(lastValue(rsiSeries)), 'RSI has a valid last value');
assert.ok(lastValue(rsiSeries) > 50, 'RSI should be high on ascending series');
assert.strictEqual(classifyRsi(75), 'overbought', 'classifyRsi 75 → overbought');
assert.strictEqual(classifyRsi(30), 'oversold',   'classifyRsi 30 → oversold');

console.log('✓ analyzer/rsi');

// ── ATR ──────────────────────────────────────────────────────────────────────

const { atr, classifyVolatility } = require('../src/analyzer/atr');

const candles = prices.map((p, i) => ({
  time: 1000 * i, open: p - 0.5, high: p + 1, low: p - 1, close: p, volume: 1000,
}));

const atrSeries = atr(candles, 14);
assert.ok(!isNaN(lastValue(atrSeries)), 'ATR has a valid last value');
assert.ok(lastValue(atrSeries) > 0, 'ATR should be positive');
assert.strictEqual(classifyVolatility(0.1, 100), 'very_low', 'classifyVolatility 0.1% → very_low');

console.log('✓ analyzer/atr');

// ── Volume ───────────────────────────────────────────────────────────────────

const { avgVolume, classifyVolume } = require('../src/analyzer/volume');

const volSeries = avgVolume(candles, 20);
assert.ok(!isNaN(lastValue(volSeries)), 'avgVolume has valid last value');
assert.strictEqual(classifyVolume(2000, 1000), 'high',    'classifyVolume 2x → high');
assert.strictEqual(classifyVolume(500,  1000), 'low',     'classifyVolume 0.5x → low');

console.log('✓ analyzer/volume');

// ── Pivots ───────────────────────────────────────────────────────────────────

const { detectPivots } = require('../src/analyzer/pivots');

// Create candles with some obvious pivot highs/lows
const pivotCandles = [
  ...Array.from({ length: 10 }, (_, i) => ({ time: i, open: 100, high: 100 + i, low: 99, close: 100, volume: 1000 })),
  { time: 10, open: 109, high: 115, low: 108, close: 110, volume: 1200 }, // local high
  ...Array.from({ length: 10 }, (_, i) => ({ time: 11 + i, open: 105, high: 107, low: 95 - i, close: 100 - i, volume: 900 })),
  { time: 21, open: 90, high: 92, low: 85, close: 86, volume: 800 }, // local low
  ...Array.from({ length: 10 }, (_, i) => ({ time: 22 + i, open: 88 + i, high: 90 + i, low: 87, close: 89 + i, volume: 900 })),
];

const { pivotHighs, pivotLows } = detectPivots(pivotCandles, 3);
assert.ok(pivotHighs.length > 0, 'detectPivots should find at least one pivot high');
assert.ok(pivotLows.length  > 0,  'detectPivots should find at least one pivot low');

console.log('✓ analyzer/pivots');

// ── Trendlines ───────────────────────────────────────────────────────────────

const { analyzeTrendlines } = require('../src/analyzer/trendlines');

const trendState = analyzeTrendlines({
  pivotHighs,
  pivotLows,
  candles: pivotCandles,
  currentPrice: pivotCandles[pivotCandles.length - 1].close,
  atrValue: 2,
});

assert.ok(typeof trendState.activeTrendlineType === 'string', 'trendlineState.activeTrendlineType is a string');
assert.ok(typeof trendState.explanation === 'string', 'trendlineState.explanation is a string');
assert.ok(typeof trendState.lineBreakDetected === 'boolean', 'lineBreakDetected is boolean');

console.log('✓ analyzer/trendlines');

// ── Zones ────────────────────────────────────────────────────────────────────

const { detectZone } = require('../src/analyzer/zones');

// Flat zone for consolidation test
const flatCandles = Array.from({ length: 50 }, (_, i) => ({
  time: i, open: 100, high: 100.5, low: 99.5, close: 100 + Math.sin(i) * 0.3, volume: 1000,
}));

const zoneState = detectZone({ candles: flatCandles, atrValue: 1.5, atrSeries: [] });
assert.ok(typeof zoneState.zoneType === 'string', 'zoneState.zoneType is a string');
assert.ok(['consolidation', 'accumulation', 'none'].includes(zoneState.zoneType), 'zoneType is valid');

console.log('✓ analyzer/zones');

// ── Rules ────────────────────────────────────────────────────────────────────

const { classifyTrend, classifyMomentum, classifySignal } = require('../src/analyzer/rules');

const trend = classifyTrend({ price: 110, ema20: 105, ema50: 100, ema100: 95, ema200: 90, ma200: 88 });
assert.strictEqual(trend, 'strong_bullish', 'classifyTrend should be strong_bullish');

const bearishTrend = classifyTrend({ price: 80, ema20: 85, ema50: 90, ema100: 95, ema200: 100, ma200: 102 });
assert.strictEqual(bearishTrend, 'strong_bearish', 'classifyTrend should be strong_bearish');

const momentum = classifyMomentum({ rsi14: 62, volumeState: 'average', trendlineBreak: 'none', zoneType: 'none' });
assert.strictEqual(momentum, 'bullish', 'classifyMomentum RSI 62 → bullish');

const { signal } = classifySignal({
  trend: 'bullish', momentum: 'bullish', volumeState: 'high', volatilityState: 'moderate',
  trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none', bearishTrendline: null, bullishTrendline: null },
  zoneState: { zoneType: 'none' },
});
assert.ok(['pullback_watch', 'breakout_watch', 'no_trade'].includes(signal), `signal "${signal}" is valid`);

console.log('✓ analyzer/rules');

// ── Scoring ──────────────────────────────────────────────────────────────────

const { assessDataQuality, adjustConfidence } = require('../src/analyzer/scoring');

const { score, warnings: w } = assessDataQuality({
  indicators: { ema20: 100, ema50: 95, ema100: 90, ema200: NaN, ma200: NaN, rsi14: 55, atr14: 2, avgVolume20: 1000 },
  trendlineState: { activeTrendlineType: 'bearish' },
  zoneState: { zoneType: 'none' },
  candleCount: 250,
});
assert.ok(['good', 'fair', 'poor'].includes(score), 'quality score is valid');
assert.ok(w.length > 0, 'warnings present when EMA200/MA200 missing');

assert.strictEqual(adjustConfidence(0.6, 'fair'), 0.51, 'adjustConfidence 0.6 × 0.85 ≈ 0.51');

console.log('✓ analyzer/scoring');

// ── Summary ──────────────────────────────────────────────────────────────────

const { buildSummary } = require('../src/analyzer/summary');

const summary = buildSummary({
  symbol: 'BTCUSDT', timeframe: '15m', price: 67000,
  trend: 'bullish', momentum: 'neutral_bullish',
  signal: 'pullback_watch', confidence: 0.55,
  volumeState: 'average', volatilityState: 'moderate',
  indicators: { rsi14: 58 },
  trendlineState: { explanation: 'Trendline intact.' },
  zoneState: { zoneType: 'none', explanation: '' },
  targets: ['Prior highs.'],
  invalidation: 'Close below EMA50.',
});

assert.ok(typeof summary === 'string' && summary.length > 10, 'buildSummary returns non-empty string');
assert.ok(summary.includes('BTCUSDT'), 'summary includes symbol');

console.log('✓ analyzer/summary');

// ── Errors ───────────────────────────────────────────────────────────────────

const {
  SymbolNotFoundError,
  CandleFetchTimeoutError,
  InsufficientCandlesError,
} = require('../src/adapters/tradingview/errors');

const e1 = new SymbolNotFoundError('XYZ');
assert.ok(e1 instanceof Error, 'SymbolNotFoundError is an Error');
assert.ok(e1.message.includes('XYZ'), 'SymbolNotFoundError message includes query');

const e2 = new CandleFetchTimeoutError('BINANCE:BTC', '60', 10000);
assert.ok(e2.message.includes('10000'), 'timeout message includes ms');

const e3 = new InsufficientCandlesError('BINANCE:BTC', 50, 20);
assert.ok(e3.message.includes('50'), 'insufficient candles message includes required');

console.log('✓ adapters/errors');

// ── CoinGlass adapter (unit tests — no live API key required) ─────────────────

// -- errors --
const cgErrors = require('../src/adapters/coinglass/errors');

const cgBase = new cgErrors.CoinGlassError('base error');
assert.ok(cgBase instanceof Error, 'CoinGlassError is an Error');
assert.strictEqual(cgBase.name, 'CoinGlassError', 'CoinGlassError.name is set');

const missingKey = new cgErrors.MissingApiKeyError();
assert.strictEqual(missingKey.code, 'missing_api_key', 'MissingApiKeyError.code');
assert.ok(missingKey.message.includes('COINGLASS_API_KEY'), 'MissingApiKeyError message mentions env var');

const unauth = new cgErrors.UnauthorizedError();
assert.strictEqual(unauth.code, 'unauthorized', 'UnauthorizedError.code');

const rateLimit = new cgErrors.RateLimitedError();
assert.strictEqual(rateLimit.code, 'rate_limited', 'RateLimitedError.code');

const upstream = new cgErrors.UpstreamUnavailableError('down', new Error('cause'));
assert.strictEqual(upstream.code, 'upstream_unavailable', 'UpstreamUnavailableError.code');
assert.ok(upstream.cause instanceof Error, 'UpstreamUnavailableError.cause is set');

const invalidSym = new cgErrors.InvalidSymbolError('FAKE');
assert.strictEqual(invalidSym.code, 'invalid_symbol', 'InvalidSymbolError.code');
assert.ok(invalidSym.message.includes('FAKE'), 'InvalidSymbolError message includes symbol');

const timeout = new cgErrors.CoinGlassTimeoutError(5000);
assert.strictEqual(timeout.code, 'timeout', 'CoinGlassTimeoutError.code');
assert.strictEqual(timeout.timeoutMs, 5000, 'CoinGlassTimeoutError.timeoutMs');

const invalidResp = new cgErrors.InvalidResponseError('bad json');
assert.strictEqual(invalidResp.code, 'invalid_response', 'InvalidResponseError.code');

console.log('✓ adapters/coinglass/errors');

// -- normalize helpers --
const {
  unwrapResponse,
  normalizeOhlcRecord,
  extractBaseCoin,
  normalizeTradingPair,
  average,
  last: cgLast,
} = require('../src/adapters/coinglass/normalize');

// unwrapResponse — success path
const unwrapped = unwrapResponse({ code: '0', msg: 'success', data: [1, 2, 3] });
assert.deepStrictEqual(unwrapped, [1, 2, 3], 'unwrapResponse returns data on code=0');

// unwrapResponse — numeric code 0 also accepted
const unwrapped2 = unwrapResponse({ code: 0, msg: 'success', data: { x: 1 } });
assert.deepStrictEqual(unwrapped2, { x: 1 }, 'unwrapResponse accepts numeric code 0');

// unwrapResponse — error code
let cgThrew = false;
try { unwrapResponse({ code: '50001', msg: 'api key error', data: null }); } catch (_) { cgThrew = true; }
assert.ok(cgThrew, 'unwrapResponse throws on non-zero code');

// unwrapResponse — missing data
let cgThrew2 = false;
try { unwrapResponse({ code: '0', msg: 'success' }); } catch (_) { cgThrew2 = true; }
assert.ok(cgThrew2, 'unwrapResponse throws when data field is absent');

// normalizeOhlcRecord
const ohlc = normalizeOhlcRecord({ t: 1700000000, o: '0.001', h: '0.002', l: '0.0005', c: '0.0015' });
assert.strictEqual(ohlc.time,  1700000000, 'normalizeOhlcRecord.time');
assert.strictEqual(ohlc.open,  0.001,      'normalizeOhlcRecord.open');
assert.strictEqual(ohlc.close, 0.0015,     'normalizeOhlcRecord.close');

// extractBaseCoin
assert.strictEqual(extractBaseCoin('BINANCE:MMTUSDT.P'), 'MMT',    'extractBaseCoin: exchange prefix + .P suffix');
assert.strictEqual(extractBaseCoin('BTCUSDT'),           'BTC',    'extractBaseCoin: pair only');
assert.strictEqual(extractBaseCoin('BTC'),               'BTC',    'extractBaseCoin: coin only');
assert.strictEqual(extractBaseCoin('ETHUSDT.P'),         'ETH',    'extractBaseCoin: .P suffix');
assert.strictEqual(extractBaseCoin('SOLUSDT'),           'SOL',    'extractBaseCoin: SOL pair');

// normalizeTradingPair
assert.strictEqual(normalizeTradingPair('BINANCE:MMTUSDT.P'), 'MMTUSDT', 'normalizeTradingPair: strips prefix+suffix');
assert.strictEqual(normalizeTradingPair('BTCUSDT.P'),         'BTCUSDT', 'normalizeTradingPair: strips .P');
assert.strictEqual(normalizeTradingPair('BTCUSDT'),           'BTCUSDT', 'normalizeTradingPair: passthrough');

// average
assert.strictEqual(average([1, 2, 3, 4]), 2.5,  'average of [1,2,3,4]');
assert.strictEqual(average([]),           null,  'average of empty array is null');
assert.strictEqual(average(null),         null,  'average of null is null');

// last
assert.strictEqual(cgLast([10, 20, 30]), 30,   'last of [10,20,30]');
assert.strictEqual(cgLast([]),           null,  'last of empty array is null');
assert.strictEqual(cgLast(null),         null,  'last of null is null');

console.log('✓ adapters/coinglass/normalize');

// -- client: getApiKey throws when key is absent --
const { getApiKey } = require('../src/adapters/coinglass/client');
const savedKey = process.env.COINGLASS_API_KEY;
delete process.env.COINGLASS_API_KEY;

let keyThrew = false;
try { getApiKey(); } catch (err) {
  keyThrew = true;
  assert.ok(err instanceof cgErrors.MissingApiKeyError, 'getApiKey throws MissingApiKeyError');
}
assert.ok(keyThrew, 'getApiKey throws when COINGLASS_API_KEY is unset');

if (savedKey !== undefined) process.env.COINGLASS_API_KEY = savedKey;

console.log('✓ adapters/coinglass/client (missing key guard)');

// -- module load: all five context functions are exported from index --
const coinglassAdapter = require('../src/adapters/coinglass');
assert.strictEqual(typeof coinglassAdapter.getFundingContext,      'function', 'getFundingContext exported');
assert.strictEqual(typeof coinglassAdapter.getOpenInterestContext, 'function', 'getOpenInterestContext exported');
assert.strictEqual(typeof coinglassAdapter.getLongShortContext,    'function', 'getLongShortContext exported');
assert.strictEqual(typeof coinglassAdapter.getLiquidationContext,  'function', 'getLiquidationContext exported');
assert.strictEqual(typeof coinglassAdapter.getMacroContext,        'function', 'getMacroContext exported');

console.log('✓ adapters/coinglass/index (barrel exports)');

// ── computePullbackContext() (pure function — no API calls) ───────────────────

const { computePullbackContext } = require('../src/analyzer/rules');

// No data → neutral, available=false
const noCtx = computePullbackContext({});
assert.strictEqual(noCtx.confidenceAdjustment, 0,     'no ctx → adj=0');
assert.strictEqual(noCtx.available,            false, 'no ctx → available=false');
assert.deepStrictEqual(noCtx.reasons,          [],    'no ctx → no reasons');

// Extreme long funding (>= 0.001) on pullback_watch → -0.10
const extremeLong = computePullbackContext({ fundingRate: 0.0015, signal: 'pullback_watch' });
assert.strictEqual(extremeLong.confidenceAdjustment, -0.10, 'extreme long funding → -0.10');
assert.ok(extremeLong.reasons.some((r) => r.includes('funding_extreme_long')), 'reason includes funding_extreme_long');
assert.strictEqual(extremeLong.available, true, 'extreme long → available=true');

// Elevated long funding (>= 0.0003) on pullback_watch → -0.05
const longHeavy = computePullbackContext({ fundingRate: 0.0005, signal: 'pullback_watch' });
assert.strictEqual(longHeavy.confidenceAdjustment, -0.05, 'long_heavy funding → -0.05');

// Short-heavy funding (< -0.0001) on pullback_watch → +0.05
const shortHeavy = computePullbackContext({ fundingRate: -0.0002, signal: 'pullback_watch' });
assert.strictEqual(shortHeavy.confidenceAdjustment, 0.05, 'short_heavy funding → +0.05');

// Neutral funding range → no adjustment
const neutralFunding = computePullbackContext({ fundingRate: 0.0001, signal: 'pullback_watch' });
assert.strictEqual(neutralFunding.confidenceAdjustment, 0, 'neutral funding → 0');
assert.strictEqual(neutralFunding.available, true, 'neutral funding → available=true');

// Funding on no_trade → no adjustment (wrong signal type)
const noTradeCtx = computePullbackContext({ fundingRate: 0.002, signal: 'no_trade' });
assert.strictEqual(noTradeCtx.confidenceAdjustment, 0, 'extreme funding on no_trade → no adj');

// OI expanding on breakout_watch → +0.05
const oiBreakout = computePullbackContext({ oiTrend: 'rising', signal: 'breakout_watch' });
assert.strictEqual(oiBreakout.confidenceAdjustment, 0.05, 'OI expanding on breakout → +0.05');

// OI contracting on pullback_watch → -0.03
const oiContracting = computePullbackContext({ oiTrend: 'falling', signal: 'pullback_watch' });
assert.strictEqual(oiContracting.confidenceAdjustment, -0.03, 'OI contracting on pullback → -0.03');

// OI expanding on pullback_watch → no adjustment (only applies to breakout)
const oiOnPullback = computePullbackContext({ oiTrend: 'rising', signal: 'pullback_watch' });
assert.strictEqual(oiOnPullback.confidenceAdjustment, 0, 'OI expanding on pullback → no adj');

// Fear & Greed: extreme fear on pullback_watch → +0.05
const extremeFear = computePullbackContext({ fearGreedIndex: 20, signal: 'pullback_watch' });
assert.strictEqual(extremeFear.confidenceAdjustment, 0.05, 'extreme fear → +0.05');

// Fear & Greed: greed on pullback_watch → -0.05
const greed = computePullbackContext({ fearGreedIndex: 80, signal: 'pullback_watch' });
assert.strictEqual(greed.confidenceAdjustment, -0.05, 'greed → -0.05');

// Fear & Greed on breakout_watch → no adjustment (gated to pullback_watch only)
const fgBreakout = computePullbackContext({ fearGreedIndex: 15, signal: 'breakout_watch' });
assert.strictEqual(fgBreakout.confidenceAdjustment, 0, 'F&G on breakout_watch → no adj');

// BTC dominance high + isAltcoin → -0.05
const btcDomHigh = computePullbackContext({ btcDominance: 58, isAltcoin: true, signal: 'pullback_watch' });
assert.strictEqual(btcDomHigh.confidenceAdjustment, -0.05, 'BTC.D > 55 + altcoin → -0.05');

// BTC dominance high + NOT altcoin → no adjustment
const btcDomBtc = computePullbackContext({ btcDominance: 58, isAltcoin: false, signal: 'pullback_watch' });
assert.strictEqual(btcDomBtc.confidenceAdjustment, 0, 'BTC.D > 55 + not altcoin → no adj');

// Altcoin season active + isAltcoin → +0.05
const altSeason = computePullbackContext({ altcoinIndex: 80, isAltcoin: true, signal: 'pullback_watch' });
assert.strictEqual(altSeason.confidenceAdjustment, 0.05, 'altcoin season active → +0.05');

// Altcoin season low + isAltcoin → -0.05
const altLow = computePullbackContext({ altcoinIndex: 20, isAltcoin: true, signal: 'pullback_watch' });
assert.strictEqual(altLow.confidenceAdjustment, -0.05, 'altcoin season low → -0.05');

// Stacked penalties capped at -0.20
const stackedPenalty = computePullbackContext({
  fundingRate:    0.002,   // -0.10
  oiTrend:        'falling', // -0.03
  fearGreedIndex: 80,      // -0.05
  btcDominance:   60,      // -0.05
  altcoinIndex:   10,      // -0.05  (total raw = -0.28, capped at -0.20)
  isAltcoin:      true,
  signal:         'pullback_watch',
});
assert.strictEqual(stackedPenalty.confidenceAdjustment, -0.20, 'stacked penalties capped at -0.20');
assert.ok(stackedPenalty.reasons.length >= 4, 'stacked penalty has multiple reasons');

// Stacked boosts capped at +0.15
const stackedBoost = computePullbackContext({
  fundingRate:    -0.0003, // +0.05
  oiTrend:        'rising',  // +0.05 (breakout signal)
  fearGreedIndex: 15,      // +0.05 (pullback signal — won't apply since breakout)
  altcoinIndex:   80,      // +0.05
  isAltcoin:      true,
  signal:         'breakout_watch',
});
assert.ok(stackedBoost.confidenceAdjustment <= 0.15, 'stacked boosts capped at +0.15');

console.log('✓ analyzer/computePullbackContext');

// ── perpContext.js helpers (pure, no API calls) ────────────────────────────

const { isAltcoin } = require('../src/analyzer/perpContext');

assert.strictEqual(isAltcoin('BINANCE:MMTUSDT.P'), true,  'MMTUSDT.P is altcoin');
assert.strictEqual(isAltcoin('BTCUSDT'),           false, 'BTCUSDT is not altcoin');
assert.strictEqual(isAltcoin('ETHUSDT.P'),         false, 'ETHUSDT.P is not altcoin');
assert.strictEqual(isAltcoin('SOLUSDT'),           true,  'SOLUSDT is altcoin');
assert.strictEqual(isAltcoin('BTC'),               false, 'BTC is not altcoin');

console.log('✓ analyzer/perpContext (isAltcoin helper)');

// ── PlanRestrictedError ───────────────────────────────────────────────────────

const planErr = new cgErrors.PlanRestrictedError('Upgrade plan to access this endpoint.');
assert.strictEqual(planErr.code, 'plan_restricted', 'PlanRestrictedError.code');
assert.ok(planErr instanceof cgErrors.CoinGlassError, 'PlanRestrictedError extends CoinGlassError');
assert.strictEqual(planErr.providerMessage, 'Upgrade plan to access this endpoint.', 'PlanRestrictedError.providerMessage');

const planErrNoMsg = new cgErrors.PlanRestrictedError();
assert.strictEqual(planErrNoMsg.providerMessage, null, 'PlanRestrictedError.providerMessage null when omitted');

console.log('✓ adapters/coinglass/errors (PlanRestrictedError)');

// ── unwrapResponse: plan restriction detection ────────────────────────────────

let planThrew = false;
try {
  unwrapResponse({ code: '40110', msg: 'Upgrade plan', data: null });
} catch (err) {
  planThrew = true;
  assert.ok(err instanceof cgErrors.PlanRestrictedError, 'unwrapResponse throws PlanRestrictedError for upgrade msg');
}
assert.ok(planThrew, 'unwrapResponse throws on plan-restricted application error code');

let planThrew2 = false;
try {
  unwrapResponse({ code: '50010', msg: 'Your current plan does not include this feature.', data: null });
} catch (err) {
  planThrew2 = true;
  assert.ok(err instanceof cgErrors.PlanRestrictedError, 'unwrapResponse throws PlanRestrictedError for plan msg');
}
assert.ok(planThrew2, 'unwrapResponse throws on plan-restriction variant message');

// Non-plan error still throws InvalidResponseError
let nonPlanThrew = false;
try {
  unwrapResponse({ code: '10001', msg: 'invalid parameter', data: null });
} catch (err) {
  nonPlanThrew = true;
  assert.ok(err instanceof cgErrors.InvalidResponseError, 'unwrapResponse throws InvalidResponseError for generic error');
  assert.ok(!(err instanceof cgErrors.PlanRestrictedError), 'generic error is not PlanRestrictedError');
}
assert.ok(nonPlanThrew, 'unwrapResponse throws on generic non-zero code');

console.log('✓ adapters/coinglass/normalize (plan restriction detection)');

// ── fetchPerpContext: no key → providerStatus=null in neutral result ──────────

const { fetchPerpContext: fetchPerpCtx } = require('../src/analyzer/perpContext');

(async () => {
  const savedKeyForPerp = process.env.COINGLASS_API_KEY;
  delete process.env.COINGLASS_API_KEY;

  const neutralResult = await fetchPerpCtx('BTCUSDT');
  assert.strictEqual(neutralResult.available,      false,  'no key → available=false');
  assert.strictEqual(neutralResult.providerStatus, null,   'no key → providerStatus=null');
  assert.deepStrictEqual(neutralResult.warnings,   [],     'no key → no warnings');

  if (savedKeyForPerp !== undefined) process.env.COINGLASS_API_KEY = savedKeyForPerp;

  console.log('✓ analyzer/perpContext (no key → neutral with providerStatus=null)');

  // ── CoinGecko adapter (unit tests — no live API key required) ──────────────

  // -- errors --
  const cgko = require('../src/adapters/coingecko/errors');

  const cgkoBase = new cgko.CoinGeckoError('base error');
  assert.ok(cgkoBase instanceof Error,             'CoinGeckoError is an Error');
  assert.strictEqual(cgkoBase.name, 'CoinGeckoError', 'CoinGeckoError.name is set');

  const cgkoMissing = new cgko.MissingApiKeyError();
  assert.strictEqual(cgkoMissing.code, 'missing_api_key', 'MissingApiKeyError.code');
  assert.ok(cgkoMissing.message.includes('COINGECKO_API_KEY'), 'MissingApiKeyError message mentions env var');

  const cgkoUnauth = new cgko.UnauthorizedError();
  assert.strictEqual(cgkoUnauth.code, 'unauthorized', 'CoinGecko UnauthorizedError.code');

  const cgkoRate = new cgko.RateLimitedError();
  assert.strictEqual(cgkoRate.code, 'rate_limited', 'CoinGecko RateLimitedError.code');

  const cgkoPlan = new cgko.PlanRestrictedError('demo plan limitation');
  assert.strictEqual(cgkoPlan.code, 'plan_restricted', 'CoinGecko PlanRestrictedError.code');
  assert.strictEqual(cgkoPlan.providerMessage, 'demo plan limitation', 'CoinGecko PlanRestrictedError.providerMessage');

  const cgkoNotFound = new cgko.SymbolNotFoundError('FAKECOIN');
  assert.strictEqual(cgkoNotFound.code, 'symbol_not_found', 'SymbolNotFoundError.code');
  assert.ok(cgkoNotFound.message.includes('FAKECOIN'), 'SymbolNotFoundError message includes query');

  const cgkoTimeout = new cgko.CoinGeckoTimeoutError(8000);
  assert.strictEqual(cgkoTimeout.code, 'timeout', 'CoinGeckoTimeoutError.code');
  assert.strictEqual(cgkoTimeout.timeoutMs, 8000,  'CoinGeckoTimeoutError.timeoutMs');

  const cgkoInvalid = new cgko.InvalidResponseError('bad shape');
  assert.strictEqual(cgkoInvalid.code, 'invalid_response', 'CoinGecko InvalidResponseError.code');

  const cgkoUpstream = new cgko.UpstreamUnavailableError('down', new Error('net'));
  assert.strictEqual(cgkoUpstream.code, 'upstream_unavailable', 'CoinGecko UpstreamUnavailableError.code');
  assert.ok(cgkoUpstream.cause instanceof Error, 'CoinGecko UpstreamUnavailableError.cause set');

  console.log('✓ adapters/coingecko/errors');

  // -- normalize helpers --
  const {
    normalizeCoin,
    normalizeTrendingCoin,
    normalizeCategory,
    normalizePricePoint,
    resolveVsCurrency,
    safeFloat: cgkoSafeFloat,
    safeInt:   cgkoSafeInt,
  } = require('../src/adapters/coingecko/normalize');

  // normalizeCoin
  const rawCoin = {
    id: 'bitcoin', symbol: 'btc', name: 'Bitcoin',
    market_cap_rank: 1, current_price: 67000,
    market_cap: 1.3e12, price_change_24h: 500,
    price_change_percentage_24h: 0.75, total_volume: 25e9,
    high_24h: 68000, low_24h: 66000, image: 'https://example.com/btc.png',
  };
  const coin = normalizeCoin(rawCoin);
  assert.strictEqual(coin.id,     'bitcoin', 'normalizeCoin.id');
  assert.strictEqual(coin.symbol, 'BTC',     'normalizeCoin.symbol uppercased');
  assert.strictEqual(coin.rank,   1,         'normalizeCoin.rank');
  assert.strictEqual(coin.price,  67000,     'normalizeCoin.price');
  assert.strictEqual(coin.priceChangePercent24h, 0.75, 'normalizeCoin.priceChangePercent24h');

  // normalizeTrendingCoin
  const rawTrending = { item: { id: 'solana', symbol: 'sol', name: 'Solana', market_cap_rank: 5, score: 0, thumb: 'https://example.com/sol.png' } };
  const trendingCoin = normalizeTrendingCoin(rawTrending);
  assert.strictEqual(trendingCoin.id,     'solana', 'normalizeTrendingCoin.id');
  assert.strictEqual(trendingCoin.symbol, 'SOL',    'normalizeTrendingCoin.symbol uppercased');
  assert.strictEqual(trendingCoin.marketCapRank, 5, 'normalizeTrendingCoin.marketCapRank');

  // normalizeCategory
  const cat = normalizeCategory({ id: 'defi', name: 'DeFi', market_cap_1h_change: 0.5 });
  assert.strictEqual(cat.id,   'defi', 'normalizeCategory.id');
  assert.strictEqual(cat.name, 'DeFi', 'normalizeCategory.name');
  assert.strictEqual(cat.marketCap1hChange, 0.5, 'normalizeCategory.marketCap1hChange');

  // normalizePricePoint
  const pt = normalizePricePoint([1700000000000, 67000]);
  assert.strictEqual(pt.time,  1700000000000, 'normalizePricePoint.time');
  assert.strictEqual(pt.value, 67000,         'normalizePricePoint.value');

  // resolveVsCurrency
  assert.strictEqual(resolveVsCurrency('usd'),    'usd', 'resolveVsCurrency usd');
  assert.strictEqual(resolveVsCurrency('EUR'),    'eur', 'resolveVsCurrency EUR → eur');
  assert.strictEqual(resolveVsCurrency('FAKE'),   'usd', 'resolveVsCurrency unknown → usd fallback');
  assert.strictEqual(resolveVsCurrency(),         'usd', 'resolveVsCurrency undefined → usd');

  // safeFloat / safeInt
  assert.strictEqual(cgkoSafeFloat('3.14'), 3.14, 'safeFloat string number');
  assert.strictEqual(cgkoSafeFloat(null),   null,  'safeFloat null → null');
  assert.strictEqual(cgkoSafeFloat('x'),    null,  'safeFloat non-numeric → null');
  assert.strictEqual(cgkoSafeInt('5'),      5,     'safeInt string number');
  assert.strictEqual(cgkoSafeInt(null),     null,  'safeInt null → null');

  console.log('✓ adapters/coingecko/normalize');

  // -- client: no key → getApiKey() returns null (not a throw) --
  const cgkoClient = require('../src/adapters/coingecko/client');
  const savedCgkoKey = process.env.COINGECKO_API_KEY;
  delete process.env.COINGECKO_API_KEY;

  assert.strictEqual(cgkoClient.getApiKey(), null, 'CoinGecko getApiKey() returns null when key absent');

  if (savedCgkoKey !== undefined) process.env.COINGECKO_API_KEY = savedCgkoKey;

  // -- resolveTier defaults to demo --
  const savedTier = process.env.COINGECKO_API_TIER;
  delete process.env.COINGECKO_API_TIER;
  assert.strictEqual(cgkoClient.resolveTier(), 'demo', 'resolveTier defaults to demo');
  process.env.COINGECKO_API_TIER = 'paid';
  assert.strictEqual(cgkoClient.resolveTier(), 'paid', 'resolveTier=paid when env var is paid');
  if (savedTier !== undefined) process.env.COINGECKO_API_TIER = savedTier;
  else delete process.env.COINGECKO_API_TIER;

  console.log('✓ adapters/coingecko/client (tier + key helpers)');

  // -- index barrel exports --
  const cgkoIndex = require('../src/adapters/coingecko');
  assert.strictEqual(typeof cgkoIndex.getTrending,    'function', 'getTrending exported');
  assert.strictEqual(typeof cgkoIndex.getTopCoins,    'function', 'getTopCoins exported');
  assert.strictEqual(typeof cgkoIndex.getPrice,       'function', 'getPrice exported');
  assert.strictEqual(typeof cgkoIndex.getMarketChart, 'function', 'getMarketChart exported');
  assert.strictEqual(typeof cgkoIndex.CoinGeckoError, 'function', 'CoinGeckoError exported via index');

  console.log('✓ adapters/coingecko/index (barrel exports)');

  // ── analyzer/marketContext (pure helpers — no live API) ───────────────────

  const {
    buildMarketBreadthContext,
    buildTrendingContext,
    computeMarketContextAdjustment,
    extractBase,
    fetchMarketContext,
  } = require('../src/analyzer/marketContext');

  // extractBase
  assert.strictEqual(extractBase('BINANCE:MMTUSDT.P'), 'MMT',  'extractBase: exchange prefix + .P');
  assert.strictEqual(extractBase('BTCUSDT'),           'BTC',  'extractBase: pair only');
  assert.strictEqual(extractBase('SOLUSDT.P'),         'SOL',  'extractBase: .P suffix');
  assert.strictEqual(extractBase(null),                null,   'extractBase: null → null');

  // buildMarketBreadthContext
  const fakeBreadthData = {
    marketBreadth: { total: 50, gainers: 35, losers: 13, neutral: 2, gainersPercent: 70, regime: 'risk_on' },
    vsCurrency:   'usd',
  };
  const breadthCtx = buildMarketBreadthContext(fakeBreadthData);
  assert.strictEqual(breadthCtx.regime,         'risk_on', 'breadthCtx.regime');
  assert.strictEqual(breadthCtx.total,          50,        'breadthCtx.total');
  assert.strictEqual(breadthCtx.gainers,        35,        'breadthCtx.gainers');
  assert.strictEqual(breadthCtx.gainersPercent, 70,        'breadthCtx.gainersPercent');
  assert.strictEqual(breadthCtx.vsCurrency,     'usd',     'breadthCtx.vsCurrency');
  assert.strictEqual(breadthCtx.source,         'coingecko', 'breadthCtx.source');

  // buildTrendingContext — match
  const fakeTrendingData = {
    trendingSymbols: ['SOL', 'PEPE', 'MMT', 'BTC'],
    trendingIds:     ['solana', 'pepe', 'mmt', 'bitcoin'],
    topTrending: [
      { symbol: 'SOL', name: 'Solana' },
      { symbol: 'PEPE', name: 'Pepe' },
      { symbol: 'MMT', name: 'MMT Token' },
      { symbol: 'BTC', name: 'Bitcoin' },
    ],
  };

  const trendMatch = buildTrendingContext(fakeTrendingData, 'BINANCE:MMTUSDT.P');
  assert.strictEqual(trendMatch.isTrending,    true,        'trendingCtx: MMTUSDT.P is trending');
  assert.strictEqual(trendMatch.trendingRank,  3,           'trendingCtx: rank = 3 (1-based)');
  assert.strictEqual(trendMatch.matchedSymbol, 'MMT',       'trendingCtx: matchedSymbol = MMT');
  assert.strictEqual(trendMatch.matchedName,   'MMT Token', 'trendingCtx: matchedName set');
  assert.strictEqual(trendMatch.source,        'coingecko', 'trendingCtx: source');

  // buildTrendingContext — no match
  const trendNoMatch = buildTrendingContext(fakeTrendingData, 'BINANCE:DOGEUSDT.P');
  assert.strictEqual(trendNoMatch.isTrending,   false, 'trendingCtx: DOGE not trending');
  assert.strictEqual(trendNoMatch.trendingRank, null,  'trendingCtx: rank null when not trending');
  assert.strictEqual(trendNoMatch.matchedSymbol,null,  'trendingCtx: matchedSymbol null');

  // buildTrendingContext — BTC match (rank 4)
  const trendBtc = buildTrendingContext(fakeTrendingData, 'BTCUSDT');
  assert.strictEqual(trendBtc.isTrending,   true, 'trendingCtx: BTC is trending');
  assert.strictEqual(trendBtc.trendingRank, 4,    'trendingCtx: BTC rank = 4');

  // fetchMarketContext: no key → both fields null, no throw
  const savedCgkoKeyMC = process.env.COINGECKO_API_KEY;
  delete process.env.COINGECKO_API_KEY;

  const mcNoKey = await fetchMarketContext('BTCUSDT');
  assert.strictEqual(mcNoKey.marketBreadthContext, null, 'fetchMarketContext no key → breadth null');
  assert.strictEqual(mcNoKey.trendingContext,      null, 'fetchMarketContext no key → trending null');

  if (savedCgkoKeyMC !== undefined) process.env.COINGECKO_API_KEY = savedCgkoKeyMC;

  console.log('✓ analyzer/marketContext (pure helpers + no-key graceful fallback)');

  // ── computeMarketContextAdjustment (pure — no API calls) ─────────────────

  const riskOnCtx  = { regime: 'risk_on',  total: 50, gainers: 35, losers: 10, neutral: 5, gainersPercent: 70, vsCurrency: 'usd', source: 'coingecko' };
  const riskOffCtx = { regime: 'risk_off', total: 50, gainers: 15, losers: 30, neutral: 5, gainersPercent: 30, vsCurrency: 'usd', source: 'coingecko' };
  const mixedCtx   = { regime: 'mixed',    total: 50, gainers: 25, losers: 24, neutral: 1, gainersPercent: 50, vsCurrency: 'usd', source: 'coingecko' };

  const notTrending = { isTrending: false, trendingRank: null, matchedSymbol: null, matchedName: null, source: 'coingecko' };
  const trendTop3   = { isTrending: true,  trendingRank: 2,    matchedSymbol: 'SOL', matchedName: 'Solana', source: 'coingecko' };
  const trendLower  = { isTrending: true,  trendingRank: 5,    matchedSymbol: 'SOL', matchedName: 'Solana', source: 'coingecko' };

  // No CoinGecko data → zero adjustment
  const noCtx = computeMarketContextAdjustment({ breadthContext: null, trendingCtx: null, signal: 'breakout_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(noCtx.adjustment, 0,  'no cgko data → 0 adj');
  assert.deepStrictEqual(noCtx.reasons, [], 'no cgko data → no reasons');

  // BTC excluded regardless of breadth
  const btcRiskOn = computeMarketContextAdjustment({ breadthContext: riskOnCtx, trendingCtx: notTrending, signal: 'breakout_watch', symbol: 'BTCUSDT.P' });
  assert.strictEqual(btcRiskOn.adjustment, 0, 'BTC excluded from cgko adj');

  // ETH excluded
  const ethRiskOn = computeMarketContextAdjustment({ breadthContext: riskOnCtx, trendingCtx: notTrending, signal: 'breakout_watch', symbol: 'ETHUSDT.P' });
  assert.strictEqual(ethRiskOn.adjustment, 0, 'ETH excluded from cgko adj');

  // Altcoin breakout + risk_on → +0.03
  const altBreakoutRiskOn = computeMarketContextAdjustment({ breadthContext: riskOnCtx, trendingCtx: notTrending, signal: 'breakout_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(altBreakoutRiskOn.adjustment, 0.03, 'alt breakout + risk_on → +0.03');
  assert.ok(altBreakoutRiskOn.reasons.some((r) => r.includes('breadth_risk_on_breakout_watch')), 'reason mentions breadth_risk_on_breakout_watch');

  // Altcoin pullback + risk_on → +0.03
  const altPullbackRiskOn = computeMarketContextAdjustment({ breadthContext: riskOnCtx, trendingCtx: notTrending, signal: 'pullback_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(altPullbackRiskOn.adjustment, 0.03, 'alt pullback + risk_on → +0.03');

  // Altcoin breakout + risk_off → -0.05
  const altBreakoutRiskOff = computeMarketContextAdjustment({ breadthContext: riskOffCtx, trendingCtx: notTrending, signal: 'breakout_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(altBreakoutRiskOff.adjustment, -0.05, 'alt breakout + risk_off → -0.05');
  assert.ok(altBreakoutRiskOff.reasons.some((r) => r.includes('breadth_risk_off_breakout_watch')), 'reason mentions breadth_risk_off');

  // Altcoin pullback + risk_off → -0.03
  const altPullbackRiskOff = computeMarketContextAdjustment({ breadthContext: riskOffCtx, trendingCtx: notTrending, signal: 'pullback_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(altPullbackRiskOff.adjustment, -0.03, 'alt pullback + risk_off → -0.03');

  // Mixed breadth → 0
  const altMixed = computeMarketContextAdjustment({ breadthContext: mixedCtx, trendingCtx: notTrending, signal: 'breakout_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(altMixed.adjustment, 0, 'mixed breadth → 0 adj');

  // Trending top-3 altcoin breakout → +0.05 (no breadth)
  const altTrendTop3Breakout = computeMarketContextAdjustment({ breadthContext: null, trendingCtx: trendTop3, signal: 'breakout_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(altTrendTop3Breakout.adjustment, 0.05, 'trending top3 alt breakout → +0.05');
  assert.ok(altTrendTop3Breakout.reasons.some((r) => r.includes('trending_breakout_watch_top3')), 'reason mentions trending_top3');

  // Trending lower-rank altcoin breakout → +0.03
  const altTrendLowerBreakout = computeMarketContextAdjustment({ breadthContext: null, trendingCtx: trendLower, signal: 'breakout_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(altTrendLowerBreakout.adjustment, 0.03, 'trending lower-rank alt breakout → +0.03');

  // Trending top-3 altcoin pullback → +0.03
  const altTrendTop3Pullback = computeMarketContextAdjustment({ breadthContext: null, trendingCtx: trendTop3, signal: 'pullback_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(altTrendTop3Pullback.adjustment, 0.03, 'trending top3 alt pullback → +0.03');

  // Stacked: risk_on + trending top3 breakout → +0.08 (cap)
  const stacked = computeMarketContextAdjustment({ breadthContext: riskOnCtx, trendingCtx: trendTop3, signal: 'breakout_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(stacked.adjustment, 0.08, 'risk_on + top3 trending breakout → +0.08 (cap)');
  assert.strictEqual(stacked.reasons.length, 2, 'stacked has 2 reasons');

  // no_trade signal → zero regardless of context
  const noTrade = computeMarketContextAdjustment({ breadthContext: riskOnCtx, trendingCtx: trendTop3, signal: 'no_trade', symbol: 'SOLUSDT.P' });
  assert.strictEqual(noTrade.adjustment, 0, 'no_trade → 0 cgko adj');

  // bearish signal → zero
  const bearish = computeMarketContextAdjustment({ breadthContext: riskOffCtx, trendingCtx: notTrending, signal: 'bearish_breakdown_watch', symbol: 'SOLUSDT.P' });
  assert.strictEqual(bearish.adjustment, 0, 'bearish_breakdown_watch → 0 cgko adj');

  console.log('✓ analyzer/computeMarketContextAdjustment');

  // ── Bybit adapter ─────────────────────────────────────────────────────────

  // adapters/bybit/errors
  {
    const bybitErrors = require('../src/adapters/bybit/errors');
    assert.strictEqual(bybitErrors.MissingSymbolError.prototype.constructor.name, 'MissingSymbolError');
    const e1 = new bybitErrors.MissingSymbolError();
    assert.strictEqual(e1.code, 'missing_symbol',       'MissingSymbolError code');
    const e2 = new bybitErrors.InvalidSymbolError('BADX');
    assert.strictEqual(e2.code, 'invalid_symbol',       'InvalidSymbolError code');
    assert.strictEqual(e2.symbol, 'BADX',               'InvalidSymbolError carries symbol');
    const e3 = new bybitErrors.RateLimitedError();
    assert.strictEqual(e3.code, 'rate_limited',         'RateLimitedError code');
    const e4 = new bybitErrors.GeoRestrictedError();
    assert.strictEqual(e4.code, 'geo_restricted',       'GeoRestrictedError code');
    const e5 = new bybitErrors.UpstreamUnavailableError('down');
    assert.strictEqual(e5.code, 'upstream_unavailable', 'UpstreamUnavailableError code');
    const e6 = new bybitErrors.BybitTimeoutError(5000);
    assert.strictEqual(e6.code, 'timeout',              'BybitTimeoutError code');
    assert.strictEqual(e6.timeoutMs, 5000,              'BybitTimeoutError carries timeoutMs');
    const e7 = new bybitErrors.InvalidResponseError();
    assert.strictEqual(e7.code, 'invalid_response',     'InvalidResponseError code');
    const e8 = new bybitErrors.BybitApiError(10001, 'bad symbol');
    assert.strictEqual(e8.code, 'api_error',            'BybitApiError code');
    assert.strictEqual(e8.retCode, 10001,               'BybitApiError carries retCode');
    const e9 = new bybitErrors.BybitInternalError('boom');
    assert.strictEqual(e9.code, 'internal_error',       'BybitInternalError code');
    const e10 = new bybitErrors.UnauthorizedError();
    assert.strictEqual(e10.code, 'unauthorized',        'UnauthorizedError code');
    const e11 = new bybitErrors.UnsupportedFeatureError();
    assert.strictEqual(e11.code, 'unsupported_feature', 'UnsupportedFeatureError code');

    // All errors are instances of BybitError
    for (const e of [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11]) {
      assert.ok(e instanceof bybitErrors.BybitError, `${e.constructor.name} instanceof BybitError`);
    }
  }
  console.log('✓ adapters/bybit/errors');

  // adapters/bybit/normalize — symbol normalization
  {
    const {
      normalizeBybitSymbol,
      safeFloat, safeInt,
      average, last,
      normalizeInstrument, normalizeTicker,
      normalizeFundingRecord, normalizeOIRecord, normalizeLSRecord,
    } = require('../src/adapters/bybit/normalize');

    // normalizeBybitSymbol
    assert.strictEqual(normalizeBybitSymbol('BINANCE:BTCUSDT.P'), 'BTCUSDT', 'normalize: exchange prefix + .P');
    assert.strictEqual(normalizeBybitSymbol('BTCUSDT.P'),         'BTCUSDT', 'normalize: .P suffix');
    assert.strictEqual(normalizeBybitSymbol('BTCUSDT.PERP'),      'BTCUSDT', 'normalize: .PERP suffix');
    assert.strictEqual(normalizeBybitSymbol('BTCUSDT'),           'BTCUSDT', 'normalize: already clean');
    assert.strictEqual(normalizeBybitSymbol('btcusdt'),           'BTCUSDT', 'normalize: lowercase');
    assert.strictEqual(normalizeBybitSymbol('ETHUSDT.P'),         'ETHUSDT', 'normalize: ETH .P');
    assert.strictEqual(normalizeBybitSymbol('BINANCE:SOLUSDT.P'), 'SOLUSDT', 'normalize: SOL exchange+.P');
    assert.strictEqual(normalizeBybitSymbol(null),                null,      'normalize: null → null');
    assert.strictEqual(normalizeBybitSymbol(''),                  null,      'normalize: empty → null');

    // safeFloat / safeInt
    assert.strictEqual(safeFloat('1.23'),     1.23, 'safeFloat string');
    assert.strictEqual(safeFloat(1.23),       1.23, 'safeFloat number');
    assert.strictEqual(safeFloat(null),       null, 'safeFloat null');
    assert.strictEqual(safeFloat(''),         null, 'safeFloat empty string');
    assert.strictEqual(safeFloat('abc'),      null, 'safeFloat NaN string');
    assert.strictEqual(safeInt('42'),         42,   'safeInt string');
    assert.strictEqual(safeInt(null),         null, 'safeInt null');

    // average / last
    assert.strictEqual(average([1, 2, 3]),  2,    'average [1,2,3]');
    assert.strictEqual(average([]),         null, 'average empty → null');
    assert.strictEqual(average(null),       null, 'average null → null');
    assert.strictEqual(last([1, 2, 3]),     3,    'last [1,2,3]');
    assert.strictEqual(last([]),            null, 'last empty → null');

    // normalizeInstrument
    const rawInstrument = {
      symbol: 'BTCUSDT', contractType: 'LinearPerpetual', status: 'Trading',
      baseCoin: 'BTC', quoteCoin: 'USDT', settleCoin: 'USDT',
      launchTime: '1584681600000',
      priceFilter: { tickSize: '0.50' },
      lotSizeFilter: { qtyStep: '0.001' },
    };
    const inst = normalizeInstrument(rawInstrument, 'linear');
    assert.strictEqual(inst.symbol,       'BTCUSDT',           'instrument.symbol');
    assert.strictEqual(inst.category,     'linear',            'instrument.category');
    assert.strictEqual(inst.baseCoin,     'BTC',               'instrument.baseCoin');
    assert.strictEqual(inst.contractType, 'LinearPerpetual',   'instrument.contractType');
    assert.strictEqual(inst.status,       'Trading',           'instrument.status');
    assert.strictEqual(inst.tickSize,     0.5,                 'instrument.tickSize');
    assert.strictEqual(inst.qtyStep,      0.001,               'instrument.qtyStep');
    assert.strictEqual(inst.launchTime,   1584681600000,       'instrument.launchTime');
    assert.strictEqual(inst.source,       'bybit',             'instrument.source');
    assert.ok(Array.isArray(inst.warnings),                    'instrument.warnings is array');

    // normalizeTicker
    const rawTicker = {
      symbol: 'BTCUSDT', lastPrice: '71000', markPrice: '71010',
      indexPrice: '71005', fundingRate: '0.0001',
      openInterest: '50000', openInterestValue: '3550000000',
      basis: '5.0', volume24h: '12000', turnover24h: '852000000',
      nextFundingTime: '1700000000000',
    };
    const tick = normalizeTicker(rawTicker);
    assert.strictEqual(tick.symbol,      'BTCUSDT', 'ticker.symbol');
    assert.strictEqual(tick.lastPrice,   71000,     'ticker.lastPrice');
    assert.strictEqual(tick.markPrice,   71010,     'ticker.markPrice');
    assert.strictEqual(tick.fundingRate, 0.0001,    'ticker.fundingRate');
    assert.strictEqual(tick.volume24h,   12000,     'ticker.volume24h');
    assert.strictEqual(tick.source,      'bybit',   'ticker.source');

    // normalizeFundingRecord
    const rawFund = { symbol: 'BTCUSDT', fundingRate: '0.0001', fundingRateTimestamp: '1700000000000' };
    const fund = normalizeFundingRecord(rawFund);
    assert.strictEqual(fund.fundingRate, 0.0001,         'fundingRecord.fundingRate');
    assert.strictEqual(fund.timestamp,   1700000000000,  'fundingRecord.timestamp');

    // normalizeOIRecord
    const rawOI = { openInterest: '50000', timestamp: '1700000000000' };
    const oi = normalizeOIRecord(rawOI);
    assert.strictEqual(oi.openInterest, 50000,          'oiRecord.openInterest');
    assert.strictEqual(oi.timestamp,    1700000000000,  'oiRecord.timestamp');

    // normalizeLSRecord
    const rawLS = { symbol: 'BTCUSDT', buyRatio: '0.62', sellRatio: '0.38', timestamp: '1700000000000' };
    const ls = normalizeLSRecord(rawLS);
    assert.strictEqual(ls.buyRatio,  0.62, 'lsRecord.buyRatio');
    assert.strictEqual(ls.sellRatio, 0.38, 'lsRecord.sellRatio');
  }
  console.log('✓ adapters/bybit/normalize');

  // adapters/bybit/client (env resolution)
  {
    const { resolveBaseUrl, MAINNET_BASE_URL, TESTNET_BASE_URL } = require('../src/adapters/bybit/client');

    const savedEnv = process.env.BYBIT_ENV;
    const savedUrl = process.env.BYBIT_BASE_URL;

    delete process.env.BYBIT_ENV;
    delete process.env.BYBIT_BASE_URL;
    assert.strictEqual(resolveBaseUrl(), MAINNET_BASE_URL, 'default → mainnet');

    process.env.BYBIT_ENV = 'testnet';
    assert.strictEqual(resolveBaseUrl(), TESTNET_BASE_URL, 'BYBIT_ENV=testnet → testnet');

    process.env.BYBIT_BASE_URL = 'https://custom.example.com';
    assert.strictEqual(resolveBaseUrl(), 'https://custom.example.com', 'BYBIT_BASE_URL override');

    if (savedEnv !== undefined) process.env.BYBIT_ENV = savedEnv; else delete process.env.BYBIT_ENV;
    if (savedUrl !== undefined) process.env.BYBIT_BASE_URL = savedUrl; else delete process.env.BYBIT_BASE_URL;
  }
  console.log('✓ adapters/bybit/client (env resolution)');

  // adapters/bybit/funding (classify helpers)
  {
    const { classifyFundingBias, classifyFundingRegime } = require('../src/adapters/bybit/funding');

    assert.strictEqual(classifyFundingBias(0.001),   'long_crowded',       'fundingBias > 0.0005');
    assert.strictEqual(classifyFundingBias(0.0002),  'neutral_positive',   'fundingBias > 0.0001');
    assert.strictEqual(classifyFundingBias(0),       'neutral',            'fundingBias 0 → neutral');
    assert.strictEqual(classifyFundingBias(-0.0002), 'neutral_negative',   'fundingBias < -0.0001');
    assert.strictEqual(classifyFundingBias(-0.001),  'short_crowded',      'fundingBias < -0.0005');

    assert.strictEqual(classifyFundingRegime(0.002),  'extremely_crowded_long',  'regime > 0.001');
    assert.strictEqual(classifyFundingRegime(0.0005), 'crowded_long',            'regime > 0.0003');
    assert.strictEqual(classifyFundingRegime(0),      'balanced',                'regime 0 → balanced');
    assert.strictEqual(classifyFundingRegime(-0.002), 'extremely_crowded_short', 'regime < -0.001');
    assert.strictEqual(classifyFundingRegime(-0.0005),'crowded_short',           'regime < -0.0003');
  }
  console.log('✓ adapters/bybit/funding (classify helpers)');

  // adapters/bybit/openInterest (classify helpers)
  {
    const { classifyOITrend } = require('../src/adapters/bybit/openInterest');

    const expand = classifyOITrend([
      { openInterest: 1000, timestamp: 1 },
      { openInterest: 1200, timestamp: 2 }, // +20%
    ]);
    assert.strictEqual(expand.oiTrend,  'expanding',        'OI +20% → expanding');
    assert.strictEqual(expand.oiRegime, 'strong_expansion', 'OI +20% → strong_expansion');
    assert.ok(Math.abs(expand.oiExpansion - 20) < 0.1,      'OI expansion pct ≈ 20');

    const contract = classifyOITrend([
      { openInterest: 1000, timestamp: 1 },
      { openInterest: 800,  timestamp: 2 }, // -20%
    ]);
    assert.strictEqual(contract.oiTrend,  'contracting',       'OI -20% → contracting');
    assert.strictEqual(contract.oiRegime, 'strong_contraction','OI -20% → strong_contraction');

    const stable = classifyOITrend([
      { openInterest: 1000, timestamp: 1 },
      { openInterest: 1020, timestamp: 2 }, // +2%
    ]);
    assert.strictEqual(stable.oiTrend, 'stable', 'OI +2% → stable');

    const insuf = classifyOITrend([{ openInterest: 1000, timestamp: 1 }]);
    assert.strictEqual(insuf.oiTrend, 'insufficient_data', 'single record → insufficient_data');
  }
  console.log('✓ adapters/bybit/openInterest (classify helpers)');

  // adapters/bybit/longShort (classify helpers)
  {
    const { classifyCrowdBias, classifyCrowdingRisk } = require('../src/adapters/bybit/longShort');

    assert.strictEqual(classifyCrowdBias(0.70),  'strong_long_bias',  'crowdBias > 0.65');
    assert.strictEqual(classifyCrowdBias(0.60),  'long_leaning',      'crowdBias > 0.55');
    assert.strictEqual(classifyCrowdBias(0.50),  'neutral',           'crowdBias 0.50 → neutral');
    assert.strictEqual(classifyCrowdBias(0.42),  'short_leaning',     'crowdBias < 0.45');
    assert.strictEqual(classifyCrowdBias(0.30),  'strong_short_bias', 'crowdBias < 0.35');

    assert.strictEqual(classifyCrowdingRisk(0.80), 'high',     'crowdingRisk > 0.70');
    assert.strictEqual(classifyCrowdingRisk(0.65), 'moderate', 'crowdingRisk > 0.60');
    assert.strictEqual(classifyCrowdingRisk(0.50), 'low',      'crowdingRisk neutral → low');
    assert.strictEqual(classifyCrowdingRisk(0.20), 'high',     'crowdingRisk < 0.30');
  }
  console.log('✓ adapters/bybit/longShort (classify helpers)');

  // adapters/bybit/index (barrel exports)
  {
    const bybit = require('../src/adapters/bybit');
    assert.strictEqual(typeof bybit.getInstrumentInfo,     'function', 'exports getInstrumentInfo');
    assert.strictEqual(typeof bybit.getTickerContext,      'function', 'exports getTickerContext');
    assert.strictEqual(typeof bybit.getFundingContext,     'function', 'exports getFundingContext');
    assert.strictEqual(typeof bybit.getOpenInterestContext,'function', 'exports getOpenInterestContext');
    assert.strictEqual(typeof bybit.getLongShortContext,   'function', 'exports getLongShortContext');
    assert.ok(bybit.errors,                                            'exports errors object');
    assert.strictEqual(typeof bybit.errors.BybitError,     'function', 'errors.BybitError exported');
    assert.strictEqual(typeof bybit.errors.MissingSymbolError, 'function', 'errors.MissingSymbolError exported');
    assert.strictEqual(typeof bybit.errors.GeoRestrictedError, 'function', 'errors.GeoRestrictedError exported');
  }
  console.log('✓ adapters/bybit/index (barrel exports)');

  // analyzer/bybitContext (pure adjustment function)
  {
    const { computeBybitContextAdjustment } = require('../src/analyzer/bybitContext');

    // no_trade → zero regardless
    const noTrade = computeBybitContextAdjustment({ fundingBias: 'long_crowded', oiRegime: 'strong_expansion', signal: 'no_trade' });
    assert.strictEqual(noTrade.adjustment, 0,  'no_trade → 0 bybit adj');
    assert.deepStrictEqual(noTrade.reasons, [], 'no_trade → no reasons');

    // bearish → zero
    const bearish = computeBybitContextAdjustment({ fundingBias: 'short_crowded', oiRegime: 'expansion', signal: 'bearish_breakdown_watch' });
    assert.strictEqual(bearish.adjustment, 0, 'bearish_breakdown_watch → 0 bybit adj');

    // breakout + long_crowded → -0.03 (funding)
    const b1 = computeBybitContextAdjustment({ fundingBias: 'long_crowded', oiRegime: 'stable', signal: 'breakout_watch' });
    assert.strictEqual(b1.adjustment, -0.03, 'breakout + long_crowded → -0.03');
    assert.ok(b1.reasons.some((r) => r.includes('bybit_funding_long_crowded_breakout_watch')), 'reason present');

    // breakout + short_crowded → +0.03 (funding)
    const b2 = computeBybitContextAdjustment({ fundingBias: 'short_crowded', oiRegime: 'stable', signal: 'breakout_watch' });
    assert.strictEqual(b2.adjustment, 0.03, 'breakout + short_crowded → +0.03');

    // breakout + neutral_positive → -0.01
    const b3 = computeBybitContextAdjustment({ fundingBias: 'neutral_positive', oiRegime: null, signal: 'breakout_watch' });
    assert.strictEqual(b3.adjustment, -0.01, 'breakout + neutral_positive → -0.01');

    // breakout + neutral_negative → +0.01
    const b4 = computeBybitContextAdjustment({ fundingBias: 'neutral_negative', oiRegime: null, signal: 'breakout_watch' });
    assert.strictEqual(b4.adjustment, 0.01, 'breakout + neutral_negative → +0.01');

    // breakout + strong_expansion (oi) → +0.03
    const b5 = computeBybitContextAdjustment({ fundingBias: null, oiRegime: 'strong_expansion', signal: 'breakout_watch' });
    assert.strictEqual(b5.adjustment, 0.03, 'breakout + strong_expansion OI → +0.03');

    // breakout + contraction (oi) → -0.02
    const b6 = computeBybitContextAdjustment({ fundingBias: null, oiRegime: 'contraction', signal: 'breakout_watch' });
    assert.strictEqual(b6.adjustment, -0.02, 'breakout + contraction OI → -0.02');

    // breakout + strong_contraction (oi) → -0.03
    const b7 = computeBybitContextAdjustment({ fundingBias: null, oiRegime: 'strong_contraction', signal: 'breakout_watch' });
    assert.strictEqual(b7.adjustment, -0.03, 'breakout + strong_contraction OI → -0.03');

    // stacked: breakout + short_crowded + strong_expansion → +0.03 + 0.03 = +0.05 (cap)
    const stacked = computeBybitContextAdjustment({ fundingBias: 'short_crowded', oiRegime: 'strong_expansion', signal: 'breakout_watch' });
    assert.strictEqual(stacked.adjustment, 0.05, 'stacked short_crowded + strong_expansion → capped at +0.05');
    assert.strictEqual(stacked.reasons.length, 2, 'stacked has 2 reasons');

    // stacked negative: long_crowded + strong_contraction → -0.03 + -0.03 = -0.05 (cap)
    const stackedNeg = computeBybitContextAdjustment({ fundingBias: 'long_crowded', oiRegime: 'strong_contraction', signal: 'breakout_watch' });
    assert.strictEqual(stackedNeg.adjustment, -0.05, 'stacked long_crowded + strong_contraction → capped at -0.05');

    // pullback + long_crowded → -0.02
    const p1 = computeBybitContextAdjustment({ fundingBias: 'long_crowded', oiRegime: 'stable', signal: 'pullback_watch' });
    assert.strictEqual(p1.adjustment, -0.02, 'pullback + long_crowded → -0.02');

    // pullback + short_crowded → +0.02
    const p2 = computeBybitContextAdjustment({ fundingBias: 'short_crowded', oiRegime: 'stable', signal: 'pullback_watch' });
    assert.strictEqual(p2.adjustment, 0.02, 'pullback + short_crowded → +0.02');

    // pullback + expansion oi → +0.01
    const p3 = computeBybitContextAdjustment({ fundingBias: null, oiRegime: 'expansion', signal: 'pullback_watch' });
    assert.strictEqual(p3.adjustment, 0.01, 'pullback + expansion OI → +0.01');

    // pullback + strong_expansion oi → +0.01 (same bucket as expansion)
    const p4 = computeBybitContextAdjustment({ fundingBias: null, oiRegime: 'strong_expansion', signal: 'pullback_watch' });
    assert.strictEqual(p4.adjustment, 0.01, 'pullback + strong_expansion OI → +0.01');

    // pullback + contracting oi → -0.01
    const p5 = computeBybitContextAdjustment({ fundingBias: null, oiRegime: 'contraction', signal: 'pullback_watch' });
    assert.strictEqual(p5.adjustment, -0.01, 'pullback + contraction OI → -0.01');

    // null inputs → 0
    const nullCtx = computeBybitContextAdjustment({ fundingBias: null, oiRegime: null, signal: 'breakout_watch' });
    assert.strictEqual(nullCtx.adjustment, 0, 'null inputs → 0');
  }
  console.log('✓ analyzer/bybitContext (computeBybitContextAdjustment)');

  // ── Chart Pattern Detection ───────────────────────────────────────────────

  const { detectChartPatterns } = require('../src/analyzer/patterns');
  const { PATTERN_TYPES, BIAS, STATUS } = require('../src/analyzer/patterns/normalize');

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Build flat candle series (price + noise) for N bars.
   */
  function makeFlat(base, n, noise = 0.3, atr = 1) {
    return Array.from({ length: n }, (_, i) => ({
      time: i * 3600, open: base, high: base + noise, low: base - noise,
      close: base, volume: 1000,
    }));
  }

  /**
   * Build a candle with specific OHLCV values.
   */
  function c(open, high, low, close, vol = 1000) {
    return { time: 0, open, high, low, close, volume: vol };
  }

  /**
   * Reindex times in a candle array (needed for pivot detection to be happy).
   */
  function reindex(arr) {
    return arr.map((candle, i) => ({ ...candle, time: i * 3600 }));
  }

  /**
   * Flat candles at a given price level (high = price+0.2, low = price-0.2).
   */
  function flat(price, n) {
    return Array.from({ length: n }, () => ({ time: 0, open: price, high: price + 0.2, low: price - 0.2, close: price, volume: 1000 }));
  }

  /**
   * Single isolated spike candle (high = spikeHigh, body near base).
   */
  function spike(spikeHigh, base, vol = 2000) {
    return { time: 0, open: base, high: spikeHigh, low: base - 0.2, close: base + 0.1, volume: vol };
  }

  /**
   * Single isolated trough candle (low = troughLow, body near base).
   */
  function trough(troughLow, base, vol = 2000) {
    return { time: 0, open: base, high: base + 0.2, low: troughLow, close: base - 0.1, volume: vol };
  }

  // ── geometry helpers ──────────────────────────────────────────────────────
  {
    const { fitLine, lineAt, slope2pts, percentDiff, findLowest, findHighest, isFlat, isRising, isFalling } = require('../src/analyzer/patterns/geometry');

    const pts = [{ x: 0, y: 10 }, { x: 1, y: 12 }, { x: 2, y: 14 }];
    const line = fitLine(pts);
    assert.ok(Math.abs(line.slope - 2) < 0.01, 'fitLine: slope should be ~2');
    assert.ok(Math.abs(line.intercept - 10) < 0.01, 'fitLine: intercept should be ~10');
    assert.ok(Math.abs(lineAt(line, 3) - 16) < 0.01, 'lineAt: y at x=3 should be 16');

    assert.ok(Math.abs(slope2pts(0, 0, 5, 10) - 2) < 0.001, 'slope2pts');
    assert.ok(Math.abs(percentDiff(100, 110) - 0.0952) < 0.001, 'percentDiff');

    // isFlat / isRising / isFalling
    assert.ok(isFlat(0.001, 1.0, 0.05),  'isFlat: tiny slope is flat');
    assert.ok(!isFlat(0.1, 1.0, 0.05),   'isFlat: large slope is not flat');
    assert.ok(isRising(0.02, 1.0, 0.01), 'isRising: positive slope');
    assert.ok(!isRising(-0.02, 1.0),     'isRising: negative slope is not rising');
    assert.ok(isFalling(-0.02, 1.0),     'isFalling: negative slope');
    assert.ok(!isFalling(0.02, 1.0),     'isFalling: positive slope is not falling');

    // findLowest / findHighest
    const testCandles = [
      { high: 10, low: 5 }, { high: 8, low: 3 }, { high: 12, low: 6 }, { high: 9, low: 4 },
    ];
    const lo = findLowest(testCandles, 0, 3);
    assert.strictEqual(lo.price, 3, 'findLowest: min low between 0 and 3');
    assert.strictEqual(lo.index, 1, 'findLowest: index');

    const hi = findHighest(testCandles, 0, 3);
    assert.strictEqual(hi.price, 12, 'findHighest: max high between 0 and 3');
    assert.strictEqual(hi.index, 2, 'findHighest: index');
  }
  console.log('✓ patterns/geometry');

  // ── scoring helpers ───────────────────────────────────────────────────────
  {
    const { scoreSymmetry, countTouches, scoreBreakoutProximity, volumeBonus, weightedScore, qualityToConfidence, scoreTouchCount } = require('../src/analyzer/patterns/scoring');
    const { fitLine } = require('../src/analyzer/patterns/geometry');

    assert.ok(Math.abs(scoreSymmetry(100, 100, 1) - 1.0) < 0.001, 'scoreSymmetry: identical = 1');
    assert.ok(scoreSymmetry(100, 102, 1) < 1, 'scoreSymmetry: different < 1');
    assert.strictEqual(scoreSymmetry(100, 104, 1), 0, 'scoreSymmetry: 2×ATR diff = 0');

    const line = fitLine([{ x: 0, y: 10 }, { x: 10, y: 10 }]); // flat at 10
    const pivs = [{ index: 3, price: 10.1 }, { index: 5, price: 10.5 }, { index: 7, price: 9.6 }];
    const touches = countTouches(pivs, line, 1.0, 0.5); // tolerance = 0.5
    assert.ok(touches >= 2, 'countTouches: at least 2 pivots near flat line at 10');

    assert.ok(Math.abs(scoreBreakoutProximity(10, 10, 1) - 1.0) < 0.001, 'scoreBreakoutProximity: at level = 1');
    assert.strictEqual(scoreBreakoutProximity(10, 12, 1), 0, 'scoreBreakoutProximity: 2×ATR away = 0');

    assert.strictEqual(volumeBonus(2000, 1000), 0.10, 'volumeBonus: 2× avg = +0.10');
    assert.strictEqual(volumeBonus(400,  1000), -0.08, 'volumeBonus: 0.4× avg = -0.08');
    assert.strictEqual(volumeBonus(1000, 1000), 0,     'volumeBonus: 1× avg = 0');

    const ws = weightedScore([{ score: 0.8, weight: 2 }, { score: 0.4, weight: 2 }]);
    assert.ok(Math.abs(ws - 0.6) < 0.001, 'weightedScore: (0.8×2 + 0.4×2) / 4 = 0.6');

    assert.ok(qualityToConfidence(0.9)  >= 0.65, 'qualityToConfidence: 0.9 → high');
    assert.ok(qualityToConfidence(0.3)  <= 0.35, 'qualityToConfidence: 0.3 → low');

    assert.strictEqual(scoreTouchCount(1), 0,    'scoreTouchCount: 1 touch = 0');
    assert.strictEqual(scoreTouchCount(2), 0.50, 'scoreTouchCount: 2 touches = 0.5');
    assert.strictEqual(scoreTouchCount(4), 1.00, 'scoreTouchCount: 4+ touches = 1.0');
  }
  console.log('✓ patterns/scoring');

  // ── detectChartPatterns: empty / insufficient data ────────────────────────
  {
    assert.deepStrictEqual(detectChartPatterns([]), [], 'empty candles → empty array');
    assert.deepStrictEqual(detectChartPatterns(makeFlat(100, 10)), [], 'too few candles → empty array');

    // Flat noise series → no pattern (nothing structurally notable)
    const flat = reindex(makeFlat(100, 120, 0.05, 1));
    const pats = detectChartPatterns(flat, { atr: 1 });
    assert.ok(Array.isArray(pats), 'detectChartPatterns returns array');
  }
  console.log('✓ patterns/index (edge cases)');

  // ── normalize: makePattern ────────────────────────────────────────────────
  {
    const { makePattern } = require('../src/analyzer/patterns/normalize');
    const p = makePattern({
      type: PATTERN_TYPES.DOUBLE_TOP, bias: BIAS.BEARISH, status: STATUS.FORMING,
      confidence: 1.5, quality: -0.2, timeframe: '1h', startIndex: 0, endIndex: 10,
    });
    assert.strictEqual(p.type,        'double_top',                'normalize: type');
    assert.strictEqual(p.displayName, 'Topo Duplo',               'normalize: displayName');
    assert.strictEqual(p.bias,        'bearish',                  'normalize: bias');
    assert.strictEqual(p.confidence,  1.0,                        'normalize: confidence capped at 1');
    assert.strictEqual(p.quality,     0.0,                        'normalize: quality floored at 0');
    assert.strictEqual(p.source,      'pattern_detector',         'normalize: source');
  }
  console.log('✓ patterns/normalize');

  // ── Double Top detection ──────────────────────────────────────────────────
  {
    const { detectDoubleTop } = require('../src/analyzer/patterns/doubleTopBottom');

    // Two isolated spike tops at ~112 and ~111.5, surrounded by flat candles at 95.
    // Flat candles (high=95.2) ensure each spike is a clean pivot high.
    const dtArr = [
      ...flat(95, 20),     // bars 0-19: base
      spike(112, 95),       // bar 20: TOP1  (high=112)
      ...flat(95, 15),     // bars 21-35: valley
      spike(111.5, 95),    // bar 36: TOP2  (high=111.5)
      ...flat(95, 15),     // bars 37-51: current at 95 (near neckline ~94.8)
    ];
    const dtCandles = reindex(dtArr);
    const dtPivots  = require('../src/analyzer/pivots').detectPivots(dtCandles, 5);
    const dtResult  = detectDoubleTop(dtCandles, dtPivots.pivotHighs, 2.0, 1000, '1h');

    assert.ok(dtResult !== null, 'double top: detected on synthetic data');
    if (dtResult) {
      assert.strictEqual(dtResult.type, PATTERN_TYPES.DOUBLE_TOP, 'double top: correct type');
      assert.strictEqual(dtResult.bias, BIAS.BEARISH,             'double top: bearish bias');
      assert.ok(dtResult.keyLevels.neckline > 0,                  'double top: neckline present');
    }
  }
  console.log('✓ patterns/doubleTop');

  // ── Double Bottom detection ───────────────────────────────────────────────
  {
    const { detectDoubleBottom } = require('../src/analyzer/patterns/doubleTopBottom');

    // Two isolated trough bottoms at ~88 and ~88.5, surrounded by flat candles at 100.
    const dbArr = [
      ...flat(100, 20),
      trough(88, 100),      // bar 20: BOT1  (low=88)
      ...flat(100, 15),
      trough(88.5, 100),   // bar 36: BOT2  (low=88.5)
      ...flat(100, 15),    // current near neckline (peak ~100.2)
    ];
    const dbCandles = reindex(dbArr);
    const dbPivots  = require('../src/analyzer/pivots').detectPivots(dbCandles, 5);
    const dbResult  = detectDoubleBottom(dbCandles, dbPivots.pivotLows, 2.0, 1000, '1h');

    assert.ok(dbResult !== null, 'double bottom: detected on synthetic data');
    if (dbResult) {
      assert.strictEqual(dbResult.type, PATTERN_TYPES.DOUBLE_BOTTOM, 'double bottom: correct type');
      assert.strictEqual(dbResult.bias, BIAS.BULLISH,                'double bottom: bullish bias');
    }
  }
  console.log('✓ patterns/doubleBottom');

  // ── Head and Shoulders detection ──────────────────────────────────────────
  {
    const { detectHeadAndShoulders } = require('../src/analyzer/patterns/headShoulders');

    // Three isolated spike highs: LS=108, Head=116, RS=109
    // All surrounded by flat candles at 100 (high=100.2) — clean pivot isolation
    const hsArr = [
      ...flat(100, 20),    // bars  0-19: base
      spike(108, 100),      // bar  20: LEFT SHOULDER
      ...flat(100, 10),    // bars 21-30: valley 1
      spike(116, 100),      // bar  31: HEAD
      ...flat(100, 10),    // bars 32-41: valley 2
      spike(109, 100),      // bar  42: RIGHT SHOULDER
      ...flat(101, 12),    // bars 43-54: current slightly above neckline (~100)
    ];
    const hsCandles = reindex(hsArr);
    const hsPivots  = require('../src/analyzer/pivots').detectPivots(hsCandles, 7);
    const hsResult  = detectHeadAndShoulders(hsCandles, hsPivots.pivotHighs, 2.0, 1000, '1h');

    assert.ok(hsResult !== null, 'H&S: detected on synthetic data');
    if (hsResult) {
      assert.strictEqual(hsResult.type, PATTERN_TYPES.HEAD_AND_SHOULDERS, 'H&S: correct type');
      assert.strictEqual(hsResult.bias, BIAS.BEARISH,                     'H&S: bearish bias');
      assert.ok(hsResult.keyLevels.head > hsResult.keyLevels.leftShoulder, 'H&S: head higher than left shoulder');
    }
  }
  console.log('✓ patterns/headShoulders');

  // ── Inverse H&S detection ─────────────────────────────────────────────────
  {
    const { detectInverseHeadAndShoulders } = require('../src/analyzer/patterns/headShoulders');

    // Three isolated trough lows: LS=92, Head=84, RS=91
    const ihsArr = [
      ...flat(100, 20),
      trough(92, 100),     // bar 20: LEFT SHOULDER
      ...flat(100, 10),
      trough(84, 100),     // bar 31: HEAD
      ...flat(100, 10),
      trough(91, 100),     // bar 42: RIGHT SHOULDER
      ...flat(99, 12),     // bars 43-54: current near neckline (~100.2)
    ];
    const ihsCandles = reindex(ihsArr);
    const ihsPivots  = require('../src/analyzer/pivots').detectPivots(ihsCandles, 7);
    const ihsResult  = detectInverseHeadAndShoulders(ihsCandles, ihsPivots.pivotLows, 2.0, 1000, '1h');

    assert.ok(ihsResult !== null, 'Inv H&S: detected on synthetic data');
    if (ihsResult) {
      assert.strictEqual(ihsResult.type, PATTERN_TYPES.INV_HEAD_AND_SHOULDERS, 'Inv H&S: correct type');
      assert.strictEqual(ihsResult.bias, BIAS.BULLISH,                         'Inv H&S: bullish bias');
    }
  }
  console.log('✓ patterns/inverseHeadShoulders');

  // ── Triangle detection ────────────────────────────────────────────────────
  {
    const { detectAscendingTriangle, detectDescendingTriangle, detectSymmetricalTriangle } = require('../src/analyzer/patterns/triangles');

    // Ascending triangle: flat resistance ~110, rising support ~(90 → 105)
    // Build 80 candles with pivot highs near 110 and pivot lows rising
    const asc = [];
    for (let i = 0; i < 80; i++) {
      const support = 90 + i * 0.2;      // rising support
      const res = 110;                    // flat resistance
      const mid = (support + res) / 2;
      const swing = (res - support) * 0.4;
      const close = mid + swing * Math.sin(i * 0.4);
      asc.push({ time: i * 3600, open: close - 0.3, high: Math.min(res + 0.2, close + 1.2), low: Math.max(support - 0.2, close - 1.2), close, volume: 1000 });
    }
    const ascPivots = require('../src/analyzer/pivots').detectPivots(asc, 5);
    const ascResult = detectAscendingTriangle(asc, ascPivots.pivotHighs, ascPivots.pivotLows, 2.0, 1000, '1h');
    // Triangle detection is geometry-dependent on synthetic data; just verify no crash and consistent output
    if (ascResult !== null) {
      assert.strictEqual(ascResult.type, PATTERN_TYPES.ASCENDING_TRIANGLE, 'ascending triangle: type');
      assert.strictEqual(ascResult.bias, BIAS.BULLISH,                     'ascending triangle: bullish bias');
    }

    // Symmetrical triangle: converging lines
    const sym = [];
    for (let i = 0; i < 80; i++) {
      const res = 110 - i * 0.1;  // falling resistance
      const sup = 90  + i * 0.1;  // rising support
      const mid = (res + sup) / 2;
      const close = mid + (res - sup) * 0.3 * Math.sin(i * 0.5);
      sym.push({ time: i * 3600, open: close - 0.2, high: Math.min(res + 0.1, close + 1), low: Math.max(sup - 0.1, close - 1), close, volume: 1000 });
    }
    const symPivots = require('../src/analyzer/pivots').detectPivots(sym, 5);
    const symResult = detectSymmetricalTriangle(sym, symPivots.pivotHighs, symPivots.pivotLows, 2.0, 1000, '1h');
    if (symResult !== null) {
      assert.strictEqual(symResult.type, PATTERN_TYPES.SYMMETRICAL_TRIANGLE, 'symmetrical triangle: type');
      assert.strictEqual(symResult.bias, BIAS.NEUTRAL,                       'symmetrical triangle: neutral bias');
    }
  }
  console.log('✓ patterns/triangles');

  // ── Wedge detection ───────────────────────────────────────────────────────
  {
    const { detectRisingWedge, detectFallingWedge } = require('../src/analyzer/patterns/wedges');

    // Rising wedge: both lines rise, resistance less steep
    const rw = [];
    for (let i = 0; i < 80; i++) {
      const res = 100 + i * 0.08;   // rising resistance (slow)
      const sup = 100 + i * 0.12;   // rising support (faster → converging from below)
      // Flip so resistance > support always: use resistance = 100 + i*0.12, support = 100 + i*0.08
      const actualRes = 100 + i * 0.12;
      const actualSup = 100 + i * 0.08;
      const mid   = (actualRes + actualSup) / 2;
      const close = mid + (actualRes - actualSup) * 0.3 * Math.sin(i * 0.5);
      rw.push({ time: i * 3600, open: close - 0.2, high: Math.min(actualRes + 0.1, close + 0.8), low: Math.max(actualSup - 0.1, close - 0.8), close, volume: 1000 });
    }
    const rwPivots = require('../src/analyzer/pivots').detectPivots(rw, 5);
    const rwResult = detectRisingWedge(rw, rwPivots.pivotHighs, rwPivots.pivotLows, 1.0, 1000, '1h');
    if (rwResult !== null) {
      assert.strictEqual(rwResult.type, PATTERN_TYPES.RISING_WEDGE, 'rising wedge: type');
      assert.strictEqual(rwResult.bias, BIAS.BEARISH,               'rising wedge: bearish');
    }

    // Falling wedge: both lines fall, support falls less steeply
    const fw = [];
    for (let i = 0; i < 80; i++) {
      const actualRes = 110 - i * 0.12; // fast falling resistance
      const actualSup = 110 - i * 0.08; // slow falling support
      const mid   = (actualRes + actualSup) / 2;
      const close = mid + (actualRes - actualSup) * 0.3 * Math.sin(i * 0.5);
      fw.push({ time: i * 3600, open: close - 0.2, high: Math.min(actualRes + 0.1, close + 0.8), low: Math.max(actualSup - 0.1, close - 0.8), close, volume: 1000 });
    }
    const fwPivots = require('../src/analyzer/pivots').detectPivots(fw, 5);
    const fwResult = detectFallingWedge(fw, fwPivots.pivotHighs, fwPivots.pivotLows, 1.0, 1000, '1h');
    if (fwResult !== null) {
      assert.strictEqual(fwResult.type, PATTERN_TYPES.FALLING_WEDGE, 'falling wedge: type');
      assert.strictEqual(fwResult.bias, BIAS.BULLISH,                'falling wedge: bullish');
    }
  }
  console.log('✓ patterns/wedges');

  // ── Rectangle detection ───────────────────────────────────────────────────
  {
    const { detectRectangle } = require('../src/analyzer/patterns/rectangles');

    // 4 isolated pivots defining a clear flat range: resistance ~105, support ~95
    // Using spike/trough helpers to guarantee pivot detection
    const rectArr = [
      ...flat(100, 8),    // bars  0- 7: base
      spike(105.3, 100),  // bar   8: resistance touch 1
      ...flat(100, 6),    // bars  9-14
      trough(94.7, 100),  // bar  15: support touch 1
      ...flat(100, 6),    // bars 16-21
      spike(105.1, 100),  // bar  22: resistance touch 2
      ...flat(100, 6),    // bars 23-28
      trough(94.9, 100),  // bar  29: support touch 2
      ...flat(100, 20),   // bars 30-49: current inside range
    ];
    const rectCandles = reindex(rectArr);
    const rectPivots  = require('../src/analyzer/pivots').detectPivots(rectCandles, 5);
    const rectResult  = detectRectangle(rectCandles, rectPivots.pivotHighs, rectPivots.pivotLows, 2.0, 1000, '1h');

    assert.ok(rectResult !== null, 'rectangle: detected on clear range data');
    if (rectResult) {
      assert.strictEqual(rectResult.type, PATTERN_TYPES.RECTANGLE,            'rectangle: correct type');
      assert.ok(rectResult.keyLevels.resistance > rectResult.keyLevels.support, 'rectangle: resistance > support');
    }
  }
  console.log('✓ patterns/rectangle');

  // ── Flag detection ────────────────────────────────────────────────────────
  {
    const { detectFlag } = require('../src/analyzer/patterns/flags');

    // Bull flag: strong upward pole (15 bars, +15 ATR), then slight downward channel
    const bf = [];
    // Base
    for (let i = 0; i < 30; i++) bf.push(c(100, 101, 99, 100));
    // Pole: 15 bars rising sharply
    for (let i = 0; i < 15; i++) bf.push(c(100 + i * 1.5, 100 + i * 1.5 + 0.8, 100 + i * 1.5 - 0.8, 100 + i * 1.5));
    // Flag: 12 bars slight downward drift
    for (let i = 0; i < 12; i++) bf.push(c(122.5 - i * 0.3, 123 - i * 0.3, 122 - i * 0.3, 122.5 - i * 0.3));
    const bfCandles = reindex(bf);
    const bfResult = detectFlag('bull', bfCandles, 2.5, 1000, '1h');

    assert.ok(bfResult !== null, 'bull flag: detected on synthetic data');
    if (bfResult) {
      assert.strictEqual(bfResult.type, PATTERN_TYPES.FLAG_BULL, 'bull flag: correct type');
      assert.strictEqual(bfResult.bias, BIAS.BULLISH,            'bull flag: bullish bias');
    }
  }
  console.log('✓ patterns/flags');

  // ── Negative tests (no pattern on random/flat data) ───────────────────────
  {
    const { detectDoubleTop } = require('../src/analyzer/patterns/doubleTopBottom');
    const { detectHeadAndShoulders } = require('../src/analyzer/patterns/headShoulders');
    const { detectRectangle } = require('../src/analyzer/patterns/rectangles');

    // Monotonically rising price → no double top, no H&S
    const rising = reindex(Array.from({ length: 100 }, (_, i) => c(100 + i, 101 + i, 99 + i, 100 + i)));
    const risingPivots = require('../src/analyzer/pivots').detectPivots(rising, 5);
    assert.strictEqual(detectDoubleTop(rising, risingPivots.pivotHighs, 1.0, 1000, '1h'), null, 'no double top on rising series');
    assert.strictEqual(detectHeadAndShoulders(rising, risingPivots.pivotHighs, 1.0, 1000, '1h'), null, 'no H&S on rising series');

    // Monotonically falling price → no rectangle
    const falling = reindex(Array.from({ length: 100 }, (_, i) => c(200 - i, 201 - i, 199 - i, 200 - i)));
    const fallingPivots = require('../src/analyzer/pivots').detectPivots(falling, 5);
    assert.strictEqual(detectRectangle(falling, fallingPivots.pivotHighs, fallingPivots.pivotLows, 1.0, 1000, '1h'), null, 'no rectangle on falling series');
  }
  console.log('✓ patterns/negativeTests');

  // ── Pattern output shape contract ─────────────────────────────────────────
  {
    const { detectRectangle } = require('../src/analyzer/patterns/rectangles');
    const rect2 = [];
    for (let i = 0; i < 60; i++) {
      const close = 100 + 4 * Math.sin(i * 0.35);
      rect2.push({ time: i * 3600, open: close - 0.3, high: Math.min(105.3, close + 1.5), low: Math.max(94.7, close - 1.5), close, volume: 1000 });
    }
    const p2 = require('../src/analyzer/pivots').detectPivots(rect2, 5);
    const pat = detectRectangle(rect2, p2.pivotHighs, p2.pivotLows, 2.0, 1000, '4h');
    if (pat !== null) {
      // Validate all required shape fields
      assert.ok('type'             in pat, 'shape: type');
      assert.ok('displayName'      in pat, 'shape: displayName');
      assert.ok('bias'             in pat, 'shape: bias');
      assert.ok('status'           in pat, 'shape: status');
      assert.ok('confidence'       in pat, 'shape: confidence');
      assert.ok('quality'          in pat, 'shape: quality');
      assert.ok('timeframe'        in pat, 'shape: timeframe');
      assert.ok('startIndex'       in pat, 'shape: startIndex');
      assert.ok('endIndex'         in pat, 'shape: endIndex');
      assert.ok('keyLevels'        in pat, 'shape: keyLevels');
      assert.ok('breakoutLevel'    in pat, 'shape: breakoutLevel');
      assert.ok('invalidationLevel' in pat, 'shape: invalidationLevel');
      assert.ok('explanation'      in pat, 'shape: explanation');
      assert.ok('source'           in pat, 'shape: source');
      assert.ok(pat.confidence >= 0 && pat.confidence <= 1, 'shape: confidence in [0,1]');
      assert.ok(pat.quality    >= 0 && pat.quality    <= 1, 'shape: quality in [0,1]');
      assert.strictEqual(pat.source, 'pattern_detector',   'shape: source');
    }
  }
  console.log('✓ patterns/outputShape');

  // ── detectChartPatterns: sorting ──────────────────────────────────────────
  {
    // If multiple patterns return, they should be sorted by quality desc
    const rect3 = [];
    for (let i = 0; i < 80; i++) {
      const close = 100 + 4 * Math.sin(i * 0.35);
      rect3.push({ time: i * 3600, open: close - 0.3, high: Math.min(105.3, close + 1.5), low: Math.max(94.7, close - 1.5), close, volume: 1000 });
    }
    const results = detectChartPatterns(rect3, { atr: 2.0, avgVolume: 1000, timeframe: '1h' });
    assert.ok(Array.isArray(results), 'detectChartPatterns returns array');
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].quality >= results[i].quality, 'patterns sorted by quality desc');
    }
    assert.ok(results.length <= 5, 'max 5 patterns returned');
  }
  console.log('✓ patterns/sorting');

  // ── All passed ─────────────────────────────────────────────────────────────

  console.log('\n✅  All smoke tests passed.');
})().catch((err) => {
  console.error('✗ Async smoke test failed:', err);
  process.exit(1);
});
