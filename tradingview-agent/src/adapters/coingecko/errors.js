'use strict';

/**
 * Typed domain error classes for the CoinGecko adapter.
 *
 * All errors carry a machine-readable `code` string so callers can discriminate
 * without string-matching on message text.
 */

class CoinGeckoError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = this.constructor.name;
    if (cause) this.cause = cause;
  }
}

class MissingApiKeyError extends CoinGeckoError {
  constructor() {
    super(
      'CoinGecko API key is missing. Set the COINGECKO_API_KEY environment variable.'
    );
    this.code = 'missing_api_key';
  }
}

class UnauthorizedError extends CoinGeckoError {
  constructor() {
    super('CoinGecko API key is invalid or the request was rejected (HTTP 401/403).');
    this.code = 'unauthorized';
  }
}

class RateLimitedError extends CoinGeckoError {
  constructor() {
    super('CoinGecko API rate limit exceeded (HTTP 429). Slow down requests or upgrade your plan.');
    this.code = 'rate_limited';
  }
}

class PlanRestrictedError extends CoinGeckoError {
  /**
   * Thrown when the current CoinGecko plan tier does not include the requested endpoint.
   *
   * @param {string} [providerMessage] - Raw message from CoinGecko response body
   */
  constructor(providerMessage) {
    super('CoinGecko endpoint requires a plan upgrade. Feature is unavailable on the current tier.');
    this.code = 'plan_restricted';
    this.providerMessage = providerMessage || null;
  }
}

class UpstreamUnavailableError extends CoinGeckoError {
  constructor(message, cause) {
    super(message || 'CoinGecko upstream is unavailable.', cause);
    this.code = 'upstream_unavailable';
  }
}

class SymbolNotFoundError extends CoinGeckoError {
  constructor(query) {
    super(`No CoinGecko coin found for query: "${query}".`);
    this.code = 'symbol_not_found';
    this.query = query;
  }
}

class InvalidResponseError extends CoinGeckoError {
  constructor(message) {
    super(message || 'CoinGecko returned an unexpected or malformed response.');
    this.code = 'invalid_response';
  }
}

class CoinGeckoTimeoutError extends CoinGeckoError {
  constructor(timeoutMs) {
    super(`CoinGecko request timed out after ${timeoutMs}ms.`);
    this.code = 'timeout';
    this.timeoutMs = timeoutMs;
  }
}

class UnsupportedFeatureError extends CoinGeckoError {
  constructor(message) {
    super(message || 'This CoinGecko feature is not yet supported.');
    this.code = 'unsupported_feature';
  }
}

class CoinGeckoInternalError extends CoinGeckoError {
  constructor(message, cause) {
    super(message || 'An internal CoinGecko adapter error occurred.', cause);
    this.code = 'internal_error';
  }
}

module.exports = {
  CoinGeckoError,
  MissingApiKeyError,
  UnauthorizedError,
  RateLimitedError,
  PlanRestrictedError,
  UpstreamUnavailableError,
  SymbolNotFoundError,
  InvalidResponseError,
  CoinGeckoTimeoutError,
  UnsupportedFeatureError,
  CoinGeckoInternalError,
};
