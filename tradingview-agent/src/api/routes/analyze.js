'use strict';

const { Router } = require('express');

const { analyzeMarket } = require('../../tools/analyzeMarket');
const logger = require('../../logger');

const {
  SymbolNotFoundError,
  AmbiguousSymbolError,
  UnsupportedTimeframeError,
  CandleFetchTimeoutError,
  InsufficientCandlesError,
} = require('../../adapters/tradingview/errors');

const router = Router();

/**
 * POST /analyze
 *
 * Body (JSON):
 *   {
 *     query:     string   — symbol name or search query (required)
 *     timeframe: string   — timeframe label, e.g. "1h" (required)
 *     options:   object   — passed to analyzeMarket (optional)
 *   }
 *
 * Responses:
 *   200  — analysis result object
 *   400  — invalid or missing input fields, unsupported timeframe, symbol not found
 *   408  — candle fetch timeout
 *   422  — insufficient candles (symbol found, data unusable)
 *   500  — unexpected internal error
 */
router.post('/', async (req, res) => {
  const { query, timeframe, options } = req.body || {};

  // --- Input validation ---
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({
      error: 'query is required and must be a non-empty string',
      code:  'invalid_input',
    });
  }

  if (!timeframe || typeof timeframe !== 'string' || timeframe.trim() === '') {
    return res.status(400).json({
      error: 'timeframe is required and must be a non-empty string',
      code:  'invalid_input',
    });
  }

  const cleanQuery     = query.trim();
  const cleanTimeframe = timeframe.trim();

  logger.info('api.analyze.request', { query: cleanQuery, timeframe: cleanTimeframe });

  try {
    const result = await analyzeMarket({
      query:     cleanQuery,
      timeframe: cleanTimeframe,
      options:   options && typeof options === 'object' ? options : {},
    });

    logger.info('api.analyze.success', {
      query:      cleanQuery,
      timeframe:  cleanTimeframe,
      symbol:     result.symbol,
      signal:     result.signal,
      confidence: result.confidence,
    });

    return res.json(result);

  } catch (err) {
    // 400 — caller-correctable errors
    if (
      err instanceof SymbolNotFoundError  ||
      err instanceof AmbiguousSymbolError ||
      err instanceof UnsupportedTimeframeError
    ) {
      logger.warn('api.analyze.client_error', {
        query:     cleanQuery,
        timeframe: cleanTimeframe,
        error:     err.message,
        code:      err.code || err.constructor.name,
      });
      return res.status(400).json({ error: err.message, code: err.code || 'invalid_input' });
    }

    // Validation errors thrown by validateAnalyzeParams (plain Error with descriptive message)
    if (err.message && /required|unsupported/i.test(err.message) && !(err.code)) {
      logger.warn('api.analyze.client_error', {
        query: cleanQuery, timeframe: cleanTimeframe, error: err.message,
      });
      return res.status(400).json({ error: err.message, code: 'invalid_input' });
    }

    // 408 — timeout
    if (err instanceof CandleFetchTimeoutError) {
      logger.warn('api.analyze.timeout', {
        query: cleanQuery, timeframe: cleanTimeframe, error: err.message,
      });
      return res.status(408).json({ error: err.message, code: err.code || 'candle_fetch_timeout' });
    }

    // 422 — data unusable
    if (err instanceof InsufficientCandlesError) {
      logger.warn('api.analyze.insufficient_data', {
        query: cleanQuery, timeframe: cleanTimeframe, error: err.message,
      });
      return res.status(422).json({ error: err.message, code: err.code || 'insufficient_candles' });
    }

    // 500 — unexpected
    logger.error('api.analyze.failure', {
      query:     cleanQuery,
      timeframe: cleanTimeframe,
      error:     err.message,
    });
    return res.status(500).json({ error: 'Internal server error', code: 'internal_error' });
  }
});

module.exports = router;
