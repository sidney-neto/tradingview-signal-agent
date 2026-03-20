'use strict';

/**
 * Telegram delivery provider.
 *
 * Sends a text message to a configured chat via the Telegram Bot API.
 * Uses Node.js native fetch (no external HTTP library).
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN — bot token from @BotFather
 *   TELEGRAM_CHAT_ID   — target chat or channel ID (integer or "@channelusername")
 *
 * Optional:
 *   DELIVERY_TIMEOUT_MS — HTTP request timeout in ms (default: 5000)
 */

const logger = require('../../logger');

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID   || '';

/**
 * Returns true when the provider is fully configured.
 */
function isConfigured() {
  return Boolean(BOT_TOKEN && CHAT_ID);
}

/**
 * Send a Telegram message.
 *
 * @param {string} text        — pre-formatted message text (≤4096 chars)
 * @param {number} timeoutMs   — request timeout in ms
 * @returns {Promise<{ provider: string, attempted: boolean, success: boolean, statusCode?: number, error?: string }>}
 */
async function send(text, timeoutMs = 5000) {
  if (!isConfigured()) {
    return {
      provider:  'telegram',
      attempted: false,
      success:   false,
      error:     'Provider not configured (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing).',
    };
  }

  const url  = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id:    CHAT_ID,
    text,
    parse_mode: 'HTML',
  });

  let res;
  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeoutMs);

    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal:  controller.signal,
    });

    clearTimeout(timer);
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    logger.warn('delivery.telegram.error', {
      error: isTimeout ? 'timeout' : err.message,
    });
    return {
      provider:  'telegram',
      attempted: true,
      success:   false,
      error:     isTimeout ? `Request timed out after ${timeoutMs}ms` : err.message,
    };
  }

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (_) { /* ignore */ }
    logger.warn('delivery.telegram.http_error', { statusCode: res.status, detail });
    return {
      provider:   'telegram',
      attempted:  true,
      success:    false,
      statusCode: res.status,
      error:      `Telegram API returned ${res.status}.`,
    };
  }

  return { provider: 'telegram', attempted: true, success: true, statusCode: res.status };
}

module.exports = { send, isConfigured };
