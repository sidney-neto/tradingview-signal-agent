'use strict';

/**
 * Typed domain error classes for the CoinGlass adapter.
 *
 * All errors carry a machine-readable `code` string so callers can discriminate
 * without string-matching on message text.
 */

class CoinGlassError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = this.constructor.name;
    if (cause) this.cause = cause;
  }
}

class MissingApiKeyError extends CoinGlassError {
  constructor() {
    super(
      'CoinGlass API key is missing. Set the COINGLASS_API_KEY environment variable.'
    );
    this.code = 'missing_api_key';
  }
}

class UnauthorizedError extends CoinGlassError {
  constructor() {
    super('CoinGlass API key is invalid or the request was rejected (HTTP 401/403).');
    this.code = 'unauthorized';
  }
}

class PlanRestrictedError extends CoinGlassError {
  /**
   * Thrown when CoinGlass explicitly signals that the current API plan does not
   * include access to the requested endpoint (e.g. "Upgrade plan" in response body
   * or application-level error codes like 40110, 50010, etc.).
   *
   * This is distinct from UnauthorizedError (bad key) — the key is valid but the
   * subscription tier doesn't cover the feature.
   *
   * @param {string} [providerMessage] - Raw message from CoinGlass response body
   */
  constructor(providerMessage) {
    super('CoinGlass endpoint requires a plan upgrade. Context features are unavailable on the current subscription tier.');
    this.code = 'plan_restricted';
    this.providerMessage = providerMessage || null;
  }
}

class RateLimitedError extends CoinGlassError {
  constructor() {
    super('CoinGlass API rate limit exceeded (HTTP 429). Slow down requests.');
    this.code = 'rate_limited';
  }
}

class UpstreamUnavailableError extends CoinGlassError {
  constructor(message, cause) {
    super(message || 'CoinGlass upstream is unavailable.', cause);
    this.code = 'upstream_unavailable';
  }
}

class InvalidSymbolError extends CoinGlassError {
  constructor(symbol) {
    super(`Invalid or unrecognized symbol for CoinGlass: "${symbol}".`);
    this.code = 'invalid_symbol';
    this.symbol = symbol;
  }
}

class InvalidResponseError extends CoinGlassError {
  constructor(message) {
    super(message || 'CoinGlass returned an unexpected or malformed response.');
    this.code = 'invalid_response';
  }
}

class CoinGlassTimeoutError extends CoinGlassError {
  constructor(timeoutMs) {
    super(`CoinGlass request timed out after ${timeoutMs}ms.`);
    this.code = 'timeout';
    this.timeoutMs = timeoutMs;
  }
}

class UnsupportedFeatureError extends CoinGlassError {
  constructor(message) {
    super(message || 'This CoinGlass feature is not yet supported.');
    this.code = 'unsupported_feature';
  }
}

class CoinGlassInternalError extends CoinGlassError {
  constructor(message, cause) {
    super(message || 'An internal CoinGlass adapter error occurred.', cause);
    this.code = 'internal_error';
  }
}

module.exports = {
  CoinGlassError,
  MissingApiKeyError,
  UnauthorizedError,
  PlanRestrictedError,
  RateLimitedError,
  UpstreamUnavailableError,
  InvalidSymbolError,
  InvalidResponseError,
  CoinGlassTimeoutError,
  UnsupportedFeatureError,
  CoinGlassInternalError,
};
