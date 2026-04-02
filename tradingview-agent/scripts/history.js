#!/usr/bin/env node
'use strict';

const { createAnalysisRepository } = require('../src/storage');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`
Usage:
  node scripts/history.js --symbol-id <SYMBOL_ID> [--limit <N>]
  node scripts/history.js --trade-id <TRADE_ID>
  node scripts/history.js --group-id <GROUP_ID>

Options:
  --symbol-id <str>  List recent snapshots for a symbol
  --trade-id  <str>  List snapshots linked to a trade case
  --group-id  <str>  List snapshots linked to an MTF or reanalysis group
  --limit     <n>    Limit for symbol queries (default: 20)
  --db-path   <path> Override PERSISTENCE_DB_PATH
  --pretty           Pretty-print JSON output
  --help             Show this help
`.trimStart());
}

function die(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv);
if (args.help) {
  printHelp();
  process.exit(0);
}

const selectorCount = ['symbol-id', 'trade-id', 'group-id']
  .filter((key) => !!args[key])
  .length;

if (selectorCount !== 1) {
  printHelp();
  die('exactly one of --symbol-id, --trade-id, or --group-id is required');
}

const pretty = !!args.pretty || process.stdout.isTTY;
const limit = parseInt(args.limit || '20', 10);

try {
  const repo = createAnalysisRepository({ dbPath: args['db-path'] });
  let result;

  if (args['symbol-id']) {
    result = repo.listRecentAnalysisRuns({ symbolId: args['symbol-id'], limit });
  } else if (args['trade-id']) {
    result = repo.listAnalysisRunsByTradeId(args['trade-id']);
  } else {
    result = repo.listAnalysisRunsByGroupId(args['group-id']);
  }

  repo.close();

  const output = pretty
    ? JSON.stringify(result, null, 2)
    : JSON.stringify(result);

  process.stdout.write(output + '\n');
} catch (err) {
  die(err.message);
}
