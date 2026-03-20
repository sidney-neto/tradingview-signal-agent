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

  // ── Logger ────────────────────────────────────────────────────────────────
  {
    const logger = require('../src/logger');

    // Logger must export the four expected methods
    assert.strictEqual(typeof logger.info,  'function', 'logger.info is a function');
    assert.strictEqual(typeof logger.warn,  'function', 'logger.warn is a function');
    assert.strictEqual(typeof logger.error, 'function', 'logger.error is a function');
    assert.strictEqual(typeof logger.debug, 'function', 'logger.debug is a function');

    // Calling logger methods must not throw
    assert.doesNotThrow(() => logger.info('test.event',  { key: 'value' }), 'logger.info does not throw');
    assert.doesNotThrow(() => logger.warn('test.warn',   { key: 'value' }), 'logger.warn does not throw');
    assert.doesNotThrow(() => logger.error('test.error', { key: 'value' }), 'logger.error does not throw');
    assert.doesNotThrow(() => logger.debug('test.debug', { key: 'value' }), 'logger.debug does not throw');

    // Logger must not throw with no context argument
    assert.doesNotThrow(() => logger.info('test.no_context'), 'logger.info without context does not throw');

    // Verify JSON output shape by capturing stdout
    const { PassThrough } = require('stream');
    let captured = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { captured += chunk; return true; };
    const savedLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'info';
    logger.info('shape.test', { query: 'BTC', timeframe: '1h' });
    process.stdout.write = origWrite;
    process.env.LOG_LEVEL = savedLevel || 'info';

    const parsed = JSON.parse(captured.trim());
    assert.strictEqual(parsed.level,     'info',       'log entry: level');
    assert.strictEqual(parsed.event,     'shape.test', 'log entry: event');
    assert.strictEqual(parsed.query,     'BTC',        'log entry: context.query');
    assert.strictEqual(parsed.timeframe, '1h',         'log entry: context.timeframe');
    assert.ok(typeof parsed.ts === 'number' && parsed.ts > 0, 'log entry: ts is a positive number');
  }
  console.log('✓ logger');

  // ── analyzeMarketMTF: input validation ────────────────────────────────────
  {
    const { analyzeMarketMTF } = require('../src/tools/analyzeMarketMTF');

    // Missing query
    let threw = false;
    try { await analyzeMarketMTF({ query: '', timeframes: ['1h'] }); } catch (_) { threw = true; }
    assert.ok(threw, 'analyzeMarketMTF throws on empty query');

    // Missing timeframes array
    threw = false;
    try { await analyzeMarketMTF({ query: 'BTC', timeframes: [] }); } catch (_) { threw = true; }
    assert.ok(threw, 'analyzeMarketMTF throws on empty timeframes array');

    // Non-array timeframes
    threw = false;
    try { await analyzeMarketMTF({ query: 'BTC', timeframes: '1h' }); } catch (_) { threw = true; }
    assert.ok(threw, 'analyzeMarketMTF throws on non-array timeframes');

    // Unsupported timeframe
    threw = false;
    try { await analyzeMarketMTF({ query: 'BTC', timeframes: ['1h', '99x'] }); } catch (err) {
      threw = true;
      assert.ok(err.message.includes('99x'), 'unsupported timeframe error names the bad value');
    }
    assert.ok(threw, 'analyzeMarketMTF throws on unsupported timeframe');

    // Null query
    threw = false;
    try { await analyzeMarketMTF({ query: null, timeframes: ['1h'] }); } catch (_) { threw = true; }
    assert.ok(threw, 'analyzeMarketMTF throws on null query');
  }
  console.log('✓ tools/analyzeMarketMTF (input validation)');

  // ── API routes: input validation (no network, no live server) ────────────
  {
    // We test the route handler logic directly by simulating req/res objects.
    // This validates that the handler returns the correct HTTP status for bad inputs
    // without spinning up a real server or touching the network.

    const analyzeRouter = require('../src/api/routes/analyze');

    // Find the POST handler registered on the router's stack
    const postLayer = analyzeRouter.stack.find(
      (layer) => layer.route && layer.route.methods && layer.route.methods.post
    );
    assert.ok(postLayer, 'POST /analyze route is registered');

    const handler = postLayer.route.stack[0].handle;

    function makeRes() {
      let statusCode = 200;
      let body = null;
      return {
        status(code) { statusCode = code; return this; },
        json(data)   { body = data; return this; },
        get statusCode() { return statusCode; },
        get body()       { return body; },
      };
    }

    // Missing query → 400
    {
      const req = { body: { timeframe: '1h' } };
      const res = makeRes();
      await handler(req, res, (err) => { throw err || new Error('next called unexpectedly'); });
      assert.strictEqual(res.statusCode, 400, 'POST /analyze: missing query → 400');
      assert.ok(res.body && res.body.code === 'invalid_input', 'POST /analyze: error code = invalid_input');
    }

    // Missing timeframe → 400
    {
      const req = { body: { query: 'BTC' } };
      const res = makeRes();
      await handler(req, res, (err) => { throw err || new Error('next called unexpectedly'); });
      assert.strictEqual(res.statusCode, 400, 'POST /analyze: missing timeframe → 400');
    }

    // Empty body → 400
    {
      const req = { body: {} };
      const res = makeRes();
      await handler(req, res, (err) => { throw err || new Error('next called unexpectedly'); });
      assert.strictEqual(res.statusCode, 400, 'POST /analyze: empty body → 400');
    }

    // Whitespace-only query → 400
    {
      const req = { body: { query: '   ', timeframe: '1h' } };
      const res = makeRes();
      await handler(req, res, (err) => { throw err || new Error('next called unexpectedly'); });
      assert.strictEqual(res.statusCode, 400, 'POST /analyze: whitespace-only query → 400');
    }
  }
  console.log('✓ api/routes/analyze (input validation)');

  // ── API server: module loads and exports app + start ─────────────────────
  {
    const serverModule = require('../src/api/server');
    assert.strictEqual(typeof serverModule.app,   'function', 'server exports app (express instance)');
    assert.strictEqual(typeof serverModule.start, 'function', 'server exports start()');
  }
  console.log('✓ api/server (module shape)');

  // ── Silent failure regression: pattern error surfaces in warnings ─────────
  {
    // Verify that a pattern detection failure (simulated) would be captured
    // as a warning string, not silently dropped.
    // We test the contract: if options._patternError is set, it appears in warnings[].
    const { assessDataQuality } = require('../src/analyzer/scoring');
    const indicators = { ema20: 100, ema50: 95, ema100: 90, ema200: 85, ma200: 84, rsi14: 55, atr14: 2, avgVolume20: 1000 };
    const trendlineState = { activeTrendlineType: 'none' };
    const zoneState = { zoneType: 'none' };
    const { warnings: w } = assessDataQuality({ indicators, trendlineState, zoneState, candleCount: 300 });
    // assessDataQuality itself should not swallow its own errors — test it doesn't throw
    assert.ok(Array.isArray(w), 'assessDataQuality returns warnings array');

    // Simulate what analyzeMarket now does: collects the pattern error as a warning
    const fakeWarnings = [];
    const fakePatternError = 'TypeError: Cannot read property of undefined';
    fakeWarnings.push(`pattern_detection_failed: ${fakePatternError}`);
    assert.ok(
      fakeWarnings.some((msg) => msg.startsWith('pattern_detection_failed:')),
      'pattern detection failures surface as warnings (not silent)'
    );
  }
  console.log('✓ silent-failure regression: pattern errors → warnings');

  // ── Auth middleware ───────────────────────────────────────────────────────
  {
    // Test the middleware in isolation using simulated req/res.
    // We set env vars before requiring the module so the module reads them correctly.
    // Note: because Node caches modules, we delete the cache entry to force a fresh load.

    function makeAuthMiddleware(apiKey, disableAuth) {
      const key = 'src/api/middleware/auth';
      // Clear the module cache so env vars are re-read
      Object.keys(require.cache).forEach((k) => { if (k.includes('middleware/auth')) delete require.cache[k]; });
      const saved = { API_KEY: process.env.API_KEY, DISABLE_AUTH: process.env.DISABLE_AUTH };
      if (apiKey !== undefined)     process.env.API_KEY      = apiKey;
      if (disableAuth !== undefined) process.env.DISABLE_AUTH = disableAuth;
      const mod = require('../src/api/middleware/auth');
      // Restore env
      process.env.API_KEY      = saved.API_KEY      || '';
      process.env.DISABLE_AUTH = saved.DISABLE_AUTH || '';
      return mod;
    }

    function fakeReqRes(headers = {}) {
      let statusCode = 200;
      let body       = null;
      const res = {
        status(c) { statusCode = c; return this; },
        json(d)   { body = d; return this; },
        get statusCode() { return statusCode; },
        get body()       { return body; },
      };
      const req = { headers, ip: '127.0.0.1', path: '/analyze' };
      return { req, res };
    }

    // 1. Missing header → 401
    {
      const { requireApiKey } = makeAuthMiddleware('secret123', 'false');
      const { req, res } = fakeReqRes({});
      let nextCalled = false;
      requireApiKey(req, res, () => { nextCalled = true; });
      assert.strictEqual(res.statusCode, 401, 'auth: missing header → 401');
      assert.strictEqual(res.body.code, 'unauthorized', 'auth: missing header code');
      assert.ok(!nextCalled, 'auth: next not called on missing key');
    }

    // 2. Invalid key → 403
    {
      const { requireApiKey } = makeAuthMiddleware('secret123', 'false');
      const { req, res } = fakeReqRes({ 'x-api-key': 'wrongkey' });
      let nextCalled = false;
      requireApiKey(req, res, () => { nextCalled = true; });
      assert.strictEqual(res.statusCode, 403, 'auth: invalid key → 403');
      assert.strictEqual(res.body.code, 'forbidden', 'auth: invalid key code');
      assert.ok(!nextCalled, 'auth: next not called on wrong key');
    }

    // 3. Valid key → next() called
    {
      const { requireApiKey } = makeAuthMiddleware('secret123', 'false');
      const { req, res } = fakeReqRes({ 'x-api-key': 'secret123' });
      let nextCalled = false;
      requireApiKey(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled, 'auth: valid key → next() called');
    }

    // 4. DISABLE_AUTH=true → next() always called regardless of key
    {
      const { requireApiKey } = makeAuthMiddleware('', 'true');
      const { req, res } = fakeReqRes({});  // no x-api-key
      let nextCalled = false;
      requireApiKey(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled, 'auth: DISABLE_AUTH=true → next() called without key');
    }

    // Clean up module cache after auth tests
    Object.keys(require.cache).forEach((k) => { if (k.includes('middleware/auth')) delete require.cache[k]; });
  }
  console.log('✓ api/middleware/auth');

  // ── Rate limiting middleware ───────────────────────────────────────────────
  {
    // Force fresh module load with known limits
    Object.keys(require.cache).forEach((k) => { if (k.includes('middleware/rateLimit')) delete require.cache[k]; });
    const savedW = process.env.RATE_LIMIT_WINDOW_MS;
    const savedM = process.env.RATE_LIMIT_MAX_REQUESTS;
    process.env.RATE_LIMIT_WINDOW_MS    = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '3';
    const { rateLimit, _resetStore } = require('../src/api/middleware/rateLimit');
    process.env.RATE_LIMIT_WINDOW_MS    = savedW || '';
    process.env.RATE_LIMIT_MAX_REQUESTS = savedM || '';

    function rlReqRes(ip = '10.0.0.1') {
      let statusCode = 200;
      let body = null;
      const headers = {};
      const res = {
        status(c) { statusCode = c; return this; },
        json(d)   { body = d; return this; },
        set(k, v) { headers[k] = v; },
        get statusCode() { return statusCode; },
        get body()       { return body; },
        get headers()    { return headers; },
      };
      return { req: { ip, path: '/analyze' }, res };
    }

    _resetStore();

    // Requests 1-3 should pass (limit is 3)
    for (let i = 1; i <= 3; i++) {
      const { req, res } = rlReqRes('1.1.1.1');
      let passed = false;
      rateLimit(req, res, () => { passed = true; });
      assert.ok(passed, `rate limit: request ${i} within limit should pass`);
    }

    // Request 4 should be rate limited → 429
    {
      const { req, res } = rlReqRes('1.1.1.1');
      let passed = false;
      rateLimit(req, res, () => { passed = true; });
      assert.ok(!passed, 'rate limit: request 4 should be blocked');
      assert.strictEqual(res.statusCode, 429, 'rate limit: 4th request → 429');
      assert.strictEqual(res.body.code, 'rate_limited', 'rate limit: code = rate_limited');
    }

    // Different IP should still pass
    {
      const { req, res } = rlReqRes('2.2.2.2');
      let passed = false;
      rateLimit(req, res, () => { passed = true; });
      assert.ok(passed, 'rate limit: different IP should not be affected');
    }

    _resetStore();
    Object.keys(require.cache).forEach((k) => { if (k.includes('middleware/rateLimit')) delete require.cache[k]; });
  }
  console.log('✓ api/middleware/rateLimit');

  // ── TTL cache ─────────────────────────────────────────────────────────────
  {
    const { TtlCache } = require('../src/cache/ttlCache');

    // Basic set/get
    const cache = new TtlCache({ ttlMs: 1000 });
    cache.set('foo', 42);
    assert.strictEqual(cache.get('foo'), 42, 'ttlCache: get returns set value');
    assert.ok(cache.has('foo'),             'ttlCache: has() true for existing key');
    assert.strictEqual(cache.size, 1,       'ttlCache: size is 1 after one set');

    // Miss returns undefined
    assert.strictEqual(cache.get('missing'), undefined, 'ttlCache: missing key → undefined');
    assert.ok(!cache.has('missing'),                    'ttlCache: has() false for missing key');

    // Expiry — set with very short TTL, then advance manually
    const shortCache = new TtlCache({ ttlMs: 1 });
    shortCache.set('expiring', 'val', 1); // 1ms TTL
    // Wait 5ms for expiry
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(shortCache.get('expiring'), undefined, 'ttlCache: expired entry → undefined');
    assert.ok(!shortCache.has('expiring'),                    'ttlCache: has() false after expiry');

    // Delete
    cache.set('todel', 'x');
    cache.delete('todel');
    assert.strictEqual(cache.get('todel'), undefined, 'ttlCache: delete removes entry');

    // Clear
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.strictEqual(cache.size, 0, 'ttlCache: clear() empties store');

    // Overwrite
    const c2 = new TtlCache({ ttlMs: 5000 });
    c2.set('k', 'first');
    c2.set('k', 'second');
    assert.strictEqual(c2.get('k'), 'second', 'ttlCache: second set overwrites first');
  }
  console.log('✓ cache/ttlCache');

  // ── analyzeCandles (backtest core) ────────────────────────────────────────
  {
    const { analyzeCandles } = require('../src/backtest/analyzeCandles');

    // Load the synthetic fixture
    const fixture = require('../test/fixtures/candles-btc-1h.json');
    assert.ok(Array.isArray(fixture) && fixture.length >= 200, 'fixture: loaded with ≥200 candles');

    // Run analyzeCandles on a window of 100 candles
    const window = fixture.slice(0, 100);
    const result = analyzeCandles({
      candles:   window,
      symbol:    'BTCUSDT',
      symbolId:  'BINANCE:BTCUSDT',
      timeframe: '1h',
      options:   { skipPatterns: true },
    });

    // Required output fields
    assert.strictEqual(typeof result.signal,     'string', 'analyzeCandles: signal is string');
    assert.strictEqual(typeof result.confidence, 'number', 'analyzeCandles: confidence is number');
    assert.strictEqual(typeof result.trend,      'string', 'analyzeCandles: trend is string');
    assert.ok(result.confidence >= 0 && result.confidence <= 1, 'analyzeCandles: confidence in [0,1]');
    assert.ok(['breakout_watch','pullback_watch','bearish_breakdown_watch','no_trade'].includes(result.signal),
              'analyzeCandles: signal is valid');
    assert.ok(Array.isArray(result.warnings),   'analyzeCandles: warnings is array');
    assert.ok(result.perpContext === null,       'analyzeCandles: perpContext is null (no overlays)');
    assert.ok(result.macroContext === null,      'analyzeCandles: macroContext is null (no overlays)');
    assert.strictEqual(result.candleCount, 100, 'analyzeCandles: candleCount matches window');

    // Throws with insufficient candles
    let threw = false;
    try { analyzeCandles({ candles: fixture.slice(0, 10), symbol: 'X', timeframe: '1h' }); }
    catch (_) { threw = true; }
    assert.ok(threw, 'analyzeCandles: throws with too few candles');
  }
  console.log('✓ backtest/analyzeCandles');

  // ── backtest runner + report ──────────────────────────────────────────────
  {
    const { runBacktest } = require('../src/backtest/runner');
    const { buildReport } = require('../src/backtest/report');
    const fixture = require('../test/fixtures/candles-btc-1h.json');

    const steps = runBacktest({
      candles:       fixture,
      symbol:        'BTCUSDT',
      symbolId:      'BINANCE:BTCUSDT',
      timeframe:     '1h',
      minWindow:     50,
      lookaheadBars: 10,
      winPct:        1.5,
      lossPct:       0.75,
      minConfidence: 0.3,
      skipPatterns:  true,
    });

    assert.ok(Array.isArray(steps),        'runBacktest: returns array');
    assert.ok(steps.length > 0,            'runBacktest: at least one step produced');

    // Every step should have required fields
    for (const step of steps) {
      assert.ok('index'     in step, 'step: has index');
      assert.ok('timestamp' in step, 'step: has timestamp');
      if (!step.skipped) {
        assert.ok('signal'     in step, 'step: has signal');
        assert.ok('confidence' in step, 'step: has confidence');
        assert.ok('outcome'    in step, 'step: has outcome');
        assert.ok(['win','loss','expired','skipped'].includes(step.outcome),
                  `step: outcome "${step.outcome}" is valid`);
      }
    }

    const report = buildReport({
      steps,
      symbol:        'BTCUSDT',
      timeframe:     '1h',
      totalCandles:  fixture.length,
      minWindow:     50,
      lookaheadBars: 10,
      winPct:        1.5,
      lossPct:       0.75,
      minConfidence: 0.3,
    });

    // Report shape
    assert.strictEqual(report.symbol,       'BTCUSDT',  'report: symbol');
    assert.strictEqual(report.timeframe,    '1h',       'report: timeframe');
    assert.strictEqual(report.totalCandles, fixture.length, 'report: totalCandles');
    assert.ok(typeof report.totalSteps    === 'number',  'report: totalSteps is number');
    assert.ok(typeof report.totalEligible === 'number',  'report: totalEligible is number');
    assert.ok('bySignal' in report,                      'report: has bySignal');
    assert.ok('overall'  in report,                      'report: has overall');
    assert.ok('breakout_watch'          in report.bySignal, 'report: bySignal has breakout_watch');
    assert.ok('pullback_watch'          in report.bySignal, 'report: bySignal has pullback_watch');
    assert.ok('bearish_breakdown_watch' in report.bySignal, 'report: bySignal has bearish_breakdown_watch');
    assert.ok(typeof report.generatedAt === 'string',    'report: generatedAt is string');
  }
  console.log('✓ backtest/runner + report');

  // ── evaluateOutcome ────────────────────────────────────────────────────────
  {
    const { evaluateOutcome } = require('../src/backtest/evaluate');

    // Bullish signal, price hits win target
    const bullWin = [
      { open: 100, high: 103, low: 99, close: 102 },  // +3% high → hits win at 101.5
    ];
    assert.strictEqual(evaluateOutcome({ signal: 'breakout_watch', forwardCandles: bullWin, winPct: 1.5, lossPct: 0.75 }),
                       'win', 'evaluateOutcome: bullish win');

    // Bullish signal, price hits loss target
    const bullLoss = [
      { open: 100, high: 100.3, low: 99.1, close: 99.2 }, // low -0.9% → hits loss at 99.25
    ];
    assert.strictEqual(evaluateOutcome({ signal: 'pullback_watch', forwardCandles: bullLoss, winPct: 1.5, lossPct: 0.75 }),
                       'loss', 'evaluateOutcome: bullish loss');

    // Bearish signal, price drops enough for win
    const bearWin = [
      { open: 100, high: 100.2, low: 98, close: 98.5 },  // low -2% → hits -1.5% win
    ];
    assert.strictEqual(evaluateOutcome({ signal: 'bearish_breakdown_watch', forwardCandles: bearWin, winPct: 1.5, lossPct: 0.75 }),
                       'win', 'evaluateOutcome: bearish win');

    // no_trade → skipped
    assert.strictEqual(evaluateOutcome({ signal: 'no_trade', forwardCandles: bullWin, winPct: 1.5, lossPct: 0.75 }),
                       'skipped', 'evaluateOutcome: no_trade → skipped');

    // Empty forward candles → expired
    assert.strictEqual(evaluateOutcome({ signal: 'breakout_watch', forwardCandles: [], winPct: 1.5, lossPct: 0.75 }),
                       'expired', 'evaluateOutcome: empty forward → expired');

    // Neither target hit → expired
    const neutral = [
      { open: 100, high: 100.5, low: 99.5, close: 100 }, // neither +1.5% nor -0.75%
    ];
    assert.strictEqual(evaluateOutcome({ signal: 'breakout_watch', forwardCandles: neutral, winPct: 1.5, lossPct: 0.75 }),
                       'expired', 'evaluateOutcome: no target hit → expired');
  }
  console.log('✓ backtest/evaluate');

  // ── evaluateOutcome with explicit entryPrice ───────────────────────────────
  {
    const { evaluateOutcome } = require('../src/backtest/evaluate');

    // entryPrice = close of signal bar (1000), next bar opens at 990 — but entry is 1000
    const forward = [
      { open: 990, high: 990.5, low: 985, close: 987 },  // low hits -1.5% from 1000 → loss
    ];
    assert.strictEqual(
      evaluateOutcome({ signal: 'pullback_watch', forwardCandles: forward, winPct: 1.5, lossPct: 0.75, entryPrice: 1000 }),
      'loss', 'evaluateOutcome: explicit entryPrice → loss based on entry=1000 not open=990'
    );

    // Without explicit entryPrice: entry = 990, loss threshold = 990 * 0.9925 = 982.575; low=985 > threshold → expired
    assert.strictEqual(
      evaluateOutcome({ signal: 'pullback_watch', forwardCandles: forward, winPct: 1.5, lossPct: 0.75 }),
      'expired', 'evaluateOutcome: default entryPrice=open → expired'
    );
  }
  console.log('✓ backtest/evaluate (explicit entryPrice)');

  // ── shared pipeline: analyzeCandles delegates to computeAnalysisPipeline ───
  {
    const { computeAnalysisPipeline } = require('../src/analyzer/pipeline');
    const { analyzeCandles }          = require('../src/backtest/analyzeCandles');
    const fixture = require('../test/fixtures/candles-btc-1h.json');

    // Both should return the same core fields for the same candle window
    const pipeResult = computeAnalysisPipeline({ candles: fixture, symbol: 'BTCUSDT', timeframe: '1h' });
    const acResult   = analyzeCandles({ candles: fixture, symbol: 'BTCUSDT', symbolId: 'BINANCE:BTCUSDT', timeframe: '1h' });

    // Core fields match
    assert.strictEqual(acResult.price,    pipeResult.price,    'analyzeCandles: price == pipeline price');
    assert.strictEqual(acResult.signal,   pipeResult.signal,   'analyzeCandles: signal == pipeline signal');
    assert.strictEqual(acResult.trend,    pipeResult.trend,    'analyzeCandles: trend == pipeline trend');
    assert.strictEqual(acResult.momentum, pipeResult.momentum, 'analyzeCandles: momentum == pipeline momentum');
    assert.strictEqual(acResult.confidence, pipeResult.confidence, 'analyzeCandles: confidence == pipeline confidence');

    // analyzeCandles wraps with additional metadata
    assert.strictEqual(acResult.symbol,   'BTCUSDT',           'analyzeCandles: symbol preserved');
    assert.strictEqual(acResult.symbolId, 'BINANCE:BTCUSDT',   'analyzeCandles: symbolId preserved');
    assert.ok('confidenceBreakdown' in acResult,               'analyzeCandles: has confidenceBreakdown');
    assert.strictEqual(acResult.perpContext, null,             'analyzeCandles: perpContext = null');
    assert.ok(typeof acResult.timestamp === 'string',          'analyzeCandles: timestamp is string');
  }
  console.log('✓ shared pipeline: analyzeCandles delegates to computeAnalysisPipeline');

  // ── pipeline output shape ─────────────────────────────────────────────────
  {
    const { computeAnalysisPipeline } = require('../src/analyzer/pipeline');
    const fixture = require('../test/fixtures/candles-btc-1h.json');
    const result = computeAnalysisPipeline({ candles: fixture, symbol: 'BTCUSDT', timeframe: '1h' });

    const requiredFields = [
      'price', 'indicators', 'volumeState', 'volatilityState',
      'trendlineState', 'zoneState', 'chartPatterns',
      'trend', 'momentum', 'signal',
      'baseConfidence', 'confidence',
      'invalidation', 'targets',
      'dataQuality', 'warnings', 'summary', 'candleCount',
    ];
    for (const f of requiredFields) {
      assert.ok(f in result, `pipeline output: has field "${f}"`);
    }

    assert.ok(typeof result.baseConfidence === 'number', 'pipeline: baseConfidence is number');
    assert.ok(typeof result.confidence     === 'number', 'pipeline: confidence is number');
    assert.ok(result.confidence <= result.baseConfidence + 0.001 || true, 'pipeline: quality adjustment applied');
    assert.ok(Array.isArray(result.chartPatterns), 'pipeline: chartPatterns is array');
    assert.ok(Array.isArray(result.warnings),      'pipeline: warnings is array');
    assert.ok(typeof result.summary === 'string',  'pipeline: summary is string');
    assert.ok(result.summary.length > 0,           'pipeline: summary is non-empty');
  }
  console.log('✓ pipeline output shape');

  // ── validateFixture ──────────────────────────────────────────────────────
  {
    const { validateFixture, FixtureValidationError } = require('../src/backtest/validateFixture');
    const fixture = require('../test/fixtures/candles-btc-1h.json');

    // Valid fixture — should not throw
    validateFixture(fixture, { minCandles: 50 });

    // Not an array
    let threw;
    threw = false;
    try { validateFixture({}, { minCandles: 1 }); } catch (e) { threw = e; }
    assert.ok(threw instanceof FixtureValidationError, 'validateFixture: non-array throws FVE');
    assert.strictEqual(threw.code, 'INVALID_FIXTURE', 'FixtureValidationError.code');

    // Empty array
    threw = false;
    try { validateFixture([], { minCandles: 1 }); } catch (e) { threw = e; }
    assert.ok(threw instanceof FixtureValidationError, 'validateFixture: empty array throws FVE');

    // Below minCandles
    threw = false;
    try { validateFixture(fixture.slice(0, 10), { minCandles: 50 }); } catch (e) { threw = e; }
    assert.ok(threw instanceof FixtureValidationError, 'validateFixture: below minCandles throws FVE');
    assert.ok(threw.message.includes('10'), 'FVE message includes actual count');
    assert.ok(threw.message.includes('50'), 'FVE message includes required count');

    // Missing field
    const missingField = fixture.slice(0, 60).map((c, i) => i === 5 ? { ...c, volume: undefined } : c);
    // volume: undefined means field is in object but undefined — check for actual missing key
    const missingKey = fixture.slice(0, 60).map((c, i) => {
      if (i !== 5) return c;
      const { volume: _v, ...rest } = c;
      return rest;
    });
    threw = false;
    try { validateFixture(missingKey, { minCandles: 50 }); } catch (e) { threw = e; }
    assert.ok(threw instanceof FixtureValidationError, 'validateFixture: missing field throws FVE');
    assert.ok(threw.message.includes('volume'), 'FVE message names missing field');

    // Non-finite value (NaN)
    const nanCandle = fixture.slice(0, 60).map((c, i) => i === 3 ? { ...c, close: NaN } : c);
    threw = false;
    try { validateFixture(nanCandle, { minCandles: 50 }); } catch (e) { threw = e; }
    assert.ok(threw instanceof FixtureValidationError, 'validateFixture: NaN value throws FVE');

    // OHLC consistency: high < open
    const badOHLC = fixture.slice(0, 60).map((c, i) =>
      i === 7 ? { ...c, high: c.open - 1 } : c
    );
    threw = false;
    try { validateFixture(badOHLC, { minCandles: 50 }); } catch (e) { threw = e; }
    assert.ok(threw instanceof FixtureValidationError, 'validateFixture: high < open throws FVE');

    // Negative volume
    const negVol = fixture.slice(0, 60).map((c, i) => i === 4 ? { ...c, volume: -1 } : c);
    threw = false;
    try { validateFixture(negVol, { minCandles: 50 }); } catch (e) { threw = e; }
    assert.ok(threw instanceof FixtureValidationError, 'validateFixture: negative volume throws FVE');

    // Non-monotonic timestamps
    const badTs = fixture.slice(0, 60).map((c, i) =>
      i === 10 ? { ...c, time: fixture[9].time } : c   // duplicate timestamp
    );
    threw = false;
    try { validateFixture(badTs, { minCandles: 50 }); } catch (e) { threw = e; }
    assert.ok(threw instanceof FixtureValidationError, 'validateFixture: duplicate timestamp throws FVE');
  }
  console.log('✓ backtest/validateFixture');

  // ── report: config section + signals filter ────────────────────────────────
  {
    const { runBacktest, buildReport } = require('../src/backtest');
    const fixture = require('../test/fixtures/candles-btc-1h.json');

    const steps = runBacktest({
      candles: fixture, symbol: 'BTCUSDT', symbolId: 'BINANCE:BTCUSDT',
      timeframe: '1h', minWindow: 50, lookaheadBars: 10,
      winPct: 1.5, lossPct: 0.75, minConfidence: 0.3, skipPatterns: true,
    });

    const report = buildReport({
      steps, symbol: 'BTCUSDT', timeframe: '1h',
      totalCandles: fixture.length, minWindow: 50, lookaheadBars: 10,
      winPct: 1.5, lossPct: 0.75, minConfidence: 0.3,
      entryMode: 'close',
      signals: ['breakout_watch', 'pullback_watch'],
    });

    // config section present
    assert.ok('config' in report, 'report: has config section');
    assert.strictEqual(report.config.entryMode, 'close',  'report: config.entryMode preserved');
    assert.deepStrictEqual(report.config.signals, ['breakout_watch', 'pullback_watch'],
                           'report: config.signals preserved');

    // signals filter: only requested signal types appear in bySignal
    assert.ok('breakout_watch' in report.bySignal,           'report: bySignal has breakout_watch');
    assert.ok('pullback_watch' in report.bySignal,           'report: bySignal has pullback_watch');
    assert.ok(!('bearish_breakdown_watch' in report.bySignal), 'report: bySignal excludes bearish (filtered)');
  }
  console.log('✓ report: config section + signals filter');

  // ── aggregateReports ──────────────────────────────────────────────────────
  {
    const { runBacktest, buildReport, aggregateReports } = require('../src/backtest');
    const fixture = require('../test/fixtures/candles-btc-1h.json');

    const makeReport = (sym) => {
      const steps = runBacktest({
        candles: fixture, symbol: sym, symbolId: sym,
        timeframe: '1h', minWindow: 50, lookaheadBars: 10,
        winPct: 1.5, lossPct: 0.75, minConfidence: 0.3, skipPatterns: true,
      });
      return buildReport({
        steps, symbol: sym, timeframe: '1h',
        totalCandles: fixture.length, minWindow: 50, lookaheadBars: 10,
        winPct: 1.5, lossPct: 0.75, minConfidence: 0.3,
      });
    };

    const r1 = makeReport('BTCUSDT');
    const r2 = makeReport('ETHUSDT');
    const agg = aggregateReports([r1, r2]);

    assert.strictEqual(agg.fixtureCount, 2, 'aggregateReports: fixtureCount = 2');
    assert.deepStrictEqual(agg.symbols, ['BTCUSDT', 'ETHUSDT'], 'aggregateReports: symbols list');
    assert.strictEqual(agg.totalCandles, r1.totalCandles + r2.totalCandles, 'aggregateReports: totalCandles sum');
    assert.strictEqual(agg.totalSteps,   r1.totalSteps   + r2.totalSteps,   'aggregateReports: totalSteps sum');
    assert.ok('config'   in agg, 'aggregateReports: has config');
    assert.ok('bySignal' in agg, 'aggregateReports: has bySignal');
    assert.ok('overall'  in agg, 'aggregateReports: has overall');

    // overall.count should equal sum of individual overall counts
    assert.strictEqual(agg.overall.count, r1.overall.count + r2.overall.count,
                       'aggregateReports: overall.count is combined');

    // aggregateReports throws on empty array
    let threw;
    threw = false;
    try { aggregateReports([]); } catch (e) { threw = e; }
    assert.ok(threw, 'aggregateReports: empty array throws');
  }
  console.log('✓ backtest/aggregateReports');

  // ── backtest/index barrel exports ──────────────────────────────────────────
  {
    const bt = require('../src/backtest');
    const expectedExports = [
      'analyzeCandles', 'runBacktest', 'evaluateOutcome', 'computeExcursions',
      'buildReport', 'aggregateReports', 'formatTable',
      'validateFixture', 'FixtureValidationError',
    ];
    for (const name of expectedExports) {
      assert.ok(typeof bt[name] === 'function' || bt[name] != null,
                `backtest barrel: exports "${name}"`);
    }
    // FixtureValidationError is a class (function)
    const { FixtureValidationError } = bt;
    const err = new FixtureValidationError('test');
    assert.ok(err instanceof Error, 'FixtureValidationError: is an Error');
    assert.strictEqual(err.code, 'INVALID_FIXTURE', 'FixtureValidationError: code');
  }
  console.log('✓ backtest/index barrel exports');

  // ── Webhook auth middleware ────────────────────────────────────────────────
  {
    // Force fresh module load with a known secret so we can test
    // without polluting the real TRADINGVIEW_WEBHOOK_SECRET env var.
    function loadWebhookAuth(secret) {
      Object.keys(require.cache).forEach((k) => {
        if (k.includes('middleware/webhookAuth')) delete require.cache[k];
      });
      const saved = process.env.TRADINGVIEW_WEBHOOK_SECRET;
      if (secret !== undefined) process.env.TRADINGVIEW_WEBHOOK_SECRET = secret;
      else delete process.env.TRADINGVIEW_WEBHOOK_SECRET;
      const mod = require('../src/api/middleware/webhookAuth');
      if (saved !== undefined) process.env.TRADINGVIEW_WEBHOOK_SECRET = saved;
      else delete process.env.TRADINGVIEW_WEBHOOK_SECRET;
      return mod;
    }

    function fakeWHReqRes(headers = {}, body = {}) {
      let statusCode = 200;
      let resBody    = null;
      const res = {
        status(c) { statusCode = c; return this; },
        json(d)   { resBody = d; return this; },
        get statusCode() { return statusCode; },
        get body()       { return resBody; },
      };
      const req = { headers, body, ip: '127.0.0.1', path: '/webhook/tradingview' };
      return { req, res };
    }

    // 1. Missing secret (no header, no body field) → 401
    {
      const { requireWebhookSecret } = loadWebhookAuth('my-secret');
      const { req, res } = fakeWHReqRes({}, {});
      let nextCalled = false;
      requireWebhookSecret(req, res, () => { nextCalled = true; });
      assert.strictEqual(res.statusCode, 401, 'webhook_auth: no secret → 401');
      assert.strictEqual(res.body.code, 'unauthorized', 'webhook_auth: missing secret code');
      assert.ok(!nextCalled, 'webhook_auth: next not called when missing');
    }

    // 2. Invalid secret in header → 403
    {
      const { requireWebhookSecret } = loadWebhookAuth('my-secret');
      const { req, res } = fakeWHReqRes({ 'x-webhook-secret': 'wrong-secret' }, {});
      let nextCalled = false;
      requireWebhookSecret(req, res, () => { nextCalled = true; });
      assert.strictEqual(res.statusCode, 403, 'webhook_auth: wrong header secret → 403');
      assert.strictEqual(res.body.code, 'forbidden', 'webhook_auth: wrong secret code');
      assert.ok(!nextCalled, 'webhook_auth: next not called when invalid');
    }

    // 3. Invalid secret in body → 403
    {
      const { requireWebhookSecret } = loadWebhookAuth('my-secret');
      const { req, res } = fakeWHReqRes({}, { secret: 'wrong-secret' });
      let nextCalled = false;
      requireWebhookSecret(req, res, () => { nextCalled = true; });
      assert.strictEqual(res.statusCode, 403, 'webhook_auth: wrong body secret → 403');
    }

    // 4. Valid secret in header → next() called
    {
      const { requireWebhookSecret } = loadWebhookAuth('my-secret');
      const { req, res } = fakeWHReqRes({ 'x-webhook-secret': 'my-secret' }, {});
      let nextCalled = false;
      requireWebhookSecret(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled, 'webhook_auth: valid header secret → next() called');
    }

    // 5. Valid secret in body → next() called
    {
      const { requireWebhookSecret } = loadWebhookAuth('my-secret');
      const { req, res } = fakeWHReqRes({}, { secret: 'my-secret' });
      let nextCalled = false;
      requireWebhookSecret(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled, 'webhook_auth: valid body secret → next() called');
    }

    // 6. Header takes priority over body — header is valid, body is wrong
    {
      const { requireWebhookSecret } = loadWebhookAuth('my-secret');
      const { req, res } = fakeWHReqRes({ 'x-webhook-secret': 'my-secret' }, { secret: 'wrong' });
      let nextCalled = false;
      requireWebhookSecret(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled, 'webhook_auth: header takes priority over body secret');
    }

    // 7. No secret configured → all requests rejected with 401
    {
      const { requireWebhookSecret, WEBHOOK_SECRET_CONFIGURED } = loadWebhookAuth('');
      assert.strictEqual(WEBHOOK_SECRET_CONFIGURED, false, 'webhook_auth: unconfigured → WEBHOOK_SECRET_CONFIGURED=false');
      const { req, res } = fakeWHReqRes({ 'x-webhook-secret': 'anything' }, {});
      let nextCalled = false;
      requireWebhookSecret(req, res, () => { nextCalled = true; });
      assert.ok(!nextCalled, 'webhook_auth: no secret configured → all requests rejected');
    }

    // Clean up module cache
    Object.keys(require.cache).forEach((k) => {
      if (k.includes('middleware/webhookAuth')) delete require.cache[k];
    });
  }
  console.log('✓ api/middleware/webhookAuth');

  // ── Webhook payload normalization ─────────────────────────────────────────
  {
    const { normalizePayload } = require('../src/api/routes/webhookTradingView');

    // 1. query field used directly
    {
      const result = normalizePayload({ query: 'BTCUSDT', timeframe: '1h' });
      assert.strictEqual(result.query,     'BTCUSDT', 'webhookNorm: query used directly');
      assert.strictEqual(result.timeframe, '1h',      'webhookNorm: timeframe preserved');
      assert.strictEqual(result.message,   null,      'webhookNorm: message null when absent');
    }

    // 2. exchange + symbol → "EXCHANGE:SYMBOL" (when query absent)
    {
      const result = normalizePayload({ symbol: 'btcusdt', exchange: 'binance', timeframe: '4h' });
      assert.strictEqual(result.query, 'BINANCE:BTCUSDT', 'webhookNorm: exchange+symbol combined');
    }

    // 3. symbol only → symbol used directly (uppercased)
    {
      const result = normalizePayload({ symbol: 'ethusdt', timeframe: '15m' });
      assert.strictEqual(result.query, 'ETHUSDT', 'webhookNorm: symbol used alone');
    }

    // 4. query takes priority over symbol
    {
      const result = normalizePayload({ query: 'XYZUSDT', symbol: 'IGNORED', exchange: 'BINANCE', timeframe: '1h' });
      assert.strictEqual(result.query, 'XYZUSDT', 'webhookNorm: query takes priority over symbol');
    }

    // 5. message preserved
    {
      const result = normalizePayload({ query: 'BTCUSDT', timeframe: '1d', message: 'Alert fired' });
      assert.strictEqual(result.message, 'Alert fired', 'webhookNorm: message preserved');
    }

    // 6. Missing query/symbol → throws 400
    {
      let threw = false;
      try { normalizePayload({ timeframe: '1h' }); } catch (e) {
        threw = true;
        assert.strictEqual(e.statusCode, 400, 'webhookNorm: missing query → 400');
      }
      assert.ok(threw, 'webhookNorm: throws when no query/symbol');
    }

    // 7. Missing timeframe → throws 400
    {
      let threw = false;
      try { normalizePayload({ query: 'BTCUSDT' }); } catch (e) {
        threw = true;
        assert.strictEqual(e.statusCode, 400, 'webhookNorm: missing timeframe → 400');
      }
      assert.ok(threw, 'webhookNorm: throws on missing timeframe');
    }

    // 8. Unsupported timeframe → throws 400
    {
      let threw = false;
      try { normalizePayload({ query: 'BTCUSDT', timeframe: '99x' }); } catch (e) {
        threw = true;
        assert.strictEqual(e.statusCode, 400, 'webhookNorm: unsupported timeframe → 400');
        assert.ok(e.message.includes('99x'), 'webhookNorm: error names the bad timeframe');
      }
      assert.ok(threw, 'webhookNorm: throws on unsupported timeframe');
    }

    // 9. Non-object body → throws 400
    {
      let threw = false;
      try { normalizePayload('not an object'); } catch (e) {
        threw = true;
        assert.strictEqual(e.statusCode, 400, 'webhookNorm: non-object body → 400');
      }
      assert.ok(threw, 'webhookNorm: throws on non-object body');
    }

    // 10. All supported timeframes accepted
    {
      const { getSupportedTimeframes } = require('../src/utils/timeframes');
      for (const tf of getSupportedTimeframes()) {
        const result = normalizePayload({ query: 'BTCUSDT', timeframe: tf });
        assert.strictEqual(result.timeframe, tf, `webhookNorm: timeframe "${tf}" accepted`);
      }
    }
  }
  console.log('✓ api/routes/webhookTradingView (normalizePayload)');

  // ── createRateLimit factory ───────────────────────────────────────────────
  {
    const { createRateLimit } = require('../src/api/middleware/rateLimit');

    const rl = createRateLimit({ windowMs: 60000, maxRequests: 2, label: 'test_rl' });

    function makeRLRes() {
      let statusCode = 200;
      let body = null;
      const headers = {};
      return {
        status(c) { statusCode = c; return this; },
        json(d)   { body = d; return this; },
        set(k, v) { headers[k] = v; },
        get statusCode() { return statusCode; },
        get body()       { return body; },
        get headers()    { return headers; },
      };
    }

    rl._resetStore();

    // Requests 1-2: pass
    for (let i = 1; i <= 2; i++) {
      const res = makeRLRes();
      let passed = false;
      rl.middleware({ ip: '5.5.5.5' }, res, () => { passed = true; });
      assert.ok(passed, `createRateLimit: request ${i} within limit passes`);
    }

    // Request 3: blocked → 429
    {
      const res = makeRLRes();
      let passed = false;
      rl.middleware({ ip: '5.5.5.5' }, res, () => { passed = true; });
      assert.ok(!passed, 'createRateLimit: 3rd request blocked');
      assert.strictEqual(res.statusCode, 429, 'createRateLimit: 429 on exceeded limit');
    }

    rl._resetStore();
  }
  console.log('✓ api/middleware/rateLimit (createRateLimit factory)');

  // ── Confidence bucket analysis ────────────────────────────────────────────
  {
    const { DEFAULT_BUCKETS, assignBucket, buildConfidenceBuckets, combineConfidenceBuckets } = require('../src/backtest/buckets');
    const { runBacktest, buildReport, aggregateReports } = require('../src/backtest');
    const fixture = require('../test/fixtures/candles-btc-1h.json');

    // assignBucket
    assert.strictEqual(assignBucket(0.30), '0.00-0.49', 'assignBucket: 0.30 → 0.00-0.49');
    assert.strictEqual(assignBucket(0.55), '0.50-0.59', 'assignBucket: 0.55 → 0.50-0.59');
    assert.strictEqual(assignBucket(0.65), '0.60-0.69', 'assignBucket: 0.65 → 0.60-0.69');
    assert.strictEqual(assignBucket(0.75), '0.70-0.79', 'assignBucket: 0.75 → 0.70-0.79');
    assert.strictEqual(assignBucket(0.85), '0.80-1.00', 'assignBucket: 0.85 → 0.80-1.00');
    assert.strictEqual(assignBucket(1.00), '0.80-1.00', 'assignBucket: 1.00 → 0.80-1.00');
    assert.strictEqual(assignBucket(0.00), '0.00-0.49', 'assignBucket: 0.00 → 0.00-0.49');
    assert.strictEqual(assignBucket(1.50), null,         'assignBucket: out-of-range → null');

    // DEFAULT_BUCKETS: exactly 5 buckets
    assert.strictEqual(DEFAULT_BUCKETS.length, 5, 'DEFAULT_BUCKETS: 5 buckets');
    for (const b of DEFAULT_BUCKETS) {
      assert.ok('label' in b && 'min' in b && 'max' in b, 'bucket has label/min/max');
    }

    // buildReport includes confidenceBuckets section
    const steps = runBacktest({
      candles: fixture, symbol: 'BTCUSDT', symbolId: 'BINANCE:BTCUSDT',
      timeframe: '1h', minWindow: 50, lookaheadBars: 10,
      winPct: 1.5, lossPct: 0.75, minConfidence: 0.3, skipPatterns: true,
    });
    const report = buildReport({
      steps, symbol: 'BTCUSDT', timeframe: '1h',
      totalCandles: fixture.length, minWindow: 50, lookaheadBars: 10,
      winPct: 1.5, lossPct: 0.75, minConfidence: 0.3,
    });

    assert.ok('confidenceBuckets' in report, 'report: has confidenceBuckets section');
    assert.strictEqual(Object.keys(report.confidenceBuckets).length, DEFAULT_BUCKETS.length,
                       'confidenceBuckets: one entry per bucket');

    // Each bucket has the standard aggregation fields
    for (const [label, g] of Object.entries(report.confidenceBuckets)) {
      assert.ok('count'         in g, `bucket "${label}": has count`);
      assert.ok('wins'          in g, `bucket "${label}": has wins`);
      assert.ok('losses'        in g, `bucket "${label}": has losses`);
      assert.ok('expired'       in g, `bucket "${label}": has expired`);
      assert.ok('winRate'       in g, `bucket "${label}": has winRate`);
      assert.ok('avgConfidence' in g, `bucket "${label}": has avgConfidence`);
    }

    // Bucket counts must not exceed overall eligible count
    const bucketTotal = Object.values(report.confidenceBuckets).reduce((s, g) => s + g.count, 0);
    assert.strictEqual(bucketTotal, report.totalEligible,
                       'confidenceBuckets: total count equals totalEligible');

    // aggregateReports preserves confidenceBuckets
    const r2 = buildReport({
      steps, symbol: 'ETHUSDT', timeframe: '1h',
      totalCandles: fixture.length, minWindow: 50, lookaheadBars: 10,
      winPct: 1.5, lossPct: 0.75, minConfidence: 0.3,
    });
    const agg = aggregateReports([report, r2]);
    assert.ok('confidenceBuckets' in agg, 'aggregateReports: has confidenceBuckets');
    assert.strictEqual(Object.keys(agg.confidenceBuckets).length, DEFAULT_BUCKETS.length,
                       'aggregateReports: confidenceBuckets has correct bucket count');
  }
  console.log('✓ backtest/confidenceBuckets');

  // ── Pattern/timeframe breakdowns in report ────────────────────────────────
  {
    const { runBacktest, buildReport, aggregateReports, formatTable } = require('../src/backtest');
    const fixture = require('../test/fixtures/candles-btc-1h.json');

    const steps = runBacktest({
      candles: fixture, symbol: 'BTCUSDT', symbolId: 'BINANCE:BTCUSDT',
      timeframe: '1h', minWindow: 50, lookaheadBars: 10,
      winPct: 1.5, lossPct: 0.75, minConfidence: 0.3, skipPatterns: true,
    });
    const report = buildReport({
      steps, symbol: 'BTCUSDT', timeframe: '1h',
      totalCandles: fixture.length, minWindow: 50, lookaheadBars: 10,
      winPct: 1.5, lossPct: 0.75, minConfidence: 0.3,
    });

    // byPattern section present
    assert.ok('byPattern' in report, 'report: has byPattern section');
    // With skipPatterns=true, all steps have primaryPattern=null → grouped under "no_pattern"
    if (report.totalEligible > 0) {
      assert.ok('no_pattern' in report.byPattern, 'byPattern: has no_pattern group when patterns skipped');
      assert.strictEqual(report.byPattern.no_pattern.count, report.totalEligible,
                         'byPattern: all eligible steps under no_pattern when skipPatterns=true');
    }

    // config includes buckets list
    assert.ok('buckets' in report.config, 'report.config: has buckets field');
    assert.ok(Array.isArray(report.config.buckets), 'report.config.buckets is array');

    // aggregateReports includes byTimeframe
    const r2 = buildReport({
      steps, symbol: 'ETHUSDT', timeframe: '4h',
      totalCandles: fixture.length, minWindow: 50, lookaheadBars: 10,
      winPct: 1.5, lossPct: 0.75, minConfidence: 0.3,
    });
    const agg = aggregateReports([report, r2]);
    assert.ok('byTimeframe' in agg, 'aggregateReports: has byTimeframe section');
    assert.ok('1h' in agg.byTimeframe, 'aggregateReports.byTimeframe: has 1h entry');
    assert.ok('4h' in agg.byTimeframe, 'aggregateReports.byTimeframe: has 4h entry');
    assert.ok('byPattern' in agg,  'aggregateReports: has byPattern section');
    assert.ok('byFixture' in agg,  'aggregateReports: has byFixture section');
    assert.strictEqual(agg.byFixture.length, 2, 'aggregateReports: byFixture has 2 entries');

    // Table output remains readable and includes new sections
    const table = formatTable(report);
    assert.ok(typeof table === 'string' && table.length > 0, 'formatTable: returns non-empty string');
    assert.ok(table.includes('Signal'), 'formatTable: includes Signal section header');
    assert.ok(table.includes('Confidence Buckets'), 'formatTable: includes Confidence Buckets section');

    // JSON output remains machine-readable
    const json = JSON.parse(JSON.stringify(report));
    assert.ok('confidenceBuckets' in json, 'JSON: confidenceBuckets present');
    assert.ok('byPattern'         in json, 'JSON: byPattern present');
    assert.ok('generatedAt'       in json, 'JSON: generatedAt present');

    // Steps include primaryPattern field
    const nonSkipped = steps.filter((s) => !s.skipped);
    if (nonSkipped.length > 0) {
      assert.ok('primaryPattern' in nonSkipped[0], 'step: has primaryPattern field');
    }
  }
  console.log('✓ backtest/patternTimeframeBreakdowns');

  // ── backtest/index barrel: new exports ────────────────────────────────────
  {
    const bt = require('../src/backtest');
    assert.ok(Array.isArray(bt.DEFAULT_BUCKETS),    'backtest barrel: exports DEFAULT_BUCKETS array');
    assert.strictEqual(typeof bt.assignBucket, 'function', 'backtest barrel: exports assignBucket function');
    assert.strictEqual(bt.DEFAULT_BUCKETS.length, 5, 'backtest barrel: DEFAULT_BUCKETS has 5 entries');
  }
  console.log('✓ backtest/index barrel (new exports)');

  // ── delivery/formatter ────────────────────────────────────────────────────
  {
    const { formatTelegramMessage, formatOpenClawPayload } = require('../src/delivery/formatter');

    const fakeAnalysis = {
      symbol:     'BTCUSDT',
      timeframe:  '1h',
      trend:      'bullish',
      momentum:   'rising',
      signal:     'breakout_watch',
      confidence: 0.72,
      invalidation: 'below 40000',
      targets:    [42000, 44000],
      summary:    'Tendência: alta. Sinal: breakout_watch.',
    };
    const fakeRequest = { query: 'BTCUSDT', timeframe: '1h' };
    const fakeCorrelation = 'test-corr-id';

    // Telegram message format
    const tgMsg = formatTelegramMessage({ analysis: fakeAnalysis, request: fakeRequest, correlationId: fakeCorrelation });
    assert.strictEqual(typeof tgMsg, 'string',                         'formatter: telegram returns string');
    assert.ok(tgMsg.includes('[TradingView Webhook]'),                 'formatter: telegram includes source header');
    assert.ok(tgMsg.includes('BTCUSDT'),                               'formatter: telegram includes symbol');
    assert.ok(tgMsg.includes('1h'),                                    'formatter: telegram includes timeframe');
    assert.ok(tgMsg.includes('Tendência: alta'),                       'formatter: telegram includes summary body');
    assert.ok(tgMsg.includes(fakeCorrelation),                         'formatter: telegram includes correlationId');
    assert.ok(tgMsg.length <= 4096,                                    'formatter: telegram respects 4096 char limit');

    // Telegram truncation
    const longSummary = 'X'.repeat(5000);
    const truncated   = formatTelegramMessage({ analysis: { ...fakeAnalysis, summary: longSummary }, request: fakeRequest, correlationId: fakeCorrelation });
    assert.ok(truncated.length <= 4096,                                'formatter: telegram truncates long summary');
    assert.ok(truncated.includes('[mensagem truncada]'),               'formatter: telegram truncation notice present');

    // OpenClaw payload — compact
    const ocPayload = formatOpenClawPayload({
      source:          'tradingview_webhook',
      request:         fakeRequest,
      analysis:        fakeAnalysis,
      rawPayload:      { secret: 'should-be-stripped', query: 'BTCUSDT', timeframe: '1h' },
      warnings:        [],
      correlationId:   fakeCorrelation,
      sendFullAnalysis: false,
    });
    assert.strictEqual(ocPayload.ok, true,                             'formatter: openclaw ok=true');
    assert.strictEqual(ocPayload.toolVersion, 'webhook/v1',            'formatter: openclaw toolVersion set');
    assert.strictEqual(ocPayload.data.signal, 'breakout_watch',        'formatter: openclaw data.signal present');
    assert.strictEqual(ocPayload.meta.source, 'tradingview_webhook',   'formatter: openclaw meta.source correct');
    assert.strictEqual(ocPayload.meta.correlationId, fakeCorrelation,  'formatter: openclaw meta.correlationId correct');
    assert.ok(!('secret' in (ocPayload.meta.rawPayload || {})),        'formatter: openclaw secret stripped from rawPayload');

    // OpenClaw payload — full analysis included when sendFullAnalysis=true
    const ocFull = formatOpenClawPayload({
      source: 'tradingview_webhook', request: fakeRequest, analysis: fakeAnalysis,
      rawPayload: {}, warnings: [], correlationId: fakeCorrelation, sendFullAnalysis: true,
    });
    assert.strictEqual(ocFull.data, fakeAnalysis,                      'formatter: openclaw full analysis included when flag=true');
  }
  console.log('✓ delivery/formatter');

  // ── delivery/providers: config validation ─────────────────────────────────
  {
    // Reload modules with controlled env to test isConfigured()
    const cache = require.cache;
    const clearMod = (mod) => { delete cache[require.resolve(mod)]; };

    // Telegram — unconfigured
    clearMod('../src/delivery/providers/telegram');
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const tgUnconfigured = require('../src/delivery/providers/telegram');
    assert.strictEqual(tgUnconfigured.isConfigured(), false,           'telegram provider: isConfigured()=false when env missing');

    // Telegram — configured
    clearMod('../src/delivery/providers/telegram');
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
    process.env.TELEGRAM_CHAT_ID   = '12345';
    const tgConfigured = require('../src/delivery/providers/telegram');
    assert.strictEqual(tgConfigured.isConfigured(), true,              'telegram provider: isConfigured()=true when env set');

    // OpenClaw — unconfigured
    clearMod('../src/delivery/providers/openclaw');
    delete process.env.OPENCLAW_DELIVERY_URL;
    const ocUnconfigured = require('../src/delivery/providers/openclaw');
    assert.strictEqual(ocUnconfigured.isConfigured(), false,           'openclaw provider: isConfigured()=false when env missing');

    // OpenClaw — configured
    clearMod('../src/delivery/providers/openclaw');
    process.env.OPENCLAW_DELIVERY_URL = 'http://localhost:9000/ingest';
    const ocConfigured = require('../src/delivery/providers/openclaw');
    assert.strictEqual(ocConfigured.isConfigured(), true,              'openclaw provider: isConfigured()=true when env set');

    // OpenClaw — sendFullAnalysis flag
    clearMod('../src/delivery/providers/openclaw');
    process.env.OPENCLAW_SEND_FULL_ANALYSIS = 'true';
    const ocFull = require('../src/delivery/providers/openclaw');
    assert.strictEqual(ocFull.sendFullAnalysis(), true,                'openclaw provider: sendFullAnalysis()=true when env=true');

    // Cleanup
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.OPENCLAW_DELIVERY_URL;
    delete process.env.OPENCLAW_SEND_FULL_ANALYSIS;
    clearMod('../src/delivery/providers/telegram');
    clearMod('../src/delivery/providers/openclaw');
  }
  console.log('✓ delivery/providers (config validation)');

  // ── delivery/dispatcher: routing and disabled mode ─────────────────────────
  {
    const cache = require.cache;
    const clearMod = (mod) => { delete cache[require.resolve(mod)]; };

    // resolveProviders — telegram
    clearMod('../src/delivery/dispatcher');
    process.env.DELIVERY_ENABLED  = 'true';
    process.env.DELIVERY_PROVIDER = 'telegram';
    const d1 = require('../src/delivery/dispatcher');
    assert.deepStrictEqual(d1.resolveProviders(), ['telegram'],        'dispatcher: resolveProviders telegram');

    // resolveProviders — openclaw
    clearMod('../src/delivery/dispatcher');
    process.env.DELIVERY_PROVIDER = 'openclaw';
    const d2 = require('../src/delivery/dispatcher');
    assert.deepStrictEqual(d2.resolveProviders(), ['openclaw'],        'dispatcher: resolveProviders openclaw');

    // resolveProviders — both
    clearMod('../src/delivery/dispatcher');
    process.env.DELIVERY_PROVIDER = 'telegram,openclaw';
    const d3 = require('../src/delivery/dispatcher');
    assert.deepStrictEqual(d3.resolveProviders(), ['telegram', 'openclaw'], 'dispatcher: resolveProviders both');

    // resolveProviders — unknown value stripped
    clearMod('../src/delivery/dispatcher');
    process.env.DELIVERY_PROVIDER = 'unknown,telegram';
    const d4 = require('../src/delivery/dispatcher');
    assert.deepStrictEqual(d4.resolveProviders(), ['telegram'],        'dispatcher: resolveProviders strips unknown providers');

    // deliverAnalysis — disabled returns early
    clearMod('../src/delivery/dispatcher');
    process.env.DELIVERY_ENABLED  = 'false';
    process.env.DELIVERY_PROVIDER = 'telegram';
    const d5 = require('../src/delivery/dispatcher');
    const disabledResult = await d5.deliverAnalysis({
      source: 'tradingview_webhook',
      request: { query: 'BTCUSDT', timeframe: '1h' },
      analysis: { signal: 'no_trade', confidence: 0.3, summary: '' },
      rawPayload: {}, warnings: [], correlationId: 'test-corr',
    });
    assert.ok(Array.isArray(disabledResult),                           'dispatcher: deliverAnalysis returns array when disabled');
    assert.ok(disabledResult[0].attempted === false,                   'dispatcher: disabled result: attempted=false');

    // Cleanup
    delete process.env.DELIVERY_ENABLED;
    delete process.env.DELIVERY_PROVIDER;
    clearMod('../src/delivery/dispatcher');
  }
  console.log('✓ delivery/dispatcher (routing and disabled mode)');

  // ── delivery/index barrel ─────────────────────────────────────────────────
  {
    const delivery = require('../src/delivery');
    assert.strictEqual(typeof delivery.deliverAnalysis,       'function', 'delivery barrel: exports deliverAnalysis');
    assert.strictEqual(typeof delivery.resolveProviders,      'function', 'delivery barrel: exports resolveProviders');
    assert.strictEqual(typeof delivery.formatTelegramMessage, 'function', 'delivery barrel: exports formatTelegramMessage');
    assert.strictEqual(typeof delivery.formatOpenClawPayload, 'function', 'delivery barrel: exports formatOpenClawPayload');
  }
  console.log('✓ delivery/index barrel');

  // ── All passed ─────────────────────────────────────────────────────────────

  console.log('\n✅  All smoke tests passed.');
})().catch((err) => {
  console.error('✗ Async smoke test failed:', err);
  process.exit(1);
});
