'use strict';

const assert = require('assert');
const { computeTradeQualification } = require('../src/analyzer/tradeQualification');

function makeIndicators(overrides = {}) {
  return {
    ema20: 100, ema50: 95, ema100: 90, ema200: 80, ma200: 78,
    atr14: 2, rsi14: 52, avgVolume20: 1000,
    ...overrides,
  };
}

// tradeBias: pullback_watch → long
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.55, trend: 'bullish', momentum: 'neutral_bullish',
    indicators: makeIndicators(), currentPrice: 97,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none', bullishTrendline: null, bearishTrendline: null, pivotContext: null },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
  });
  assert.strictEqual(r.tradeBias, 'long', 'pullback_watch → tradeBias long');
  console.log('✓ tradeBias: pullback_watch → long');
}

// tradeBias: bearish_breakdown_watch → short
{
  const r = computeTradeQualification({
    signal: 'bearish_breakdown_watch', confidence: 0.55, trend: 'bearish', momentum: 'bearish',
    indicators: makeIndicators({ ema20: 100, ema50: 105 }), currentPrice: 97,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none', bullishTrendline: null, bearishTrendline: null, pivotContext: null },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
  });
  assert.strictEqual(r.tradeBias, 'short', 'bearish_breakdown_watch → tradeBias short');
  console.log('✓ tradeBias: bearish_breakdown_watch → short');
}

// no_trade → flat + rejected
{
  const r = computeTradeQualification({
    signal: 'no_trade', confidence: 0.50, trend: 'neutral', momentum: 'neutral',
    indicators: makeIndicators(), currentPrice: 100,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none' },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
  });
  assert.strictEqual(r.tradeBias, 'flat', 'no_trade → tradeBias flat');
  assert.strictEqual(r.setupQuality, 'rejected', 'no_trade → setupQuality rejected');
  assert.ok(r.rejectReasons.includes('no_actionable_signal'), 'no_trade → rejectReasons includes no_actionable_signal');
  console.log('✓ tradeBias/setupQuality: no_trade → flat/rejected');
}

// isCounterTrend: long signal + bearish trend
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.55, trend: 'bearish', momentum: 'neutral_bearish',
    indicators: makeIndicators(), currentPrice: 97,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none' },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
  });
  assert.strictEqual(r.isCounterTrend, true, 'long signal + bearish trend → isCounterTrend');
  assert.strictEqual(r.trendAlignment, 'counter', 'isCounterTrend → trendAlignment counter');
  console.log('✓ isCounterTrend: long + bearish trend');
}

// entryZone computed for pullback_watch
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.55, trend: 'bullish', momentum: 'neutral_bullish',
    indicators: makeIndicators({ atr14: 2 }), currentPrice: 97,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none' },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
  });
  assert.ok(r.entryZone !== null, 'entryZone should be computed');
  assert.ok(r.entryZone.lower < r.entryZone.upper, 'entryZone.lower < upper');
  assert.ok(r.entryZone.lower > 0, 'entryZone.lower > 0');
  console.log('✓ entryZone computed for pullback_watch');
}

// stopPrice near EMA50
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.55, trend: 'bullish', momentum: 'neutral_bullish',
    indicators: makeIndicators({ ema50: 95, atr14: 2 }), currentPrice: 95.5,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none', bullishTrendline: null, bearishTrendline: null, pivotContext: null },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
  });
  assert.ok(r.stopPrice !== null, 'stopPrice computed');
  assert.ok(r.stopPrice < 95, 'stopPrice below EMA50');
  console.log('✓ stopPrice computed for pullback near EMA50');
}

// takeProfitLevels: TP1 = EMA20 when above price
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.55, trend: 'bullish', momentum: 'neutral_bullish',
    indicators: makeIndicators({ ema20: 102, ema50: 95, atr14: 2 }), currentPrice: 97,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none', bullishTrendline: null, bearishTrendline: null, pivotContext: null },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
  });
  assert.ok(Array.isArray(r.takeProfitLevels), 'takeProfitLevels is array');
  assert.ok(r.takeProfitLevels.length >= 1, 'at least one TP level');
  assert.strictEqual(r.takeProfitLevels[0], 102, 'TP1 = EMA20 when EMA20 above price');
  console.log('✓ takeProfitLevels: TP1 = EMA20 when above price');
}

// riskRewardEstimate computed
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.60, trend: 'bullish', momentum: 'neutral_bullish',
    indicators: makeIndicators({ ema20: 102, ema50: 95, atr14: 2 }), currentPrice: 96,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none', bullishTrendline: null, bearishTrendline: null, pivotContext: null },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
  });
  assert.ok(r.riskRewardEstimate !== null, 'riskRewardEstimate computed');
  assert.ok(r.riskRewardEstimate > 0, 'riskRewardEstimate > 0');
  console.log(`✓ riskRewardEstimate: ${r.riskRewardEstimate}`);
}

// setupQuality: conf 0.65 + MTF aligned → high
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.65, trend: 'bullish', momentum: 'neutral_bullish',
    indicators: makeIndicators(), currentPrice: 97,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none' },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
    mtfQualification: { mtfAlignment: 'aligned', confidenceAdjustment: 0.05 },
  });
  assert.strictEqual(r.setupQuality, 'high', 'conf 0.65 + MTF aligned → high quality');
  console.log('✓ setupQuality: high when conf 0.65 + MTF aligned');
}

// setupQuality: degraded by MTF conflicting
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.60, trend: 'bullish', momentum: 'neutral_bullish',
    indicators: makeIndicators(), currentPrice: 97,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none' },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
    mtfQualification: { mtfAlignment: 'conflicting', confidenceAdjustment: -0.10 },
  });
  assert.ok(['low', 'rejected'].includes(r.setupQuality), 'conf 0.60 + MTF conflicting → low or rejected');
  assert.ok(r.rejectReasons.some((reason) => reason.includes('mtf_conflicting')), 'rejectReasons includes mtf_conflicting');
  console.log('✓ setupQuality: degraded when MTF conflicting');
}

// setupQuality: penalized in risk_off regime
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.58, trend: 'bullish', momentum: 'neutral_bullish',
    indicators: makeIndicators(), currentPrice: 97,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none' },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
    marketRegime: { regime: 'risk_off', available: true },
  });
  assert.ok(['low', 'rejected'].includes(r.setupQuality), 'risk_off regime penalizes long setup');
  console.log('✓ setupQuality: penalized in risk_off regime');
}

// null indicators → null fields (graceful degradation)
{
  const r = computeTradeQualification({
    signal: 'pullback_watch', confidence: 0.55, trend: 'bullish', momentum: 'neutral_bullish',
    indicators: { ema20: null, ema50: null, ema100: null, ema200: null, atr14: null, rsi14: null, avgVolume20: null },
    currentPrice: 100,
    trendlineState: { lineBreakDetected: false, lineBreakDirection: 'none' },
    zoneState: { zoneType: 'none' },
    volumeState: 'average', volatilityState: 'moderate',
  });
  assert.strictEqual(r.entryZone, null, 'no ATR → entryZone null');
  assert.strictEqual(r.stopPrice, null, 'no ATR → stopPrice null');
  assert.strictEqual(r.riskRewardEstimate, null, 'no ATR → riskRewardEstimate null');
  console.log('✓ null indicators → null fields (graceful degradation)');
}

console.log('\n✅ All tradeQualification.test.js tests passed\n');
