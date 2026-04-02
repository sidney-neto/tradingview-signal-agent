'use strict';

const fs = require('fs');
const path = require('path');

const { initializeSchema } = require('./schema');

const databaseCache = new Map();

function resolveDbPath(explicitPath) {
  const rawPath = explicitPath || process.env.PERSISTENCE_DB_PATH || './data/tradingview-agent.sqlite';
  return rawPath === ':memory:'
    ? rawPath
    : path.resolve(process.cwd(), rawPath);
}

function loadSqliteModule() {
  try {
    return require('node:sqlite');
  } catch (err) {
    const wrapped = new Error(
      'SQLite persistence requires Node.js with support for the built-in "node:sqlite" module.'
    );
    wrapped.cause = err;
    throw wrapped;
  }
}

function ensureParentDirectory(dbPath) {
  if (dbPath === ':memory:') return;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function openDatabase({ dbPath } = {}) {
  const resolvedPath = resolveDbPath(dbPath);
  const cached = databaseCache.get(resolvedPath);
  if (cached) return cached;

  ensureParentDirectory(resolvedPath);

  const { DatabaseSync } = loadSqliteModule();
  const db = new DatabaseSync(resolvedPath);

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  initializeSchema(db);

  databaseCache.set(resolvedPath, db);
  return db;
}

function closeDatabase({ dbPath } = {}) {
  const resolvedPath = resolveDbPath(dbPath);
  const db = databaseCache.get(resolvedPath);
  if (!db) return;
  db.close();
  databaseCache.delete(resolvedPath);
}

function closeAllDatabases() {
  for (const [dbPath, db] of databaseCache.entries()) {
    db.close();
    databaseCache.delete(dbPath);
  }
}

module.exports = {
  resolveDbPath,
  openDatabase,
  closeDatabase,
  closeAllDatabases,
};
