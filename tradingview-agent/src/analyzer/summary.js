'use strict';

/**
 * Geração de resumo em PT-BR para resultados de análise.
 *
 * Produz um resumo estruturado, legível em mobile, adequado para uso por um
 * agente de IA ao formular uma resposta em linguagem natural ou via Telegram.
 *
 * Estrutura do output (single-timeframe):
 *   SYMBOL · TF · $PRICE
 *
 *   Tendência: X  |  Momentum: Y
 *   RSI X · Volume Y · Volatilidade Z
 *
 *   [Structure line — trendline/zone context]
 *
 *   Sinal: LABEL
 *   Confiança: PHRASE
 *   Observação: SHORT QUALIFIER.
 *
 *   [Invalidação: ...]
 *   [Alvos: ...]
 *
 *   Leitura: PRACTICAL PARAGRAPH.
 */

// ─── Mapeamentos PT-BR (sentence case) ───────────────────────────────────────
// Os valores internos das máquinas (trend, momentum, signal, etc.) permanecem
// inalterados — apenas a representação visual é traduzida aqui.

const TREND_PT = {
  strong_bullish:  'Fortemente altista',
  bullish:         'Altista',
  neutral_bullish: 'Levemente altista',
  neutral:         'Neutro',
  neutral_bearish: 'Levemente baixista',
  bearish:         'Baixista',
  strong_bearish:  'Fortemente baixista',
  unknown:         'Indefinido',
};

const MOMENTUM_PT = {
  overextended_bullish: 'Altista esticado',
  bullish:              'Altista',
  neutral_bullish:      'Levemente altista',
  neutral:              'Neutro',
  neutral_bearish:      'Levemente baixista',
  bearish:              'Baixista',
  oversold_bearish:     'Baixista em sobrevenda',
  unknown:              'Indefinido',
};

const SIGNAL_PT = {
  breakout_watch:          'Monitorar rompimento',
  pullback_watch:          'Monitorar pullback',
  bearish_breakdown_watch: 'Monitorar rompimento baixista',
  no_trade:                'Sem setup claro',
};

const VOLUME_PT = {
  very_low:  'muito baixo',
  low:       'baixo',
  average:   'médio',
  high:      'alto',
  very_high: 'muito alto',
};

const VOLATILITY_PT = {
  very_low: 'muito baixa',
  low:      'baixa',
  moderate: 'moderada',
  high:     'alta',
  extreme:  'extrema',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a price number with context-appropriate decimal precision.
 * @param {number} price
 * @returns {string}
 */
function formatPrice(price) {
  if (price == null || isNaN(price)) return '—';
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1)    return price.toFixed(4);
  return price.toFixed(6);
}

/**
 * Phrase confidence as a natural PT-BR label with raw percentage in parentheses.
 * @param {number} confidence - 0–1
 * @returns {string}
 */
function phraseConfidence(confidence) {
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.75) return `alta (${pct}%)`;
  if (confidence >= 0.65) return `moderada/alta (${pct}%)`;
  if (confidence >= 0.55) return `moderada (${pct}%)`;
  if (confidence >= 0.45) return `baixa (${pct}%)`;
  return `muito baixa (${pct}%)`;
}

/**
 * Return a short contextual qualifier for the Observação line.
 * Adapts by signal type and volume state.
 * @param {string} signal
 * @param {string} volumeState
 * @param {string} trend
 * @param {string} momentum
 * @returns {string|null}
 */
function qualifySignal(signal, volumeState, trend, momentum) {
  const highVol = volumeState === 'high' || volumeState === 'very_high';
  const lowVol  = volumeState === 'very_low' || volumeState === 'low';

  switch (signal) {
    case 'breakout_watch':
      if (highVol) return 'rompimento com suporte de volume';
      if (lowVol)  return 'rompimento com volume fraco, aguardando confirmação';
      return 'rompimento em desenvolvimento';

    case 'pullback_watch':
      if (highVol) return 'pullback com volume elevado, aguardar estabilização';
      return 'pullback em zona de suporte, estrutura altista preservada';

    case 'bearish_breakdown_watch':
      if (highVol) return 'rompimento baixista confirmado pelo volume';
      return 'rompimento baixista em desenvolvimento, aguardar confirmação';

    case 'no_trade':
      if (trend === 'neutral') return 'tendência indefinida, aguardar definição direcional';
      if (momentum === 'neutral' || momentum === 'neutral_bullish' || momentum === 'neutral_bearish') {
        return 'momentum insuficiente para setup de entrada';
      }
      return 'sem confluência suficiente para entrada';

    default:
      return null;
  }
}

/**
 * Build a one or two sentence practical reading for the trader.
 * Adapts by signal, volume, and confidence level.
 * @returns {string|null}
 */
function buildFinalReading({ signal, volumeState, confidence, trend, momentum }) {
  const highVol  = volumeState === 'high' || volumeState === 'very_high';
  const lowVol   = volumeState === 'very_low' || volumeState === 'low';
  const highConf = confidence >= 0.70;
  const lowConf  = confidence < 0.55;

  switch (signal) {
    case 'breakout_watch':
      if (lowVol)
        return 'Volume fraco sugere cautela. Aguardar vela de fechamento acima da resistência com expansão de volume antes de qualquer entrada.';
      if (highVol && highConf)
        return 'Volume confirma o rompimento. Gerenciar risco com stop abaixo do nível rompido.';
      if (highVol)
        return 'Volume confirma o rompimento. Aguardar continuação antes de entrada.';
      return 'Rompimento em desenvolvimento. Acompanhar a próxima vela para validar a direção.';

    case 'pullback_watch':
      if (highVol)
        return 'Volume elevado no pullback — aguardar sinal de estabilização na zona de suporte antes de entrada.';
      if (lowConf)
        return 'Estrutura de fundo preservada, mas setup ainda fraco. Aguardar melhor confluência antes de qualquer posicionamento.';
      return 'Tendência de fundo preservada. Aguardar sinal de retomada na zona de suporte para entrada com stops definidos.';

    case 'bearish_breakdown_watch':
      if (highVol)
        return 'Volume confirma a pressão vendedora. Possível continuação baixista se o nível rompido se tornar resistência.';
      return 'Rompimento sem força de volume. Aguardar confirmação de continuação baixista antes de qualquer posicionamento.';

    case 'no_trade':
      if (trend === 'neutral')
        return 'Sem definição direcional. Aguardar rompimento do range com volume para posicionamento.';
      if (momentum === 'neutral' || momentum === 'neutral_bullish' || momentum === 'neutral_bearish')
        return 'Estrutura de fundo intacta, mas sem momentum de entrada. Aguardar o momentum confirmar a direção.';
      return 'Setup sem confluência suficiente. Revisar em timeframe maior ou aguardar clareza direcional.';

    default:
      return null;
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a structured PT-BR summary string from classified analysis components.
 *
 * @param {object} params
 * @param {string} params.symbol
 * @param {string} params.timeframe
 * @param {number} params.price
 * @param {string} params.trend
 * @param {string} params.momentum
 * @param {string} params.signal
 * @param {number} params.confidence
 * @param {string} params.volumeState
 * @param {string} params.volatilityState
 * @param {object} params.indicators
 * @param {object|null} params.trendlineState
 * @param {object|null} params.zoneState
 * @param {string[]} params.targets
 * @param {string|null} params.invalidation
 * @returns {string}
 */
function buildSummary({
  symbol,
  timeframe,
  price,
  trend,
  momentum,
  signal,
  confidence,
  volumeState,
  volatilityState,
  indicators,
  trendlineState,
  zoneState,
  targets,
  invalidation,
}) {
  const lines = [];

  // 1. Header: SYMBOL · TF · $PRICE
  lines.push(`${symbol} · ${timeframe.toUpperCase()} · $${formatPrice(price)}`);

  // 2. Tendência + Momentum
  lines.push('');
  const trendLabel    = TREND_PT[trend]    || trend;
  const momentumLabel = MOMENTUM_PT[momentum] || momentum;
  lines.push(`Tendência: ${trendLabel}  |  Momentum: ${momentumLabel}`);

  // 3. RSI · Volume · Volatilidade
  const rsiStr = indicators.rsi14 != null && !isNaN(indicators.rsi14)
    ? `RSI ${indicators.rsi14.toFixed(1)}`
    : null;
  const volStr = volumeState !== 'unknown'
    ? `Volume ${VOLUME_PT[volumeState] || volumeState}`
    : null;
  const atrStr = volatilityState !== 'unknown'
    ? `Volatilidade ${VOLATILITY_PT[volatilityState] || volatilityState}`
    : null;
  const ctxParts = [rsiStr, volStr, atrStr].filter(Boolean);
  if (ctxParts.length > 0) lines.push(ctxParts.join(' · '));

  // 4. Structure lines (trendline + zone context)
  const structureLines = [];
  if (trendlineState && trendlineState.explanation) {
    structureLines.push(trendlineState.explanation);
  }
  if (zoneState && zoneState.zoneType !== 'none' && zoneState.explanation) {
    structureLines.push(zoneState.explanation);
  }
  if (structureLines.length > 0) {
    lines.push('');
    for (const s of structureLines) lines.push(s);
  }

  // 5. Signal block
  lines.push('');
  const signalLabel = SIGNAL_PT[signal] || signal;
  const qualifier   = qualifySignal(signal, volumeState, trend, momentum);
  const confPhrase  = phraseConfidence(confidence);
  lines.push(`Sinal: ${signalLabel}`);
  lines.push(`Confiança: ${confPhrase}`);
  if (qualifier) lines.push(`Observação: ${qualifier}.`);

  // 6. Invalidation + targets (only when present)
  if (invalidation || (targets && targets.length > 0)) {
    lines.push('');
    if (invalidation)               lines.push(`Invalidação: ${invalidation}`);
    if (targets && targets.length > 0) lines.push(`Alvos: ${targets.join(' | ')}`);
  }

  // 7. Final practical reading
  const reading = buildFinalReading({ signal, volumeState, confidence, trend, momentum });
  if (reading) {
    lines.push('');
    lines.push(`Leitura: ${reading}`);
  }

  return lines.join('\n');
}

module.exports = {
  buildSummary,
  phraseConfidence,
  qualifySignal,
  formatPrice,
  buildFinalReading,
  TREND_PT,
  MOMENTUM_PT,
  SIGNAL_PT,
  VOLUME_PT,
  VOLATILITY_PT,
};
