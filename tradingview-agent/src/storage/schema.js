'use strict';

const SCHEMA_SQL = `
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS analysis_runs (
  id                TEXT PRIMARY KEY,
  group_id          TEXT,
  parent_analysis_id TEXT,
  trade_id          TEXT,
  source            TEXT NOT NULL,
  correlation_id    TEXT,
  query             TEXT,
  symbol            TEXT NOT NULL,
  symbol_id         TEXT NOT NULL,
  exchange          TEXT,
  timeframe         TEXT NOT NULL,
  analyzed_at       TEXT NOT NULL,
  last_candle_time  TEXT NOT NULL,
  candle_count      INTEGER,
  price             REAL,
  signal            TEXT,
  confidence        REAL,
  data_quality      TEXT,
  trend             TEXT,
  momentum          TEXT,
  setup_quality     TEXT,
  trade_bias        TEXT,
  market_regime     TEXT,
  request_json      TEXT,
  raw_payload_json  TEXT,
  analysis_json     TEXT NOT NULL,
  warnings_json     TEXT,
  engine_version    TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_runs_dedup
  ON analysis_runs (source, symbol_id, timeframe, last_candle_time);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_symbol_time
  ON analysis_runs (symbol_id, analyzed_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_group_id
  ON analysis_runs (group_id, analyzed_at ASC);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_trade_id
  ON analysis_runs (trade_id, analyzed_at ASC);

CREATE TABLE IF NOT EXISTS trade_cases (
  id               TEXT PRIMARY KEY,
  root_analysis_id TEXT,
  symbol_id        TEXT NOT NULL,
  entry_timeframe  TEXT,
  opened_at        TEXT,
  closed_at        TEXT,
  status           TEXT NOT NULL,
  entry_price      REAL,
  exit_price       REAL,
  outcome          TEXT,
  outcome_json     TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_trade_cases_symbol_id
  ON trade_cases (symbol_id, opened_at DESC);
`;

function initializeSchema(db) {
  db.exec(SCHEMA_SQL);
}

module.exports = {
  SCHEMA_SQL,
  initializeSchema,
};
