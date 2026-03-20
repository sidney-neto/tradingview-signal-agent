'use strict';

/**
 * Minimal structured logger.
 *
 * Outputs newline-delimited JSON to stdout (info/debug) and stderr (warn/error).
 *
 * SECURITY: Never pass raw options objects that may contain SESSION, SIGNATURE,
 * COINGLASS_API_KEY, COINGECKO_API_KEY or similar secrets as context.
 * Callers are responsible for not logging sensitive values.
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('analysis.start', { query: 'BTC', timeframe: '1h' });
 *   logger.warn('overlay.skipped', { source: 'coinglass', reason: 'no key' });
 *   logger.error('candle.fetch.timeout', { symbolId, timeoutMs });
 *
 * Log entry shape:
 *   { ts: <epoch ms>, level: 'info'|'warn'|'error'|'debug', event: '<name>', ...context }
 *
 * Control verbosity with LOG_LEVEL env var (debug < info < warn < error).
 * Default: 'info' (debug entries are suppressed unless LOG_LEVEL=debug).
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

// Re-evaluated once at module load so tests can set LOG_LEVEL before requiring
const currentLevel = () => LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, event, context) {
  if (LEVELS[level] < currentLevel()) return;

  const entry = {
    ts:    Date.now(),
    level,
    event,
    ...context,
  };

  const line = JSON.stringify(entry) + '\n';

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

const logger = {
  debug: (event, context = {}) => log('debug', event, context),
  info:  (event, context = {}) => log('info',  event, context),
  warn:  (event, context = {}) => log('warn',  event, context),
  error: (event, context = {}) => log('error', event, context),
};

module.exports = logger;
