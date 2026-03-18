'use strict';

/**
 * OpenClaw-ready tool wrapper for analyzeMarket.
 *
 * This module provides the function boundary and normalized I/O contract
 * between an OpenClaw agent and the tradingview-agent analysis pipeline.
 *
 * RESPONSIBILITIES OF THIS MODULE
 * --------------------------------
 * - Accept the simple input shape an OpenClaw tool call will provide
 * - Normalize inputs (lowercase, trim, alias resolution)
 * - Call analyzeMarket()
 * - Return a normalized structured result
 * - Catch and normalize domain errors into structured error objects
 *   so the OpenClaw agent receives a consistent shape on both success and failure
 *
 * RESPONSIBILITIES OF THE OPENCLAW AGENT (NOT in this module)
 * -----------------------------------------------------------
 * - Natural-language interpretation of user intent
 * - Deciding when to call this tool
 * - Turning the structured result into a conversational reply
 * - Managing conversation context and memory
 *
 * USAGE
 * -----
 * const { runAnalyzeTool } = require('./openclawAnalyzeMarket');
 *
 * // Success:
 * const result = await runAnalyzeTool({ query: 'btc', timeframe: '15m' });
 * // result.ok === true
 * // result.data === { ...full analysis object }
 *
 * // Failure:
 * const result = await runAnalyzeTool({ query: '???', timeframe: '99x' });
 * // result.ok === false
 * // result.error === { type, message, details }
 */

const { analyzeMarket } = require('./analyzeMarket');
const errors = require('../adapters/tradingview/errors');
const { getSupportedTimeframes } = require('../utils/timeframes');

/**
 * Tool input shape — what an OpenClaw agent passes in.
 *
 * @typedef {object} AnalyzeToolInput
 * @property {string} query         - Symbol name or search query, e.g. "btc", "AAPL", "BINANCE:BTCUSDT"
 * @property {string} [symbolId]    - Optional exact exchange-qualified id; skips search if provided
 * @property {string} timeframe     - Timeframe label, e.g. "15m", "1h", "4h", "1d"
 * @property {object} [options]     - Optional pass-through to analyzeMarket options
 */

/**
 * Tool success result shape.
 *
 * @typedef {object} AnalyzeToolSuccess
 * @property {true} ok
 * @property {object} data          - Full analyzeMarket() result
 * @property {string} toolVersion   - Tool version string for OpenClaw bookkeeping
 */

/**
 * Tool error result shape.
 *
 * @typedef {object} AnalyzeToolError
 * @property {false} ok
 * @property {{ type: string, message: string, details: object|null }} error
 * @property {string} toolVersion
 */

const TOOL_VERSION = '1.0.0';

/**
 * Normalize raw tool input before passing to the analysis pipeline.
 * Handles casing, whitespace, and the optional symbolId override.
 *
 * @param {AnalyzeToolInput} input
 * @returns {{ query: string, timeframe: string, options: object }}
 */
function normalizeInput({ query, symbolId, timeframe, options = {} }) {
  // If caller provides a pre-resolved symbolId, use it as the query directly.
  // This avoids an unnecessary searchMarketV3 round-trip when the agent already
  // knows the exact exchange-qualified id from a previous call.
  const resolvedQuery = (symbolId || query || '').trim();
  const resolvedTimeframe = (timeframe || '').trim().toLowerCase();

  return { query: resolvedQuery, timeframe: resolvedTimeframe, options };
}

/**
 * Map a caught error to a normalized error descriptor.
 * All domain errors from the adapter layer are handled explicitly.
 * Unknown errors are wrapped with a generic message.
 *
 * @param {Error} err
 * @returns {{ type: string, message: string, details: object|null }}
 */
function normalizeError(err) {
  if (err instanceof errors.SymbolNotFoundError) {
    return {
      type:    'symbol_not_found',
      message: err.message,
      details: { query: err.query },
    };
  }
  if (err instanceof errors.AmbiguousSymbolError) {
    return {
      type:    'ambiguous_symbol',
      message: err.message,
      details: {
        query:      err.query,
        candidates: (err.candidates || []).slice(0, 5).map((c) => c.id || c.symbol),
      },
    };
  }
  if (err instanceof errors.UnsupportedTimeframeError) {
    return {
      type:    'unsupported_timeframe',
      message: err.message,
      details: {
        provided:  err.timeframe,
        supported: getSupportedTimeframes(),
      },
    };
  }
  if (err instanceof errors.CandleFetchTimeoutError) {
    return {
      type:    'candle_fetch_timeout',
      message: err.message,
      details: { symbolId: err.symbolId, timeframe: err.timeframe, timeoutMs: err.timeoutMs },
    };
  }
  if (err instanceof errors.InsufficientCandlesError) {
    return {
      type:    'insufficient_candles',
      message: err.message,
      details: { symbolId: err.symbolId, required: err.required, received: err.received },
    };
  }
  if (err instanceof errors.MarketDataUnavailableError) {
    return {
      type:    'market_data_unavailable',
      message: err.message,
      details: { symbolId: err.symbolId },
    };
  }
  if (err instanceof errors.SessionError || err instanceof errors.TradingViewError) {
    return {
      type:    'session_error',
      message: err.message,
      details: null,
    };
  }

  // Unsupported timeframe — resolveTimeframe() throws a plain Error (not a typed domain error)
  // because utils/ does not depend on adapters/. We detect it by message prefix and parse
  // the provided value back out with a regex so the caller gets a properly typed response.
  if (err && err.message && err.message.startsWith('Unsupported timeframe:')) {
    const match = err.message.match(/Unsupported timeframe: "([^"]+)"/);
    return {
      type:    'unsupported_timeframe',
      message: err.message,
      details: {
        provided:  match ? match[1] : null,
        supported: getSupportedTimeframes(),
      },
    };
  }

  // Missing / invalid input (from utils/validation.js) — plain Error with field name in message
  if (err && err.message && (
    err.message.includes('"query"') ||
    err.message.includes('"timeframe"')
  )) {
    return {
      type:    'invalid_input',
      message: err.message,
      details: { supported_timeframes: getSupportedTimeframes() },
    };
  }

  // Unknown / unexpected error
  return {
    type:    'internal_error',
    message: err && err.message ? err.message : 'An unexpected error occurred.',
    details: null,
  };
}

/**
 * Run the market analysis tool.
 *
 * Always returns a result object with an `ok` boolean — never throws.
 * This allows OpenClaw agents to handle both success and failure paths
 * without wrapping calls in try/catch.
 *
 * @param {AnalyzeToolInput} input
 * @returns {Promise<AnalyzeToolSuccess | AnalyzeToolError>}
 */
async function runAnalyzeTool(input) {
  let normalized;

  try {
    normalized = normalizeInput(input);
  } catch (err) {
    return {
      ok:          false,
      error:       normalizeError(err),
      toolVersion: TOOL_VERSION,
    };
  }

  try {
    const data = await analyzeMarket(normalized);
    return {
      ok:          true,
      data,
      toolVersion: TOOL_VERSION,
    };
  } catch (err) {
    return {
      ok:          false,
      error:       normalizeError(err),
      toolVersion: TOOL_VERSION,
    };
  }
}

/**
 * Tool metadata for OpenClaw tool registration.
 *
 * An OpenClaw agent can use this object to understand the tool's capabilities,
 * input schema, and supported values without reading source code.
 */
const TOOL_DEFINITION = {
  name:        'analyzeMarket',
  version:     TOOL_VERSION,
  description: [
    'Performs deterministic technical market analysis for a given symbol and timeframe.',
    'Returns trend, momentum, signal, indicators, trendline state, and zone state.',
    'Use this when the user asks about a specific market symbol and timeframe.',
  ].join(' '),
  inputSchema: {
    query: {
      type:        'string',
      required:    true,
      description: 'Symbol name or search query. Examples: "BTC", "AAPL", "BINANCE:BTCUSDT".',
    },
    symbolId: {
      type:        'string',
      required:    false,
      description: 'Optional exact exchange-qualified symbol id (e.g. "BINANCE:BTCUSDT"). ' +
                   'If provided, skips symbol search. Use when id is already known.',
    },
    timeframe: {
      type:        'string',
      required:    true,
      enum:        getSupportedTimeframes(),
      description: 'Timeframe for the analysis. Supported values: ' + getSupportedTimeframes().join(', '),
    },
    options: {
      type:        'object',
      required:    false,
      description: 'Optional overrides: { candleCount, timeoutMs, token, signature, symbolFilter }',
    },
  },
  outputSchema: {
    ok:          'boolean — true on success, false on error',
    data:        'object — full analyzeMarket() result (when ok: true)',
    error:       'object — { type, message, details } (when ok: false)',
    toolVersion: 'string — tool version for bookkeeping',
  },
  errorTypes: [
    'symbol_not_found',
    'ambiguous_symbol',
    'unsupported_timeframe',
    'candle_fetch_timeout',
    'insufficient_candles',
    'market_data_unavailable',
    'session_error',
    'invalid_input',
    'internal_error',
  ],
};

module.exports = { runAnalyzeTool, TOOL_DEFINITION };
