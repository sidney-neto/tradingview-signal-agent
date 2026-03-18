'use strict';

/**
 * Multi-timeframe summary formatter (PT-BR).
 *
 * Takes an ordered array of analyzeMarket() results (shortest → longest timeframe)
 * and produces a structured PT-BR multi-timeframe response block.
 *
 * Usage:
 *   const { buildMTFSummary } = require('../analyzer/formatMTF');
 *   const text = buildMTFSummary([result1h, result4h, result1d]);
 *
 * Output structure:
 *   SYMBOL · Leitura multi-timeframe
 *
 *   Visão geral:
 *   1H  — Altista · Monitorar rompimento · moderada (65%)
 *   4H  — Altista · Monitorar rompimento · moderada/alta (72%)
 *   1D  — Altista · Sem setup claro · baixa (50%)
 *
 *   ── 1H ──
 *   Tendência: Altista  |  Momentum: Levemente altista
 *   RSI 55.2 · Volume médio · Volatilidade moderada
 *   Sinal: Monitorar rompimento  ·  Confiança: moderada (65%)
 *   ...
 *
 *   Leitura multi-timeframe:
 *   Alinhamento altista nos três timeframes. O 4H é o timeframe de referência.
 *
 *   Níveis críticos:
 *   EMA50 no 4H: $14.2500 — suporte de médio prazo
 *   Invalidação global: ...
 */

const {
  TREND_PT,
  MOMENTUM_PT,
  SIGNAL_PT,
  VOLUME_PT,
  VOLATILITY_PT,
  phraseConfidence,
  formatPrice,
} = require('./summary');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BULLISH_TRENDS  = new Set(['strong_bullish', 'bullish', 'neutral_bullish']);
const BEARISH_TRENDS  = new Set(['strong_bearish', 'bearish', 'neutral_bearish']);
const BULLISH_SIGNALS = new Set(['breakout_watch', 'pullback_watch']);
const BEARISH_SIGNALS = new Set(['bearish_breakdown_watch']);

/**
 * Generate cross-timeframe interpretation text.
 * @param {object[]} results
 * @returns {string}
 */
function buildMTFInterpretation(results) {
  const allBullish = results.every((r) => BULLISH_TRENDS.has(r.trend));
  const allBearish = results.every((r) => BEARISH_TRENDS.has(r.trend));

  const bullishCount = results.filter((r) => BULLISH_SIGNALS.has(r.signal)).length;
  const bearishCount = results.filter((r) => BEARISH_SIGNALS.has(r.signal)).length;
  const noTradeCount = results.filter((r) => r.signal === 'no_trade').length;

  const shortest = results[0];
  const longest  = results[results.length - 1];

  // Leading TF: longest with a non-no_trade signal, fallback to longest overall
  const leader   = [...results].reverse().find((r) => r.signal !== 'no_trade') || longest;
  const leaderTF = leader.timeframe.toUpperCase();

  const sentences = [];

  // Overall alignment
  if (allBullish && bullishCount >= results.length - 1) {
    sentences.push('Alinhamento altista em todos os timeframes analisados.');
  } else if (allBearish && bearishCount >= results.length - 1) {
    sentences.push('Alinhamento baixista em todos os timeframes analisados.');
  } else if (bullishCount > 0 && bearishCount > 0) {
    sentences.push('Timeframes com leituras divergentes — atenção ao conflito entre tendências.');
  } else if (allBullish && noTradeCount > 0) {
    sentences.push('Estrutura de fundo altista com timeframes menores ainda sem setup definido.');
  } else if (allBearish && noTradeCount > 0) {
    sentences.push('Estrutura de fundo baixista com timeframes menores ainda sem setup definido.');
  } else {
    sentences.push('Timeframes com leituras mistas.');
  }

  sentences.push(`O ${leaderTF} é o timeframe de referência no momento.`);

  // Cross-TF conflict between shortest and longest
  if (BEARISH_TRENDS.has(shortest.trend) && BULLISH_TRENDS.has(longest.trend)) {
    sentences.push(
      `Pressão baixista de curto prazo (${shortest.timeframe.toUpperCase()}) ` +
      `contra estrutura altista de longo prazo (${longest.timeframe.toUpperCase()}) — aguardar resolução.`
    );
  } else if (BULLISH_TRENDS.has(shortest.trend) && BEARISH_TRENDS.has(longest.trend)) {
    sentences.push(
      `Recuperação de curto prazo (${shortest.timeframe.toUpperCase()}) ` +
      `contra tendência baixista de longo prazo (${longest.timeframe.toUpperCase()}).`
    );
  }

  // Confirmation context
  if (shortest.signal !== 'no_trade' && longest.signal === 'no_trade') {
    sentences.push(
      `${longest.timeframe.toUpperCase()} ainda sem setup — setup de curto prazo precisa de confirmação no timeframe maior.`
    );
  } else if (shortest.signal === 'no_trade' && longest.signal !== 'no_trade') {
    sentences.push(
      `${shortest.timeframe.toUpperCase()} sem setup — aguardar o timeframe menor confirmar a direção.`
    );
  }

  return sentences.join(' ');
}

/**
 * Extract critical levels from the reference (longest) timeframe.
 * @param {object[]} results
 * @returns {string[]}
 */
function buildCriticalLevels(results) {
  const ref = results[results.length - 1];
  if (!ref || !ref.indicators) return [];

  const lines = [];
  const tf = ref.timeframe.toUpperCase();
  const { ema50, ema200 } = ref.indicators;

  if (ema50)  lines.push(`EMA50 no ${tf}: $${formatPrice(ema50)} — suporte de médio prazo`);
  if (ema200) lines.push(`EMA200 no ${tf}: $${formatPrice(ema200)} — suporte estrutural`);
  if (ref.invalidation) lines.push(`Invalidação global: ${ref.invalidation}`);

  return lines;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a structured PT-BR multi-timeframe summary block.
 *
 * @param {object[]} results - Ordered array of analyzeMarket() results (shortest → longest TF)
 * @returns {string}
 */
function buildMTFSummary(results) {
  if (!results || results.length === 0) return '';

  const symbol = results[0].symbol;
  const lines  = [];

  // Header
  lines.push(`${symbol} · Leitura multi-timeframe`);

  // Overview table
  lines.push('');
  lines.push('Visão geral:');
  for (const r of results) {
    const tf     = r.timeframe.toUpperCase();
    const trend  = TREND_PT[r.trend]   || r.trend;
    const signal = SIGNAL_PT[r.signal] || r.signal;
    const conf   = phraseConfidence(r.confidence);
    lines.push(`${tf}  — ${trend} · ${signal} · ${conf}`);
  }

  // Per-TF mini-blocks
  for (const r of results) {
    const tf       = r.timeframe.toUpperCase();
    const trend    = TREND_PT[r.trend]    || r.trend;
    const momentum = MOMENTUM_PT[r.momentum] || r.momentum;
    const signal   = SIGNAL_PT[r.signal]  || r.signal;
    const conf     = phraseConfidence(r.confidence);

    const rsiStr = r.indicators && r.indicators.rsi14 != null
      ? `RSI ${r.indicators.rsi14.toFixed(1)}`
      : null;
    const volStr = r.volumeState && r.volumeState !== 'unknown'
      ? `Volume ${VOLUME_PT[r.volumeState] || r.volumeState}`
      : null;
    const atrStr = r.volatilityState && r.volatilityState !== 'unknown'
      ? `Volatilidade ${VOLATILITY_PT[r.volatilityState] || r.volatilityState}`
      : null;
    const ctxParts = [rsiStr, volStr, atrStr].filter(Boolean);

    lines.push('');
    lines.push(`── ${tf} ──`);
    lines.push(`Tendência: ${trend}  |  Momentum: ${momentum}`);
    if (ctxParts.length > 0) lines.push(ctxParts.join(' · '));
    lines.push(`Sinal: ${signal}  ·  Confiança: ${conf}`);
  }

  // Cross-TF interpretation
  lines.push('');
  lines.push('Leitura multi-timeframe:');
  lines.push(buildMTFInterpretation(results));

  // Critical levels
  const criticalLevels = buildCriticalLevels(results);
  if (criticalLevels.length > 0) {
    lines.push('');
    lines.push('Níveis críticos:');
    for (const l of criticalLevels) lines.push(l);
  }

  return lines.join('\n');
}

module.exports = { buildMTFSummary };
