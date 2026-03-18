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

  // ── All passed ─────────────────────────────────────────────────────────────

  console.log('\n✅  All smoke tests passed.');
})().catch((err) => {
  console.error('✗ Async smoke test failed:', err);
  process.exit(1);
});
