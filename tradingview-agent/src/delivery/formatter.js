'use strict';

/**
 * Delivery formatters — transform analysis output into provider-specific payloads.
 *
 * formatTelegramMessage — human-readable text (PT-BR) for Telegram sendMessage
 * formatOpenClawPayload — machine-readable JSON for OpenClaw HTTP delivery
 */

const TELEGRAM_MAX_CHARS = 4096;
const TRUNCATION_NOTICE  = '\n\n[mensagem truncada]';

/**
 * Format a Telegram text message from an analysis result.
 *
 * Reuses analysis.summary (already built by the pipeline in PT-BR) and prepends
 * a source header. Truncates at 4096 chars with a notice to respect Telegram limits.
 *
 * @param {object} opts
 * @param {object} opts.analysis      — full analysis result from analyzeMarket()
 * @param {object} opts.request       — normalized request: { query, timeframe }
 * @param {string} opts.correlationId — request correlation ID
 * @returns {string}
 */
function formatTelegramMessage({ analysis, request, correlationId }) {
  const header = `[TradingView Webhook]\n${request.query} · ${request.timeframe}`;
  const body   = (analysis && typeof analysis.summary === 'string' && analysis.summary.trim())
    ? analysis.summary.trim()
    : `Sinal: ${analysis.signal}\nConfiança: ${analysis.confidence}`;

  const footer = `\ncorrelationId: ${correlationId}`;
  const full   = `${header}\n\n${body}${footer}`;

  if (full.length <= TELEGRAM_MAX_CHARS) return full;

  // Truncate body to fit, preserving header and footer
  const budget = TELEGRAM_MAX_CHARS - header.length - footer.length - TRUNCATION_NOTICE.length - 2;
  const truncatedBody = body.slice(0, Math.max(0, budget));
  return `${header}\n\n${truncatedBody}${TRUNCATION_NOTICE}${footer}`;
}

/**
 * Format a compact JSON payload for OpenClaw delivery.
 *
 * Sends the key analysis fields always. Optionally includes the full analysis
 * object when sendFullAnalysis=true (controlled by OPENCLAW_SEND_FULL_ANALYSIS env).
 *
 * Shape is aligned with the openclawAnalyzeMarket.js tool contract:
 *   { ok: true, data: { ... }, toolVersion, meta: { ... } }
 *
 * @param {object} opts
 * @param {string} opts.source          — always 'tradingview_webhook'
 * @param {object} opts.request         — normalized request: { query, timeframe }
 * @param {object} opts.analysis        — full analysis result
 * @param {object} opts.rawPayload      — original webhook body (secret already removed)
 * @param {string[]} opts.warnings      — analysis warnings array
 * @param {string} opts.correlationId   — request correlation ID
 * @param {boolean} opts.sendFullAnalysis — whether to include the full analysis object
 * @returns {object}
 */
function formatOpenClawPayload({
  source,
  request,
  analysis,
  rawPayload,
  warnings,
  correlationId,
  sendFullAnalysis,
}) {
  const core = {
    symbol:      analysis.symbol,
    timeframe:   analysis.timeframe,
    trend:       analysis.trend,
    momentum:    analysis.momentum,
    signal:      analysis.signal,
    confidence:  analysis.confidence,
    invalidation: analysis.invalidation ?? null,
    targets:     analysis.targets ?? null,
    summary:     analysis.summary ?? null,
  };

  return {
    ok:          true,
    toolVersion: 'webhook/v1',
    data:        sendFullAnalysis ? analysis : core,
    meta: {
      source,
      correlationId,
      request,
      warnings:   warnings || [],
      rawPayload: sanitizeRawPayload(rawPayload),
    },
  };
}

/**
 * Strip the secret field from the raw payload before forwarding.
 */
function sanitizeRawPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const { secret: _omit, ...rest } = payload;
  return rest;
}

module.exports = { formatTelegramMessage, formatOpenClawPayload };
