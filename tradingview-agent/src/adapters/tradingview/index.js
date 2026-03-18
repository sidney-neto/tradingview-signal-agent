'use strict';

const { resolveSymbol, searchSymbols } = require('./symbolSearch');
const { fetchCandles }                  = require('./candles');
const { normalizePeriods, normalizeSymbol } = require('./normalize');
const errors = require('./errors');

module.exports = {
  resolveSymbol,
  searchSymbols,
  fetchCandles,
  normalizePeriods,
  normalizeSymbol,
  errors,
};
