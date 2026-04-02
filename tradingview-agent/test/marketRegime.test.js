'use strict';

const assert = require('assert');
const { computeMarketRegime } = require('../src/analyzer/marketRegime');

// ── No data → neutral ────────────────────────────────────────────────────────

{
  const r = computeMarketRegime({});
  assert.strictEqual(r.regime, 'neutral', 'no data → neutral regime');
  assert.strictEqual(r.available, false, 'no data → available false');
  assert.strictEqual(r.btcStructure, null, 'no data → btcStructure null');
  assert.strictEqual(r.fearGreedState, null, 'no data → fearGreedState null');
  console.log('✓ marketRegime: no data → neutral');
}

// ── Breadth regime ───────────────────────────────────────────────────────────

{
  const r = computeMarketRegime({
    marketBreadthContext: { regime: 'risk_on', gainersPercent: 68 },
  });
  assert.strictEqual(r.regime, 'risk_on', 'risk_on breadth → risk_on regime');
  assert.strictEqual(r.available, true, 'breadth data → available true');
  console.log('✓ marketRegime: risk_on breadth → risk_on');
}

{
  const r = computeMarketRegime({
    marketBreadthContext: { regime: 'risk_off', gainersPercent: 28 },
  });
  assert.strictEqual(r.regime, 'risk_off', 'risk_off breadth → risk_off regime');
  console.log('✓ marketRegime: risk_off breadth → risk_off');
}

// ── Fear & Greed ─────────────────────────────────────────────────────────────

{
  const r = computeMarketRegime({
    macroContext: { fearGreed: { value: 18 }, bitcoinDominance: null, altcoinSeason: null },
  });
  assert.strictEqual(r.fearGreedState, 'extreme_fear', 'F&G 18 → extreme_fear');
  assert.strictEqual(r.regime, 'risk_off', 'extreme_fear → risk_off regime');
  console.log('✓ marketRegime: extreme fear → risk_off');
}

{
  const r = computeMarketRegime({
    macroContext: { fearGreed: { value: 78 }, bitcoinDominance: null, altcoinSeason: null },
  });
  assert.strictEqual(r.fearGreedState, 'extreme_greed', 'F&G 78 → extreme_greed');
  // extreme_greed alone → 'overheated' signal, not risk_on
  assert.ok(['neutral', 'overheated'].includes(r.regime), 'extreme_greed → overheated or neutral (not risk_on)');
  console.log('✓ marketRegime: extreme greed → overheated');
}

// ── BTC dominance ────────────────────────────────────────────────────────────

{
  const r = computeMarketRegime({
    macroContext: { fearGreed: null, bitcoinDominance: 58, altcoinSeason: null },
  });
  assert.strictEqual(r.btcStructure, 'dominant', 'BTC.D 58% → dominant');
  assert.strictEqual(r.regime, 'risk_off', 'high BTC.D → risk_off');
  console.log('✓ marketRegime: high BTC.D → dominant + risk_off');
}

{
  const r = computeMarketRegime({
    macroContext: { fearGreed: null, bitcoinDominance: 43, altcoinSeason: null },
  });
  assert.strictEqual(r.btcStructure, 'declining', 'BTC.D 43% → declining');
  assert.strictEqual(r.regime, 'risk_on', 'low BTC.D → risk_on');
  console.log('✓ marketRegime: low BTC.D → declining + risk_on');
}

// ── Altcoin season ────────────────────────────────────────────────────────────

{
  const r = computeMarketRegime({
    macroContext: { fearGreed: null, bitcoinDominance: null, altcoinSeason: 82 },
  });
  assert.strictEqual(r.altcoinConditions, 'favorable', 'alt season 82 → favorable');
  assert.strictEqual(r.regime, 'risk_on', 'alt season → risk_on');
  console.log('✓ marketRegime: altcoin season → favorable + risk_on');
}

// ── Multiple signals: majority wins ──────────────────────────────────────────

{
  const r = computeMarketRegime({
    marketBreadthContext: { regime: 'risk_off', gainersPercent: 30 },
    macroContext: { fearGreed: { value: 22 }, bitcoinDominance: 58, altcoinSeason: 20 },
  });
  assert.strictEqual(r.regime, 'risk_off', 'multiple risk_off signals → risk_off');
  assert.ok(r.reasons.length >= 3, 'multiple reasons listed');
  console.log(`✓ marketRegime: multiple risk_off signals → ${r.regime}, ${r.reasons.length} reasons`);
}

// ── Mixed signals → neutral ───────────────────────────────────────────────────

{
  const r = computeMarketRegime({
    marketBreadthContext: { regime: 'risk_on', gainersPercent: 62 },
    macroContext: { fearGreed: { value: 30 }, bitcoinDominance: 56, altcoinSeason: null },
  });
  // risk_on breadth vs high BTC.D risk_off = mixed → neutral
  assert.strictEqual(r.regime, 'neutral', 'mixed signals → neutral');
  console.log('✓ marketRegime: mixed signals → neutral');
}

// ── Perpcontext fields used when macroContext absent ─────────────────────────

{
  const r = computeMarketRegime({
    perpContext: { fearGreedIndex: 20, btcDominance: null, altcoinIndex: null },
  });
  assert.strictEqual(r.fearGreedState, 'extreme_fear', 'perpContext.fearGreedIndex used as fallback');
  console.log('✓ marketRegime: perpContext.fearGreedIndex as fallback');
}

console.log('\n✅ All marketRegime.test.js tests passed\n');
