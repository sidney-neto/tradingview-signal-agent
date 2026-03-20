'use strict';

/**
 * Bybit V5 HTTP client — public market data.
 *
 * Handles:
 * - Base URL selection (mainnet / testnet / override)
 * - Query parameter building
 * - Request execution with timeout
 * - Bybit V5 envelope parsing  { retCode, retMsg, result, retExtInfo, time }
 * - HTTP status → typed error mapping
 * - V5 retCode → typed error mapping
 *
 * No external runtime dependencies — uses Node.js built-in `https`.
 * Requires Node.js >= 16 (as per project package.json).
 *
 * ── Future authenticated endpoints ──────────────────────────────────────────
 * When private/authenticated endpoints are needed, add a `signRequest(params)`
 * helper here that computes the HMAC-SHA256 signature per the Bybit V5 auth
 * spec (timestamp + api_key + recv_window + sorted params), then pass signed
 * headers in `requestPrivate()`. Do NOT modify `request()` — keep the public
 * path clean.
 *
 * ── Future WebSocket ─────────────────────────────────────────────────────────
 * Public WS endpoint: wss://stream.bybit.com/v5/public/linear
 * Testnet WS:         wss://stream-testnet.bybit.com/v5/public/linear
 * Add a separate bybit/ws.js module — do NOT add WebSocket logic here.
 */

const https = require('https');

const {
  RateLimitedError,
  GeoRestrictedError,
  UnauthorizedError,
  UpstreamUnavailableError,
  BybitTimeoutError,
  InvalidResponseError,
  BybitApiError,
  InvalidSymbolError,
} = require('./errors');

const MAINNET_BASE_URL = 'https://api.bybit.com';
const TESTNET_BASE_URL = 'https://api-testnet.bybit.com';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Resolve the base URL from environment configuration.
 *
 * Priority:
 *   1. BYBIT_BASE_URL — explicit override (e.g. for proxies or mock servers)
 *   2. BYBIT_ENV=testnet → testnet URL
 *   3. Default: mainnet
 *
 * @returns {string}
 */
function resolveBaseUrl() {
  if (process.env.BYBIT_BASE_URL) return process.env.BYBIT_BASE_URL.replace(/\/$/, '');
  if (process.env.BYBIT_ENV === 'testnet') return TESTNET_BASE_URL;
  return MAINNET_BASE_URL;
}

/**
 * Resolve the request timeout in milliseconds.
 * Falls back to DEFAULT_TIMEOUT_MS if BYBIT_TIMEOUT_MS is absent or invalid.
 *
 * @returns {number}
 */
function resolveTimeoutMs() {
  const t = parseInt(process.env.BYBIT_TIMEOUT_MS, 10);
  return Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
}

/**
 * Map a Bybit V5 retCode to a typed error, or return null if it maps to success.
 *
 * Bybit V5 retCode semantics (partial — most relevant codes):
 *   0        success
 *   10001    request parameter error (often bad symbol)
 *   10004    sign check failed (auth — future use)
 *   10006    rate limit exceeded
 *   10016    service unavailable
 *   110007   invalid symbol
 *
 * @param {number} retCode
 * @param {string} retMsg
 * @returns {Error|null}
 */
function mapRetCode(retCode, retMsg) {
  if (retCode === 0) return null;

  if (retCode === 10006) return new RateLimitedError();
  if (retCode === 10016) return new UpstreamUnavailableError(`Bybit service unavailable: ${retMsg}`);
  if (retCode === 110007 || retCode === 10001) {
    // Distinguish symbol errors from generic param errors
    const lower = (retMsg || '').toLowerCase();
    if (lower.includes('symbol') || lower.includes('instrument')) {
      return new InvalidSymbolError(retMsg);
    }
  }

  return new BybitApiError(retCode, retMsg);
}

/**
 * Execute a GET request against the Bybit V5 public API.
 *
 * Parses and validates the V5 envelope:
 *   { retCode: 0, retMsg: 'OK', result: {...}, retExtInfo: {}, time: <ms> }
 *
 * On success, resolves with the `result` object.
 * On failure, rejects with a typed BybitError subclass.
 *
 * @param {string} path           - API path, e.g. '/v5/market/tickers'
 * @param {object} [params={}]    - Query parameters (undefined/null values are omitted)
 * @param {number} [timeoutMs]    - Optional timeout override in milliseconds
 * @returns {Promise<object>}     - Parsed `result` from V5 envelope
 */
function request(path, params = {}, timeoutMs) {
  const timeout = timeoutMs !== undefined ? timeoutMs : resolveTimeoutMs();
  const base    = resolveBaseUrl();

  // Build query string — skip null/undefined params
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
  );
  const qs      = new URLSearchParams(filtered).toString();
  const fullUrl = `${base}${path}${qs ? '?' + qs : ''}`;

  return new Promise((resolve, reject) => {
    const url = new URL(fullUrl);

    const reqOptions = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'GET',
      headers:  { 'Accept': 'application/json' },
    };

    const req = https.request(reqOptions, (res) => {
      // Handle status codes that carry no useful body
      if (res.statusCode === 429) {
        res.resume();
        return reject(new RateLimitedError());
      }
      if (res.statusCode === 403) {
        res.resume();
        return reject(new GeoRestrictedError());
      }
      if (res.statusCode === 401) {
        res.resume();
        return reject(new UnauthorizedError());
      }
      if (res.statusCode >= 500) {
        res.resume();
        return reject(
          new UpstreamUnavailableError(`Bybit upstream error (HTTP ${res.statusCode}).`)
        );
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return reject(new InvalidResponseError('Bybit returned a non-JSON response.'));
        }

        // Validate V5 envelope shape
        if (typeof parsed !== 'object' || parsed === null || !('retCode' in parsed)) {
          return reject(new InvalidResponseError('Bybit response is missing the V5 envelope fields.'));
        }

        // Map retCode to typed error
        const err = mapRetCode(parsed.retCode, parsed.retMsg);
        if (err) return reject(err);

        if (parsed.result === undefined) {
          return reject(new InvalidResponseError('Bybit V5 response is missing the "result" field.'));
        }

        resolve(parsed.result);
      });

      res.on('error', (streamErr) => {
        reject(new UpstreamUnavailableError(`Response stream error: ${streamErr.message}`, streamErr));
      });
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new BybitTimeoutError(timeout));
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNRESET') return; // already rejected via timeout
      reject(new UpstreamUnavailableError(`Bybit request failed: ${err.message}`, err));
    });

    req.end();
  });
}

module.exports = {
  request,
  resolveBaseUrl,
  resolveTimeoutMs,
  MAINNET_BASE_URL,
  TESTNET_BASE_URL,
  DEFAULT_TIMEOUT_MS,
};
