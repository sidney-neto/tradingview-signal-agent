'use strict';

const crypto = require('crypto');

const logger = require('../logger');
const { createAnalysisRepository } = require('./analysisRepository');

function getDefaultEngineVersion() {
  try {
    return require('../../package.json').version;
  } catch (_) {
    return null;
  }
}

function isPersistenceEnabled() {
  return (process.env.PERSISTENCE_ENABLED || '').toLowerCase() === 'true';
}

function shouldPersistAnalyzeRoute() {
  return (process.env.PERSIST_ANALYZE_ROUTE || '').toLowerCase() === 'true';
}

function persistAnalysisSnapshot({
  enabled = isPersistenceEnabled(),
  dbPath,
  source,
  correlationId = null,
  request,
  rawPayload = null,
  analysis,
  groupId = null,
  parentAnalysisId = null,
  tradeId = null,
  engineVersion = getDefaultEngineVersion(),
}) {
  if (!enabled) return { persisted: false, reason: 'disabled', row: null };

  try {
    const repo = createAnalysisRepository({ dbPath });
    const saved = repo.saveAnalysisRun({
      source,
      correlationId,
      request,
      rawPayload,
      analysis,
      groupId,
      parentAnalysisId,
      tradeId,
      engineVersion,
    });

    return {
      persisted: true,
      inserted: saved.inserted,
      row: saved.row,
      groupId: groupId || saved.row.group_id || null,
    };
  } catch (err) {
    logger.error('persistence.analysis.failed', {
      source,
      symbolId: analysis?.symbolId || null,
      timeframe: analysis?.timeframe || null,
      error: err.message,
    });
    return { persisted: false, reason: err.message, row: null };
  }
}

function persistMtfAnalysisResults({
  enabled = isPersistenceEnabled(),
  dbPath,
  source = 'mtf_manual',
  correlationId = null,
  query,
  rawPayload = null,
  results,
  tradeId = null,
  parentAnalysisId = null,
  engineVersion = getDefaultEngineVersion(),
  groupId = crypto.randomUUID(),
}) {
  if (!enabled) return { persisted: false, reason: 'disabled', groupId: null, rows: [] };

  const rows = [];

  for (const [timeframe, analysis] of Object.entries(results || {})) {
    if (!analysis) continue;
    const saved = persistAnalysisSnapshot({
      enabled,
      dbPath,
      source,
      correlationId,
      request: { query, timeframe },
      rawPayload,
      analysis,
      groupId,
      parentAnalysisId,
      tradeId,
      engineVersion,
    });

    if (saved.row) rows.push(saved.row);
  }

  return {
    persisted: rows.length > 0,
    groupId: rows.length > 0 ? groupId : null,
    rows,
  };
}

module.exports = {
  isPersistenceEnabled,
  shouldPersistAnalyzeRoute,
  persistAnalysisSnapshot,
  persistMtfAnalysisResults,
};
