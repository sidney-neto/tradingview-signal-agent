'use strict';

/**
 * Backtest report builder and formatters.
 *
 * Takes the raw step array from runBacktest() and computes summary statistics
 * per signal type, confidence bucket, and detected chart pattern.
 *
 * New sections added:
 *   confidenceBuckets — signal performance split by confidence range
 *   byPattern         — signal performance split by primary detected chart pattern
 *                       (only populated when skipPatterns=false in the runner)
 *                       Strategy: a signal is counted once under its PRIMARY pattern
 *                       (highest-confidence confirmed pattern, or first forming).
 *                       Signals with no detected pattern are grouped under "no_pattern".
 *
 * Output is a plain object suitable for JSON serialization or table display.
 */

const {
  DEFAULT_BUCKETS,
  buildConfidenceBuckets,
  combineConfidenceBuckets,
} = require('./buckets');

const ALL_SIGNAL_TYPES = ['breakout_watch', 'pullback_watch', 'bearish_breakdown_watch'];

/**
 * Build a summary report from backtest step results.
 *
 * @param {object} params
 * @param {Array}   params.steps          — raw output of runBacktest()
 * @param {string}  params.symbol
 * @param {string}  params.timeframe
 * @param {number}  params.totalCandles   — total candles in the fixture
 * @param {number}  params.minWindow
 * @param {number}  params.lookaheadBars
 * @param {number}  params.winPct
 * @param {number}  params.lossPct
 * @param {number}  params.minConfidence
 * @param {string}  [params.entryMode]    — 'next-open' | 'close' (default: 'next-open')
 * @param {Array}   [params.signals]      — signal types to include in eligible (default: all)
 * @param {Array}   [params.buckets]      — confidence bucket definitions (default: DEFAULT_BUCKETS)
 *
 * @returns {object} Summary report
 */
function buildReport({
  steps,
  symbol,
  timeframe,
  totalCandles,
  minWindow,
  lookaheadBars,
  winPct,
  lossPct,
  minConfidence,
  entryMode  = 'next-open',
  signals    = null,   // null = all actionable signal types
  buckets    = null,   // null = DEFAULT_BUCKETS
}) {
  const signalFilter = signals && signals.length ? signals : ALL_SIGNAL_TYPES;
  const bucketDefs   = buckets || DEFAULT_BUCKETS;

  // Eligible steps: not skipped, signal matches filter, meets confidence threshold
  const eligible = steps.filter(
    (s) => !s.skipped && signalFilter.includes(s.signal) && s.isEligible
  );

  // no_trade steps (not skipped, but signal = no_trade)
  const noTrade = steps.filter((s) => !s.skipped && s.signal === 'no_trade');

  // Processing-skipped steps (analyzeCandles threw)
  const analysisSkipped = steps.filter((s) => s.skipped);

  // ── Per-signal aggregation ────────────────────────────────────────────────

  const bySignal = {};
  for (const type of signalFilter) {
    const group = eligible.filter((s) => s.signal === type);
    bySignal[type] = aggregateGroup(group);
  }

  // ── Overall ───────────────────────────────────────────────────────────────

  const overall = aggregateGroup(eligible);

  // ── Confidence buckets ────────────────────────────────────────────────────

  const confidenceBuckets = buildConfidenceBuckets(steps, bucketDefs, aggregateGroup);

  // ── Pattern breakdown ─────────────────────────────────────────────────────
  // Each eligible step carries a `primaryPattern` field (null when skipPatterns=true).
  // Strategy: count each signal once under its primaryPattern.
  //           Signals with no detected pattern are grouped under "no_pattern".

  const byPattern = buildPatternBreakdown(eligible);

  // ── Return report object ──────────────────────────────────────────────────

  return {
    symbol,
    timeframe,
    config: {
      minWindow,
      lookaheadBars,
      winPct,
      lossPct,
      minConfidence,
      entryMode,
      signals:    signalFilter,
      buckets:    bucketDefs.map((b) => b.label),
    },
    totalCandles,
    totalSteps:           steps.length,
    totalEligible:        eligible.length,
    totalNoTrade:         noTrade.length,
    totalAnalysisSkipped: analysisSkipped.length,
    bySignal,
    overall,
    confidenceBuckets,
    byPattern,
    generatedAt:          new Date().toISOString(),
  };
}

/**
 * Aggregate multiple per-fixture reports into a combined summary.
 *
 * Each element of `reports` must be the output of buildReport().
 * Reports are assumed to share the same config (same lookahead, thresholds, etc.).
 *
 * @param {Array<object>} reports
 * @returns {object}
 */
function aggregateReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) {
    throw new Error('aggregateReports: reports must be a non-empty array');
  }

  // Infer signal list from the first report's bySignal keys
  const signalTypes = Object.keys(reports[0].bySignal);

  const bySignal = {};
  for (const type of signalTypes) {
    const groups = reports.map((r) => r.bySignal[type] || null).filter(Boolean);
    bySignal[type] = combineGroups(groups);
  }

  const overall = combineGroups(reports.map((r) => r.overall));

  // ── Aggregate confidence buckets ──────────────────────────────────────────
  const confidenceBuckets = combineConfidenceBuckets(
    reports.map((r) => r.confidenceBuckets),
    combineGroups
  );

  // ── Aggregate pattern breakdown ───────────────────────────────────────────
  const byPattern = combinePatternBreakdowns(reports.map((r) => r.byPattern));

  // ── Per-timeframe breakdown (useful when fixtures span multiple timeframes) ─
  const byTimeframe = buildTimeframeBreakdown(reports);

  // ── Per-fixture breakdown ─────────────────────────────────────────────────
  const byFixture = reports.map((r) => ({
    symbol:    r.symbol,
    timeframe: r.timeframe,
    overall:   r.overall,
    bySignal:  r.bySignal,
  }));

  return {
    fixtureCount:         reports.length,
    symbols:              reports.map((r) => r.symbol),
    config:               reports[0].config,  // all fixtures share the same config
    totalCandles:         reports.reduce((s, r) => s + r.totalCandles,          0),
    totalSteps:           reports.reduce((s, r) => s + r.totalSteps,            0),
    totalEligible:        reports.reduce((s, r) => s + r.totalEligible,         0),
    totalNoTrade:         reports.reduce((s, r) => s + r.totalNoTrade,          0),
    totalAnalysisSkipped: reports.reduce((s, r) => s + r.totalAnalysisSkipped,  0),
    bySignal,
    overall,
    confidenceBuckets,
    byPattern,
    byTimeframe,
    byFixture,
    generatedAt:          new Date().toISOString(),
  };
}

/**
 * Format a report (or aggregated report) as a plain-text table for CLI display.
 *
 * @param {object} report — output of buildReport() or aggregateReports()
 * @returns {string}
 */
function formatTable(report) {
  const lines = [];

  const header = report.fixtureCount != null
    ? `Aggregate — ${report.fixtureCount} fixture(s): ${report.symbols.join(', ')}`
    : `${report.symbol}  ${report.timeframe}`;

  lines.push('');
  lines.push(`  ${header}`);
  lines.push(`  Candles: ${report.totalCandles}  |  Steps: ${report.totalSteps}  |  Eligible: ${report.totalEligible}  |  No-trade: ${report.totalNoTrade}`);

  const cfg = report.config;
  lines.push(
    `  Config: lookahead=${cfg.lookaheadBars}  win=${cfg.winPct}%  loss=${cfg.lossPct}%  minConf=${cfg.minConfidence}  entry=${cfg.entryMode}`
  );

  // ── By Signal ─────────────────────────────────────────────────────────────
  lines.push('');
  lines.push('  Signal                        Count   Wins  Losses  Expired  Win-Rate  Avg Conf');
  lines.push('  ' + '─'.repeat(85));

  const signalTypes = Object.keys(report.bySignal);
  for (const type of signalTypes) {
    const g = report.bySignal[type];
    lines.push(formatRow(type, g));
  }

  lines.push('  ' + '─'.repeat(85));
  lines.push(formatRow('overall', report.overall));
  lines.push('');

  // ── Confidence Buckets ────────────────────────────────────────────────────
  if (report.confidenceBuckets && Object.keys(report.confidenceBuckets).length > 0) {
    lines.push('  Confidence Buckets            Count   Wins  Losses  Expired  Win-Rate  Avg Conf');
    lines.push('  ' + '─'.repeat(85));
    for (const [label, g] of Object.entries(report.confidenceBuckets)) {
      lines.push(formatRow(label, g));
    }
    lines.push('');
  }

  // ── By Pattern ───────────────────────────────────────────────────────────
  if (report.byPattern && Object.keys(report.byPattern).length > 0) {
    lines.push('  Pattern                       Count   Wins  Losses  Expired  Win-Rate  Avg Conf');
    lines.push('  ' + '─'.repeat(85));
    for (const [label, g] of Object.entries(report.byPattern)) {
      lines.push(formatRow(label, g));
    }
    lines.push('');
  }

  // ── By Timeframe (aggregate only) ────────────────────────────────────────
  if (report.byTimeframe && Object.keys(report.byTimeframe).length > 0) {
    lines.push('  Timeframe                     Count   Wins  Losses  Expired  Win-Rate  Avg Conf');
    lines.push('  ' + '─'.repeat(85));
    for (const [tf, g] of Object.entries(report.byTimeframe)) {
      lines.push(formatRow(tf, g));
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Aggregate outcome statistics for a group of eligible steps.
 */
function aggregateGroup(group) {
  if (!group || group.length === 0) {
    return {
      count:         0,
      wins:          0,
      losses:        0,
      expired:       0,
      decided:       0,
      winRate:       null,
      avgConfidence: null,
      avgMfePct:     null,
      avgMaePct:     null,
    };
  }

  const wins    = group.filter((s) => s.outcome === 'win').length;
  const losses  = group.filter((s) => s.outcome === 'loss').length;
  const expired = group.filter((s) => s.outcome === 'expired').length;

  // Win rate: wins / (wins + losses); expired excluded from denominator.
  const decided = wins + losses;
  const winRate = decided > 0 ? round2(wins / decided) : null;

  const avgConfidence = round2(avg(group.map((s) => s.confidence)));

  const mfePcts = group.map((s) => s.mfePct).filter((v) => v != null);
  const maePcts = group.map((s) => s.maePct).filter((v) => v != null);

  return {
    count:         group.length,
    wins,
    losses,
    expired,
    decided,
    winRate,
    avgConfidence,
    avgMfePct:     mfePcts.length ? round2(avg(mfePcts)) : null,
    avgMaePct:     maePcts.length ? round2(avg(maePcts)) : null,
  };
}

/**
 * Combine an array of already-aggregated group objects into one.
 * Recomputes winRate and averages from summed raw counts.
 */
function combineGroups(groups) {
  const count   = groups.reduce((s, g) => s + g.count,   0);
  const wins    = groups.reduce((s, g) => s + g.wins,    0);
  const losses  = groups.reduce((s, g) => s + g.losses,  0);
  const expired = groups.reduce((s, g) => s + g.expired, 0);

  const decided = wins + losses;
  const winRate = decided > 0 ? round2(wins / decided) : null;

  // Weighted average confidence
  const totalConf = groups.reduce((s, g) => s + (g.avgConfidence != null ? g.avgConfidence * g.count : 0), 0);
  const avgConfidence = count > 0 ? round2(totalConf / count) : null;

  const totalMfe = groups.reduce((s, g) => s + (g.avgMfePct != null ? g.avgMfePct * g.count : 0), 0);
  const totalMae = groups.reduce((s, g) => s + (g.avgMaePct != null ? g.avgMaePct * g.count : 0), 0);

  return {
    count,
    wins,
    losses,
    expired,
    decided,
    winRate,
    avgConfidence,
    avgMfePct: count > 0 ? round2(totalMfe / count) : null,
    avgMaePct: count > 0 ? round2(totalMae / count) : null,
  };
}

/**
 * Build per-pattern breakdown from eligible steps.
 *
 * Counting strategy: each signal is counted exactly once under its primaryPattern.
 * Signals with no detected pattern (null) are counted under "no_pattern".
 *
 * @param {Array} eligible — already-filtered eligible steps
 * @returns {object} Map of patternType → aggregated stats
 */
function buildPatternBreakdown(eligible) {
  const groups = {};
  for (const step of eligible) {
    const key = step.primaryPattern || 'no_pattern';
    if (!groups[key]) groups[key] = [];
    groups[key].push(step);
  }

  const result = {};
  for (const [pattern, group] of Object.entries(groups)) {
    result[pattern] = aggregateGroup(group);
  }
  return result;
}

/**
 * Combine pattern breakdown maps from multiple per-fixture reports.
 *
 * @param {Array<object>} patternMaps
 * @returns {object}
 */
function combinePatternBreakdowns(patternMaps) {
  const allKeys = new Set();
  for (const m of patternMaps) {
    if (m) Object.keys(m).forEach((k) => allKeys.add(k));
  }

  const result = {};
  for (const key of allKeys) {
    const groups = patternMaps.map((m) => (m && m[key]) ? m[key] : null).filter(Boolean);
    result[key] = combineGroups(groups);
  }
  return result;
}

/**
 * Build a per-timeframe breakdown from an array of per-fixture reports.
 * Groups reports by timeframe and combines their overall stats.
 *
 * @param {Array<object>} reports
 * @returns {object} Map of timeframe → aggregated overall stats
 */
function buildTimeframeBreakdown(reports) {
  const byTf = {};
  for (const r of reports) {
    const tf = r.timeframe;
    if (!byTf[tf]) byTf[tf] = [];
    byTf[tf].push(r.overall);
  }

  const result = {};
  for (const [tf, groups] of Object.entries(byTf)) {
    result[tf] = combineGroups(groups);
  }
  return result;
}

function formatRow(label, g) {
  const padded    = label.padEnd(28);
  const count     = String(g.count).padStart(5);
  const wins      = String(g.wins).padStart(6);
  const losses    = String(g.losses).padStart(7);
  const expired   = String(g.expired).padStart(8);
  const winRate   = g.winRate != null ? `${(g.winRate * 100).toFixed(1)}%`.padStart(9) : '     n/a';
  const avgConf   = g.avgConfidence != null ? g.avgConfidence.toFixed(2).padStart(9) : '     n/a';
  return `  ${padded} ${count} ${wins} ${losses} ${expired} ${winRate} ${avgConf}`;
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round2(n) {
  if (n === null || n === undefined) return null;
  return Math.round(n * 100) / 100;
}

module.exports = { buildReport, aggregateReports, formatTable };
