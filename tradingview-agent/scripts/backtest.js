#!/usr/bin/env node
'use strict';

/**
 * Backtesting CLI.
 *
 * Loads one or more OHLCV fixture files, validates them, replays the analysis
 * pipeline over each in a rolling window, evaluates forward outcomes, and
 * outputs a summary report.
 *
 * Usage:
 *   node scripts/backtest.js --file <path> --symbol <SYMBOL> --timeframe <TF> [options]
 *   node scripts/backtest.js --dir  <dir>  --timeframe <TF> [options]
 *
 * Fixture selection (one required):
 *   --file       <path>   Path to a single OHLCV fixture JSON
 *   --dir        <dir>    Directory of .json fixture files (multi-fixture mode)
 *
 * Required (single-fixture mode):
 *   --symbol     <str>    Symbol label (e.g. BTCUSDT)
 *
 * Required for both modes:
 *   --timeframe  <str>    Timeframe label (e.g. 1h)
 *
 * Optional:
 *   --symbol-id  <str>    Full symbolId (e.g. BINANCE:BTCUSDT). Defaults to --symbol.
 *   --lookahead  <n>      Forward bars for outcome evaluation (default: 10)
 *   --win-pct    <n>      Win threshold % (default: 1.5)
 *   --loss-pct   <n>      Loss threshold % (default: 0.75)
 *   --min-conf   <n>      Minimum signal confidence to evaluate (default: 0.4)
 *   --min-window <n>      Minimum candles before first analysis (default: 50)
 *   --entry-mode <str>    'next-open' (default) or 'close'
 *   --signals    <str>    Comma-separated signal filter (e.g. breakout_watch,pullback_watch)
 *   --skip-patterns       Skip chart pattern detection (faster; default: enabled)
 *   --output     <str>    Output format: 'json' (default) or 'table'
 *   --out-file   <path>   Write output to file instead of stdout
 *   --pretty              Pretty-print JSON output (default when stdout is a TTY)
 *   --help                Show this help message
 *
 * Fixture file format (JSON array, oldest-first):
 *   [
 *     { "time": 1700000000, "open": 40000, "high": 40500, "low": 39800, "close": 40200, "volume": 1234 },
 *     ...
 *   ]
 *   time must be a Unix timestamp in SECONDS.
 *
 * Examples:
 *   node scripts/backtest.js \
 *     --file test/fixtures/candles-btc-1h.json \
 *     --symbol BTCUSDT \
 *     --timeframe 1h \
 *     --lookahead 12 \
 *     --win-pct 2.0 \
 *     --loss-pct 1.0 \
 *     --output table
 *
 *   node scripts/backtest.js \
 *     --dir test/fixtures \
 *     --timeframe 1h \
 *     --signals breakout_watch,pullback_watch \
 *     --entry-mode close \
 *     --output table
 */

const fs   = require('fs');
const path = require('path');

const {
  runBacktest,
  buildReport,
  aggregateReports,
  formatTable,
  validateFixture,
  FixtureValidationError,
} = require('../src/backtest');

// ── Help ───────────────────────────────────────────────────────────────────────

const HELP = `
Usage:
  node scripts/backtest.js --file <path> --symbol <SYMBOL> --timeframe <TF> [options]
  node scripts/backtest.js --dir  <dir>  --timeframe <TF> [options]

Options:
  --file <path>        Single fixture JSON file
  --dir  <dir>         Directory of .json fixture files (multi-fixture mode)
  --symbol <str>       Symbol label (required in single-file mode)
  --timeframe <str>    Timeframe label (required)
  --symbol-id <str>    Full symbolId; defaults to --symbol
  --lookahead <n>      Forward bars for outcome evaluation (default: 10)
  --win-pct <n>        Win threshold % (default: 1.5)
  --loss-pct <n>       Loss threshold % (default: 0.75)
  --min-conf <n>       Minimum confidence to evaluate (default: 0.4)
  --min-window <n>     Minimum candles before first analysis (default: 50)
  --entry-mode <str>   'next-open' (default) or 'close'
  --signals <str>      Comma-separated signal filter
  --skip-patterns      Skip chart pattern detection
  --output <str>       'json' (default) or 'table'
  --out-file <path>    Write output to file
  --pretty             Pretty-print JSON
  --help               Show this help
`.trimStart();

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (raw.startsWith('--')) {
      const key = raw.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;  // boolean flag
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

// ── Validate required args ────────────────────────────────────────────────────

function die(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

const isDir  = !!args.dir;
const isFile = !!args.file;

if (!isDir && !isFile) die('one of --file or --dir is required');
if (isDir && isFile)   die('--file and --dir are mutually exclusive');
if (!args.timeframe)   die('--timeframe is required');
if (isFile && !args.symbol) die('--symbol is required when using --file');

const VALID_ENTRY_MODES = ['next-open', 'close'];
const entryModeArg = args['entry-mode'] || 'next-open';
if (!VALID_ENTRY_MODES.includes(entryModeArg)) {
  die(`--entry-mode must be one of: ${VALID_ENTRY_MODES.join(', ')}`);
}

const VALID_OUTPUT_FORMATS = ['json', 'table'];
const outputFormat = args.output || 'json';
if (!VALID_OUTPUT_FORMATS.includes(outputFormat)) {
  die(`--output must be one of: ${VALID_OUTPUT_FORMATS.join(', ')}`);
}

// ── Config ────────────────────────────────────────────────────────────────────

const timeframe    = args.timeframe;
const lookahead    = parseInt(args.lookahead    || '10',   10);
const winPct       = parseFloat(args['win-pct']  || '1.5');
const lossPct      = parseFloat(args['loss-pct'] || '0.75');
const minConf      = parseFloat(args['min-conf'] || '0.4');
const minWindow    = parseInt(args['min-window'] || '50',   10);
const skipPatterns = !!args['skip-patterns'];
const outFile      = args['out-file'] || null;
const pretty       = args.pretty || (!outFile && process.stdout.isTTY);

const signalsArg = args.signals
  ? args.signals.split(',').map((s) => s.trim()).filter(Boolean)
  : null;

// ── Fixture loader ─────────────────────────────────────────────────────────────

function loadFixture(filePath) {
  if (!fs.existsSync(filePath)) die(`fixture file not found: ${filePath}`);

  let candles;
  try {
    candles = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    die(`failed to parse fixture ${filePath}: ${err.message}`);
  }

  try {
    validateFixture(candles, { minCandles: minWindow });
  } catch (err) {
    if (err instanceof FixtureValidationError) {
      die(`invalid fixture ${path.basename(filePath)}: ${err.message}`);
    }
    throw err;
  }

  return candles;
}

/** Derive a symbol label from a fixture filename (e.g. "candles-btc-1h.json" → "candles-btc-1h") */
function symbolFromFilename(filePath) {
  return path.basename(filePath, '.json');
}

// ── Collect fixtures ───────────────────────────────────────────────────────────

let fixtures;  // Array of { filePath, symbol, symbolId, candles }

if (isFile) {
  const filePath = path.resolve(process.cwd(), args.file);
  const symbol   = args.symbol;
  const symbolId = args['symbol-id'] || symbol;
  const candles  = loadFixture(filePath);
  fixtures = [{ filePath, symbol, symbolId, candles }];
} else {
  const dirPath = path.resolve(process.cwd(), args.dir);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    die(`--dir path is not a directory: ${dirPath}`);
  }

  const jsonFiles = fs.readdirSync(dirPath)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dirPath, f))
    .sort();

  if (jsonFiles.length === 0) die(`no .json files found in: ${dirPath}`);

  fixtures = [];
  for (const filePath of jsonFiles) {
    const symbol   = symbolFromFilename(filePath);
    const symbolId = symbol;
    const candles  = loadFixture(filePath);
    fixtures.push({ filePath, symbol, symbolId, candles });
  }
}

// ── Run backtests ─────────────────────────────────────────────────────────────

process.stderr.write(
  `Running backtest: ${fixtures.length} fixture(s) | ${timeframe} | ` +
  `lookahead=${lookahead} win=${winPct}% loss=${lossPct}% entry=${entryModeArg}\n`
);

const reports = [];

for (const { filePath, symbol, symbolId, candles } of fixtures) {
  process.stderr.write(`  Processing ${path.basename(filePath)} (${candles.length} candles)...\n`);

  let steps;
  try {
    steps = runBacktest({
      candles,
      symbol,
      symbolId,
      timeframe,
      minWindow,
      lookaheadBars: lookahead,
      winPct,
      lossPct,
      minConfidence: minConf,
      skipPatterns,
      entryMode:     entryModeArg,
    });
  } catch (err) {
    die(`backtest failed for ${path.basename(filePath)}: ${err.message}`);
  }

  const report = buildReport({
    steps,
    symbol,
    timeframe,
    totalCandles:  candles.length,
    minWindow,
    lookaheadBars: lookahead,
    winPct,
    lossPct,
    minConfidence: minConf,
    entryMode:     entryModeArg,
    signals:       signalsArg,
  });

  reports.push(report);
}

// ── Aggregate if multi-fixture ────────────────────────────────────────────────

const result = reports.length === 1
  ? reports[0]
  : aggregateReports(reports);

// ── Output ────────────────────────────────────────────────────────────────────

let output;

if (outputFormat === 'table') {
  // Table always includes both the aggregate and per-fixture breakdowns
  const parts = [];
  if (reports.length > 1) {
    parts.push(formatTable(result));
    parts.push('\n  Per-fixture breakdown:\n');
    for (const r of reports) {
      parts.push(formatTable(r));
    }
  } else {
    parts.push(formatTable(result));
  }
  output = parts.join('');
} else {
  // JSON output: include per-fixture array when in multi-fixture mode
  const jsonResult = reports.length > 1
    ? { ...result, fixtures: reports }
    : result;
  output = pretty ? JSON.stringify(jsonResult, null, 2) : JSON.stringify(jsonResult);
  output += '\n';
}

if (outFile) {
  const outPath = path.resolve(process.cwd(), outFile);
  fs.writeFileSync(outPath, output, 'utf8');
  process.stderr.write(`Report written to ${outPath}\n`);
} else {
  process.stdout.write(output);
}
