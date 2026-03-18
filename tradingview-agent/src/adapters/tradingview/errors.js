'use strict';

/**
 * Domain-level error classes for the TradingView adapter.
 * These wrap low-level errors and translate them into meaningful failures
 * that callers can distinguish and handle.
 */

class TradingViewError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = this.constructor.name;
    if (cause) this.cause = cause;
  }
}

class SymbolNotFoundError extends TradingViewError {
  constructor(query) {
    super(`Symbol not found for query: "${query}"`);
    this.query = query;
  }
}

class AmbiguousSymbolError extends TradingViewError {
  constructor(query, candidates) {
    super(
      `Ambiguous symbol query "${query}". Multiple matches found: ${candidates
        .slice(0, 5)
        .map((c) => c.id || c.symbol)
        .join(', ')}`
    );
    this.query = query;
    this.candidates = candidates;
  }
}

class UnsupportedTimeframeError extends TradingViewError {
  constructor(timeframe) {
    super(`Unsupported timeframe: "${timeframe}"`);
    this.timeframe = timeframe;
  }
}

class MarketDataUnavailableError extends TradingViewError {
  constructor(symbolId, cause) {
    super(`Market data unavailable for symbol: "${symbolId}"`, cause);
    this.symbolId = symbolId;
  }
}

class CandleFetchTimeoutError extends TradingViewError {
  constructor(symbolId, timeframe, timeoutMs) {
    super(
      `Timeout (${timeoutMs}ms) while fetching candles for "${symbolId}" @ ${timeframe}`
    );
    this.symbolId = symbolId;
    this.timeframe = timeframe;
    this.timeoutMs = timeoutMs;
  }
}

class InsufficientCandlesError extends TradingViewError {
  constructor(symbolId, required, received) {
    super(
      `Insufficient candles for "${symbolId}": need at least ${required}, got ${received}`
    );
    this.symbolId = symbolId;
    this.required = required;
    this.received = received;
  }
}

class SessionError extends TradingViewError {
  constructor(message, cause) {
    super(`TradingView session error: ${message}`, cause);
  }
}

module.exports = {
  TradingViewError,
  SymbolNotFoundError,
  AmbiguousSymbolError,
  UnsupportedTimeframeError,
  MarketDataUnavailableError,
  CandleFetchTimeoutError,
  InsufficientCandlesError,
  SessionError,
};
