'use strict';

const crypto = require('crypto');

const { openDatabase, closeDatabase, resolveDbPath } = require('./db');

function safeJsonParse(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeIsoTime(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  return null;
}

function hydrateAnalysisRow(row) {
  if (!row) return null;
  return {
    ...row,
    request_json: safeJsonParse(row.request_json, {}),
    raw_payload_json: safeJsonParse(row.raw_payload_json, null),
    analysis_json: safeJsonParse(row.analysis_json, {}),
    warnings_json: safeJsonParse(row.warnings_json, []),
  };
}

function hydrateTradeCase(row) {
  if (!row) return null;
  return {
    ...row,
    outcome_json: safeJsonParse(row.outcome_json, null),
  };
}

function buildAnalysisRunRecord(params) {
  const analysis = params.analysis || {};
  const request = params.request || {};
  const warnings = Array.isArray(analysis.warnings) ? analysis.warnings : [];
  const lastCandleTime = normalizeIsoTime(analysis.lastCandleTime);

  if (!analysis.symbol || !analysis.symbolId || !analysis.timeframe || !lastCandleTime) {
    throw new Error('saveAnalysisRun: analysis must include symbol, symbolId, timeframe, and lastCandleTime');
  }

  return {
    id: params.id || crypto.randomUUID(),
    group_id: params.groupId || null,
    parent_analysis_id: params.parentAnalysisId || null,
    trade_id: params.tradeId || null,
    source: params.source || 'unknown',
    correlation_id: params.correlationId || null,
    query: request.query || null,
    symbol: analysis.symbol,
    symbol_id: analysis.symbolId,
    exchange: analysis.exchange || null,
    timeframe: analysis.timeframe,
    analyzed_at: normalizeIsoTime(analysis.timestamp) || new Date().toISOString(),
    last_candle_time: lastCandleTime,
    candle_count: analysis.candleCount ?? null,
    price: analysis.price ?? null,
    signal: analysis.signal || null,
    confidence: analysis.confidence ?? null,
    data_quality: analysis.dataQuality || null,
    trend: analysis.trend || null,
    momentum: analysis.momentum || null,
    setup_quality: analysis.tradeQualification?.setupQuality || null,
    trade_bias: analysis.tradeQualification?.tradeBias || null,
    market_regime: analysis.marketRegime?.regime || null,
    request_json: JSON.stringify(request || {}),
    raw_payload_json: params.rawPayload == null ? null : JSON.stringify(params.rawPayload),
    analysis_json: JSON.stringify(analysis),
    warnings_json: JSON.stringify(warnings),
    engine_version: params.engineVersion || null,
  };
}

function createAnalysisRepository({ dbPath } = {}) {
  const resolvedPath = resolveDbPath(dbPath);
  const db = openDatabase({ dbPath: resolvedPath });

  const insertAnalysisStmt = db.prepare(`
    INSERT INTO analysis_runs (
      id, group_id, parent_analysis_id, trade_id, source, correlation_id,
      query, symbol, symbol_id, exchange, timeframe, analyzed_at,
      last_candle_time, candle_count, price, signal, confidence, data_quality,
      trend, momentum, setup_quality, trade_bias, market_regime,
      request_json, raw_payload_json, analysis_json, warnings_json, engine_version
    ) VALUES (
      @id, @group_id, @parent_analysis_id, @trade_id, @source, @correlation_id,
      @query, @symbol, @symbol_id, @exchange, @timeframe, @analyzed_at,
      @last_candle_time, @candle_count, @price, @signal, @confidence, @data_quality,
      @trend, @momentum, @setup_quality, @trade_bias, @market_regime,
      @request_json, @raw_payload_json, @analysis_json, @warnings_json, @engine_version
    )
    ON CONFLICT(source, symbol_id, timeframe, last_candle_time) DO NOTHING
    RETURNING *
  `);

  const selectAnalysisByUniqueStmt = db.prepare(`
    SELECT *
    FROM analysis_runs
    WHERE source = ? AND symbol_id = ? AND timeframe = ? AND last_candle_time = ?
    LIMIT 1
  `);

  const listRecentStmt = db.prepare(`
    SELECT *
    FROM analysis_runs
    WHERE symbol_id = ?
    ORDER BY analyzed_at DESC, id DESC
    LIMIT ?
  `);

  const listByTradeStmt = db.prepare(`
    SELECT *
    FROM analysis_runs
    WHERE trade_id = ?
    ORDER BY analyzed_at ASC, id ASC
  `);

  const listByGroupStmt = db.prepare(`
    SELECT *
    FROM analysis_runs
    WHERE group_id = ?
    ORDER BY analyzed_at ASC, id ASC
  `);

  const insertTradeCaseStmt = db.prepare(`
    INSERT INTO trade_cases (
      id, root_analysis_id, symbol_id, entry_timeframe, opened_at,
      closed_at, status, entry_price, exit_price, outcome, outcome_json
    ) VALUES (
      @id, @root_analysis_id, @symbol_id, @entry_timeframe, @opened_at,
      @closed_at, @status, @entry_price, @exit_price, @outcome, @outcome_json
    )
  `);

  const getTradeCaseStmt = db.prepare(`
    SELECT *
    FROM trade_cases
    WHERE id = ?
    LIMIT 1
  `);

  function saveAnalysisRun(params) {
    const record = buildAnalysisRunRecord(params);
    const inserted = insertAnalysisStmt.get(record);
    if (inserted) {
      return {
        inserted: true,
        row: hydrateAnalysisRow(inserted),
      };
    }

    const existing = selectAnalysisByUniqueStmt.get(
      record.source,
      record.symbol_id,
      record.timeframe,
      record.last_candle_time
    );

    return {
      inserted: false,
      row: hydrateAnalysisRow(existing),
    };
  }

  function listRecentAnalysisRuns({ symbolId, limit = 20 }) {
    if (!symbolId) throw new Error('listRecentAnalysisRuns: symbolId is required');
    return listRecentStmt.all(symbolId, limit).map(hydrateAnalysisRow);
  }

  function listAnalysisRunsByTradeId(tradeId) {
    if (!tradeId) throw new Error('listAnalysisRunsByTradeId: tradeId is required');
    return listByTradeStmt.all(tradeId).map(hydrateAnalysisRow);
  }

  function listAnalysisRunsByGroupId(groupId) {
    if (!groupId) throw new Error('listAnalysisRunsByGroupId: groupId is required');
    return listByGroupStmt.all(groupId).map(hydrateAnalysisRow);
  }

  function createTradeCase(params) {
    if (!params || !params.symbolId || !params.status) {
      throw new Error('createTradeCase: symbolId and status are required');
    }

    const record = {
      id: params.id || crypto.randomUUID(),
      root_analysis_id: params.rootAnalysisId || null,
      symbol_id: params.symbolId,
      entry_timeframe: params.entryTimeframe || null,
      opened_at: normalizeIsoTime(params.openedAt) || new Date().toISOString(),
      closed_at: normalizeIsoTime(params.closedAt),
      status: params.status,
      entry_price: params.entryPrice ?? null,
      exit_price: params.exitPrice ?? null,
      outcome: params.outcome || null,
      outcome_json: params.outcomeJson == null ? null : JSON.stringify(params.outcomeJson),
    };

    insertTradeCaseStmt.run(record);
    return hydrateTradeCase(getTradeCaseStmt.get(record.id));
  }

  function getTradeCaseById(id) {
    if (!id) throw new Error('getTradeCaseById: id is required');
    return hydrateTradeCase(getTradeCaseStmt.get(id));
  }

  return {
    dbPath: resolvedPath,
    saveAnalysisRun,
    listRecentAnalysisRuns,
    listAnalysisRunsByTradeId,
    listAnalysisRunsByGroupId,
    createTradeCase,
    getTradeCaseById,
    close() {
      closeDatabase({ dbPath: resolvedPath });
    },
  };
}

module.exports = {
  createAnalysisRepository,
  buildAnalysisRunRecord,
};
