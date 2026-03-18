'use strict';

/**
 * CoinGlass HTTP client.
 *
 * Handles:
 * - API key retrieval from COINGLASS_API_KEY env var
 * - Request construction (base URL + query params + auth header)
 * - Timeout enforcement
 * - HTTP status → typed error mapping
 *
 * No external runtime dependencies — uses Node.js built-in `https`.
 * Requires Node.js >= 16 (as per project package.json).
 */

const https = require('https');

const {
  MissingApiKeyError,
  UnauthorizedError,
  PlanRestrictedError,
  RateLimitedError,
  UpstreamUnavailableError,
  InvalidResponseError,
  CoinGlassTimeoutError,
} = require('./errors');

const BASE_URL  = 'https://open-api-v4.coinglass.com';
const API_KEY_HEADER = 'CG-API-KEY';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Read and validate the API key from the environment.
 * Throws MissingApiKeyError synchronously if absent.
 *
 * @returns {string}
 */
function getApiKey() {
  const key = process.env.COINGLASS_API_KEY;
  if (!key || !key.trim()) {
    throw new MissingApiKeyError();
  }
  return key.trim();
}

/**
 * Execute a GET request against the CoinGlass API.
 *
 * @param {string} path          - API path, e.g. '/api/futures/funding-rate/history'
 * @param {object} [params={}]   - Query parameters (undefined/null values are omitted)
 * @param {number} [timeoutMs]   - Request timeout in milliseconds
 * @returns {Promise<object>}    - Parsed JSON response body
 */
function request(path, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const apiKey = getApiKey();

  // Build query string — skip null/undefined params
  const filteredParams = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  );
  const qs = new URLSearchParams(filteredParams).toString();
  const fullUrl = `${BASE_URL}${path}${qs ? '?' + qs : ''}`;

  return new Promise((resolve, reject) => {
    const url = new URL(fullUrl);

    const reqOptions = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'GET',
      headers:  {
        [API_KEY_HEADER]: apiKey,
        'Accept':         'application/json',
      },
    };

    const req = https.request(reqOptions, (res) => {
      // Immediately reject for status codes that carry no useful body
      if (res.statusCode === 429) {
        res.resume();
        return reject(new RateLimitedError());
      }
      if (res.statusCode >= 500) {
        res.resume();
        return reject(
          new UpstreamUnavailableError(
            `CoinGlass upstream error (HTTP ${res.statusCode}).`
          )
        );
      }

      // Read body for all other status codes (200, 401, 403, etc.).
      // 401/403 bodies often contain plan-restriction messages like "Upgrade plan"
      // that need to be distinguished from a genuine invalid-key error.
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          const lower = body.toLowerCase();
          if (lower.includes('upgrade') || lower.includes('plan')) {
            return reject(new PlanRestrictedError(body.slice(0, 300).trim()));
          }
          return reject(new UnauthorizedError());
        }

        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return reject(
            new InvalidResponseError('CoinGlass returned a non-JSON response.')
          );
        }
        resolve(parsed);
      });
      res.on('error', (err) => {
        reject(new UpstreamUnavailableError(`Response stream error: ${err.message}`, err));
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new CoinGlassTimeoutError(timeoutMs));
    });

    req.on('error', (err) => {
      // req.destroy() from setTimeout triggers an 'error' event with code ECONNRESET
      if (err.code === 'ECONNRESET') return; // already rejected via timeout
      reject(
        new UpstreamUnavailableError(`CoinGlass request failed: ${err.message}`, err)
      );
    });

    req.end();
  });
}

module.exports = { request, getApiKey, BASE_URL, DEFAULT_TIMEOUT_MS };
