'use strict';

/**
 * Pattern output shape factory and shared constants.
 *
 * Every detected pattern is normalized to the same schema so callers
 * never need to branch on pattern type to read key fields.
 */

const PATTERN_TYPES = {
  HEAD_AND_SHOULDERS:     'head_and_shoulders',
  INV_HEAD_AND_SHOULDERS: 'inv_head_and_shoulders',
  DOUBLE_TOP:             'double_top',
  DOUBLE_BOTTOM:          'double_bottom',
  ASCENDING_TRIANGLE:     'ascending_triangle',
  DESCENDING_TRIANGLE:    'descending_triangle',
  SYMMETRICAL_TRIANGLE:   'symmetrical_triangle',
  FLAG_BULL:              'flag_bull',
  FLAG_BEAR:              'flag_bear',
  PENNANT_BULL:           'pennant_bull',
  PENNANT_BEAR:           'pennant_bear',
  RISING_WEDGE:           'rising_wedge',
  FALLING_WEDGE:          'falling_wedge',
  CUP_AND_HANDLE:         'cup_and_handle',
  RECTANGLE:              'rectangle',
};

const DISPLAY_NAMES = {
  head_and_shoulders:     'OCO (Ombro-Cabeça-Ombro)',
  inv_head_and_shoulders: 'OCO Invertido',
  double_top:             'Topo Duplo',
  double_bottom:          'Fundo Duplo',
  ascending_triangle:     'Triângulo Ascendente',
  descending_triangle:    'Triângulo Descendente',
  symmetrical_triangle:   'Triângulo Simétrico',
  flag_bull:              'Bandeira Altista',
  flag_bear:              'Bandeira Baixista',
  pennant_bull:           'Flâmula Altista',
  pennant_bear:           'Flâmula Baixista',
  rising_wedge:           'Cunha Ascendente',
  falling_wedge:          'Cunha Descendente',
  cup_and_handle:         'Xícara e Alça',
  rectangle:              'Retângulo / Range',
};

const BIAS = {
  BULLISH: 'bullish',
  BEARISH: 'bearish',
  NEUTRAL: 'neutral',
};

const STATUS = {
  FORMING:       'forming',
  NEAR_BREAKOUT: 'near_breakout',
  CONFIRMED:     'confirmed',
  INVALIDATED:   'invalidated',
};

/**
 * Create a normalized pattern output object.
 *
 * @param {object} fields
 * @returns {object}
 */
function makePattern({
  type,
  bias,
  status,
  confidence,
  quality,
  timeframe,
  startIndex,
  endIndex,
  keyLevels = {},
  breakoutLevel = null,
  invalidationLevel = null,
  explanation = '',
}) {
  return {
    type,
    displayName:      DISPLAY_NAMES[type] || type,
    bias,
    status,
    confidence:       round2(Math.min(1, Math.max(0, confidence))),
    quality:          round2(Math.min(1, Math.max(0, quality))),
    timeframe:        timeframe || null,
    startIndex,
    endIndex,
    keyLevels,
    breakoutLevel,
    invalidationLevel,
    explanation,
    source:           'pattern_detector',
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { PATTERN_TYPES, DISPLAY_NAMES, BIAS, STATUS, makePattern };
