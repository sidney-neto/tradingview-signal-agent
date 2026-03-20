'use strict';

/**
 * Typed domain error classes for the Bybit adapter.
 *
 * All errors carry a machine-readable `code` string so callers can discriminate
 * without string-matching on message text.
 *
 * Error hierarchy:
 *   BybitError
 *     ├── MissingSymbolError       missing_symbol
 *     ├── InvalidSymbolError       invalid_symbol
 *     ├── UnauthorizedError        unauthorized
 *     ├── RateLimitedError         rate_limited
 *     ├── GeoRestrictedError       geo_restricted
 *     ├── UpstreamUnavailableError upstream_unavailable
 *     ├── BybitTimeoutError        timeout
 *     ├── InvalidResponseError     invalid_response
 *     ├── UnsupportedFeatureError  unsupported_feature
 *     ├── BybitApiError            api_error
 *     └── BybitInternalError       internal_error
 */

class BybitError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = this.constructor.name;
    if (cause) this.cause = cause;
  }
}

class MissingSymbolError extends BybitError {
  constructor() {
    super('Bybit request requires a symbol. Provide a non-empty symbol string.');
    this.code = 'missing_symbol';
  }
}

class InvalidSymbolError extends BybitError {
  constructor(symbol) {
    super(`Invalid or unrecognized symbol for Bybit: "${symbol}".`);
    this.code = 'invalid_symbol';
    this.symbol = symbol;
  }
}

class UnauthorizedError extends BybitError {
  constructor(message) {
    super(message || 'Bybit request was rejected (HTTP 401/403). Check API credentials.');
    this.code = 'unauthorized';
  }
}

class RateLimitedError extends BybitError {
  constructor() {
    super('Bybit API rate limit exceeded (HTTP 429). Slow down requests.');
    this.code = 'rate_limited';
  }
}

class GeoRestrictedError extends BybitError {
  constructor() {
    super('Bybit API access is geo-restricted from this location (HTTP 403).');
    this.code = 'geo_restricted';
  }
}

class UpstreamUnavailableError extends BybitError {
  constructor(message, cause) {
    super(message || 'Bybit upstream is unavailable.', cause);
    this.code = 'upstream_unavailable';
  }
}

class BybitTimeoutError extends BybitError {
  constructor(timeoutMs) {
    super(`Bybit request timed out after ${timeoutMs}ms.`);
    this.code = 'timeout';
    this.timeoutMs = timeoutMs;
  }
}

class InvalidResponseError extends BybitError {
  constructor(message) {
    super(message || 'Bybit returned an unexpected or malformed response.');
    this.code = 'invalid_response';
  }
}

class UnsupportedFeatureError extends BybitError {
  constructor(message) {
    super(message || 'This Bybit feature is not yet supported.');
    this.code = 'unsupported_feature';
  }
}

/**
 * Thrown when the Bybit V5 envelope indicates an application-level error
 * (retCode !== 0) that does not map to a more specific error class.
 */
class BybitApiError extends BybitError {
  constructor(retCode, retMsg) {
    super(`Bybit API error: retCode=${retCode} retMsg=${retMsg || '(no message)'}`);
    this.code = 'api_error';
    this.retCode = retCode;
    this.retMsg = retMsg || null;
  }
}

class BybitInternalError extends BybitError {
  constructor(message, cause) {
    super(message || 'An internal Bybit adapter error occurred.', cause);
    this.code = 'internal_error';
  }
}

module.exports = {
  BybitError,
  MissingSymbolError,
  InvalidSymbolError,
  UnauthorizedError,
  RateLimitedError,
  GeoRestrictedError,
  UpstreamUnavailableError,
  BybitTimeoutError,
  InvalidResponseError,
  UnsupportedFeatureError,
  BybitApiError,
  BybitInternalError,
};
