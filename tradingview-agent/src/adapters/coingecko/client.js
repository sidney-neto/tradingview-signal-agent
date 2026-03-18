'use strict';

/**
 * CoinGecko HTTP client.
 *
 * Handles:
 * - Tier selection: `demo` (default) vs `paid` — controls base URL and auth header name
 * - API key injection from COINGECKO_API_KEY env var (optional; public tier allowed without key)
 * - Request construction (base URL + query params + auth header)
 * - Timeout enforcement
 * - HTTP status → typed error mapping
 *
 * Tier behaviour:
 *   demo  → base: https://api.coingecko.com/api/v3,     header: x-cg-demo-api-key
 *   paid  → base: https://pro-api.coingecko.com/api/v3, header: x-cg-pro-api-key
 *
 * No key is allowed (public tier), but rate limits are very aggressive (~10–30 req/min).
 * A demo key raises the limit to ~30 req/min with priority queuing.
 *
 * No external runtime dependencies — uses Node.js built-in `https`.
 * Requires Node.js >= 16 (as per project package.json).
 */

const https = require('https');

const {
  UnauthorizedError,
  PlanRestrictedError,
  RateLimitedError,
  UpstreamUnavailableError,
  InvalidResponseError,
  CoinGeckoTimeoutError,
} = require('./errors');

const TIER_CONFIG = {
  demo: {
    baseUrl:    'https://api.coingecko.com/api/v3',
    authHeader: 'x-cg-demo-api-key',
  },
  paid: {
    baseUrl:    'https://pro-api.coingecko.com/api/v3',
    authHeader: 'x-cg-pro-api-key',
  },
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Resolve the API tier from the COINGECKO_API_TIER environment variable.
 * Falls back to 'demo' if unset or unrecognised.
 *
 * @returns {'demo'|'paid'}
 */
function resolveTier() {
  const raw = (process.env.COINGECKO_API_TIER || 'demo').toLowerCase().trim();
  return raw === 'paid' ? 'paid' : 'demo';
}

/**
 * Read the optional API key from the environment.
 * Returns null (not an error) if absent — the public tier functions without a key.
 *
 * @returns {string|null}
 */
function getApiKey() {
  const key = process.env.COINGECKO_API_KEY;
  return (key && key.trim()) ? key.trim() : null;
}

/**
 * Execute a GET request against the CoinGecko API.
 *
 * @param {string} path          - API path, e.g. '/search/trending'
 * @param {object} [params={}]   - Query parameters (undefined/null values are omitted)
 * @param {number} [timeoutMs]   - Request timeout in milliseconds
 * @returns {Promise<object>}    - Parsed JSON response body
 */
function request(path, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const tier   = resolveTier();
  const config = TIER_CONFIG[tier];
  const apiKey = getApiKey();

  // Build query string — skip null/undefined params
  const filteredParams = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  );
  const qs = new URLSearchParams(filteredParams).toString();
  const fullUrl = `${config.baseUrl}${path}${qs ? '?' + qs : ''}`;

  return new Promise((resolve, reject) => {
    const url = new URL(fullUrl);

    const headers = { 'Accept': 'application/json' };
    if (apiKey) headers[config.authHeader] = apiKey;

    const reqOptions = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'GET',
      headers,
    };

    const req = https.request(reqOptions, (res) => {
      // Immediately reject for codes that carry no useful body
      if (res.statusCode === 429) {
        res.resume();
        return reject(new RateLimitedError());
      }
      if (res.statusCode >= 500) {
        res.resume();
        return reject(
          new UpstreamUnavailableError(
            `CoinGecko upstream error (HTTP ${res.statusCode}).`
          )
        );
      }

      // Read body for 200, 401, 403, and other status codes.
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          const lower = body.toLowerCase();
          if (lower.includes('upgrade') || lower.includes('plan') || lower.includes('subscription')) {
            return reject(new PlanRestrictedError(body.slice(0, 300).trim()));
          }
          return reject(new UnauthorizedError());
        }

        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return reject(
            new InvalidResponseError('CoinGecko returned a non-JSON response.')
          );
        }

        // CoinGecko sometimes returns { status: { error_code, error_message } } for errors
        if (parsed && parsed.status && parsed.status.error_code) {
          const msg = (parsed.status.error_message || '').toLowerCase();
          if (msg.includes('plan') || msg.includes('upgrade') || msg.includes('subscription')) {
            return reject(new PlanRestrictedError(parsed.status.error_message));
          }
          return reject(
            new InvalidResponseError(
              `CoinGecko API error: code=${parsed.status.error_code} msg=${parsed.status.error_message || '(no message)'}`
            )
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
      reject(new CoinGeckoTimeoutError(timeoutMs));
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNRESET') return; // already rejected via timeout
      reject(
        new UpstreamUnavailableError(`CoinGecko request failed: ${err.message}`, err)
      );
    });

    req.end();
  });
}

module.exports = { request, getApiKey, resolveTier, DEFAULT_TIMEOUT_MS };
