'use strict';

/**
 * Confidence scoring helpers.
 *
 * Computes a data-quality assessment and adjusts confidence based on
 * how complete the indicator and structural data is.
 */

/**
 * Assess data quality based on which indicators were successfully calculated.
 *
 * @param {object} indicators - Result of indicator calculations
 * @param {object} trendlineState
 * @param {object} zoneState
 * @param {number} candleCount
 * @returns {{ score: 'good'|'fair'|'poor', warnings: string[] }}
 */
function assessDataQuality({ indicators, trendlineState, zoneState, candleCount }) {
  const warnings = [];
  let penaltyPoints = 0;

  // Core MA availability
  if (indicators.ema20  == null || isNaN(indicators.ema20))  { warnings.push('EMA20 indisponível.'); penaltyPoints++; }
  if (indicators.ema50  == null || isNaN(indicators.ema50))  { warnings.push('EMA50 indisponível.'); penaltyPoints++; }
  if (indicators.ema200 == null || isNaN(indicators.ema200)) { warnings.push('EMA200 indisponível (histórico provavelmente insuficiente).'); penaltyPoints += 2; }
  if (indicators.ma200  == null || isNaN(indicators.ma200))  { warnings.push('MA200 indisponível.'); penaltyPoints++; }

  // RSI
  if (indicators.rsi14  == null || isNaN(indicators.rsi14))  { warnings.push('RSI14 indisponível.'); penaltyPoints++; }

  // ATR
  if (indicators.atr14  == null || isNaN(indicators.atr14))  { warnings.push('ATR14 indisponível — contexto de volatilidade limitado.'); penaltyPoints++; }

  // Structure
  if (trendlineState && trendlineState.activeTrendlineType === 'none') {
    warnings.push('Sem estrutura de trendline detectada — histórico de pivôs insuficiente.');
    penaltyPoints++;
  }

  // Raw candle count
  if (candleCount < 100) {
    warnings.push(`Apenas ${candleCount} candles disponíveis — indicadores de longo período podem ser imprecisos.`);
    penaltyPoints += 2;
  }

  let score;
  if (penaltyPoints === 0)      score = 'good';
  else if (penaltyPoints <= 3)  score = 'fair';
  else                          score = 'poor';

  return { score, warnings };
}

/**
 * Adjust a base confidence value downward based on data quality.
 *
 * @param {number} baseConfidence - 0 to 1
 * @param {'good'|'fair'|'poor'} qualityScore
 * @returns {number}
 */
function adjustConfidence(baseConfidence, qualityScore) {
  const factors = { good: 1.0, fair: 0.85, poor: 0.65 };
  const factor = factors[qualityScore] || 0.65;
  return Math.round(baseConfidence * factor * 100) / 100;
}

module.exports = { assessDataQuality, adjustConfidence };
