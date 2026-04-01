'use strict';

const assert = require('assert');
const {
  computeMtfQualification,
  classifyHigherTfAlignment,
  getTfRank,
} = require('../src/analyzer/mtfQualification');

// ── getTfRank ────────────────────────────────────────────────────────────────

assert.ok(getTfRank('1m') < getTfRank('5m'),  '1m rank < 5m rank');
assert.ok(getTfRank('1h') < getTfRank('4h'),  '1h rank < 4h rank');
assert.ok(getTfRank('4h') < getTfRank('1d'),  '4h rank < 1d rank');
assert.strictEqual(getTfRank('unknown'), 0,   'unknown tf → rank 0');
console.log('✓ getTfRank ordering');

// ── classifyHigherTfAlignment ────────────────────────────────────────────────

{
  const bullishResult = { trend: 'strong_bullish', signal: 'pullback_watch' };
  const alignment = classifyHigherTfAlignment(bullishResult, 'pullback_watch');
  assert.strictEqual(alignment, 'confirming', 'bullish HTF + bullish base → confirming');
  console.log('✓ classifyHigherTfAlignment: bullish HTF confirms bullish base');
}

{
  const bearishResult = { trend: 'strong_bearish', signal: 'bearish_breakdown_watch' };
  const alignment = classifyHigherTfAlignment(bearishResult, 'pullback_watch');
  assert.strictEqual(alignment, 'conflicting', 'bearish HTF + bullish base → conflicting');
  console.log('✓ classifyHigherTfAlignment: bearish HTF conflicts bullish base');
}

{
  const neutralResult = { trend: 'neutral', signal: 'no_trade' };
  const alignment = classifyHigherTfAlignment(neutralResult, 'breakout_watch');
  assert.strictEqual(alignment, 'neutral', 'neutral HTF → neutral');
  console.log('✓ classifyHigherTfAlignment: neutral HTF');
}

{
  const alignment = classifyHigherTfAlignment(null, 'pullback_watch');
  assert.strictEqual(alignment, 'neutral', 'null HTF result → neutral');
  console.log('✓ classifyHigherTfAlignment: null result → neutral');
}

// ── computeMtfQualification — no higher TF data ────────────────────────────

{
  const result = computeMtfQualification({
    baseTimeframe: '1h',
    baseSignal: 'pullback_watch',
    mtfResults: {},  // no other TFs
  });
  assert.strictEqual(result.mtfAlignment, 'neutral', 'no higher TFs → neutral');
  assert.strictEqual(result.higherTfCount, 0, 'no higher TFs → count 0');
  assert.strictEqual(result.confidenceAdjustment, 0, 'no higher TFs → adj 0');
  console.log('✓ computeMtfQualification: no higher TF data → neutral');
}

// ── computeMtfQualification — full alignment ──────────────────────────────

{
  const result = computeMtfQualification({
    baseTimeframe: '1h',
    baseSignal: 'pullback_watch',
    mtfResults: {
      '4h': { trend: 'strong_bullish', signal: 'pullback_watch', confidence: 0.70 },
      '1d': { trend: 'bullish',        signal: 'pullback_watch', confidence: 0.65 },
      '15m': { trend: 'neutral_bullish', signal: 'no_trade', confidence: 0.50 }, // lower TF, ignored
    },
  });
  assert.strictEqual(result.mtfAlignment, 'aligned', '4h + 1d bullish → aligned');
  assert.strictEqual(result.confirmingCount, 2, 'two confirming higher TFs');
  assert.ok(result.confidenceAdjustment > 0, 'aligned → positive adjustment');
  console.log(`✓ computeMtfQualification: full alignment → adj ${result.confidenceAdjustment}`);
}

// ── computeMtfQualification — conflicting ────────────────────────────────

{
  const result = computeMtfQualification({
    baseTimeframe: '1h',
    baseSignal: 'pullback_watch',
    mtfResults: {
      '4h': { trend: 'bearish', signal: 'bearish_breakdown_watch', confidence: 0.65 },
    },
  });
  assert.strictEqual(result.mtfAlignment, 'conflicting', '4h bearish + 1h bullish → conflicting');
  assert.ok(result.confidenceAdjustment < 0, 'conflicting → negative adjustment');
  console.log(`✓ computeMtfQualification: conflicting → adj ${result.confidenceAdjustment}`);
}

// ── computeMtfQualification — only lower TFs present ──────────────────────

{
  const result = computeMtfQualification({
    baseTimeframe: '4h',
    baseSignal: 'pullback_watch',
    mtfResults: {
      '1h':  { trend: 'bullish', signal: 'pullback_watch', confidence: 0.60 },  // lower TF → ignored
      '15m': { trend: 'strong_bullish', signal: 'breakout_watch', confidence: 0.75 }, // lower TF → ignored
    },
  });
  assert.strictEqual(result.mtfAlignment, 'neutral', 'only lower TFs → neutral');
  assert.strictEqual(result.higherTfCount, 0, 'only lower TFs → higherTfCount 0');
  console.log('✓ computeMtfQualification: only lower TFs present → neutral');
}

console.log('\n✅ All mtfQualification.test.js tests passed\n');
