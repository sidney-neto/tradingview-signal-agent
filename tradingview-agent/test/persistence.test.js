'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-agent-persist-'));
  return {
    dir,
    dbPath: path.join(dir, 'history.sqlite'),
  };
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeAnalysis(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    symbolId: 'BINANCE:BTCUSDT',
    exchange: 'BINANCE',
    description: 'Bitcoin / TetherUS',
    timeframe: '1h',
    price: 65000,
    trend: 'bullish',
    momentum: 'neutral_bullish',
    volumeState: 'average',
    volatilityState: 'moderate',
    signal: 'pullback_watch',
    confidence: 0.62,
    invalidation: 'Close below EMA50',
    targets: ['EMA20 retest'],
    summary: 'Resumo',
    indicators: { ema20: 64800, ema50: 64000, ema100: 63000, ema200: 61000, ma200: 60800, rsi14: 57, avgVolume20: 1234, atr14: 250 },
    trendlineState: { activeTrendlineType: 'bullish', lineBreakDetected: false, lineBreakDirection: 'none' },
    zoneState: { zoneType: 'none', explanation: '' },
    perpContext: null,
    macroContext: null,
    bybitContext: null,
    marketBreadthContext: null,
    trendingContext: null,
    confidenceBreakdown: { base: 0.66, afterQuality: 0.62, cgAdjustment: 0, bybitAdjustment: 0, cgkoAdjustment: 0, final: 0.62 },
    dataQuality: 'good',
    warnings: [],
    chartPatterns: [],
    marketRegime: { regime: 'risk_on', available: true, reasons: [] },
    tradeQualification: { setupQuality: 'high', tradeBias: 'long' },
    candleCount: 300,
    lastCandleTime: '2026-04-01T12:00:00.000Z',
    timestamp: '2026-04-01T12:01:00.000Z',
    ...overrides,
  };
}

function makePersistParams(overrides = {}) {
  return {
    source: 'tradingview_webhook',
    correlationId: 'corr-1',
    request: { query: 'BTCUSDT', timeframe: '1h' },
    rawPayload: { query: 'BTCUSDT', timeframe: '1h', message: 'alert' },
    analysis: makeAnalysis(),
    groupId: 'group-1',
    parentAnalysisId: null,
    tradeId: null,
    engineVersion: '0.1.0-test',
    ...overrides,
  };
}

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function stubModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
}

(async () => {
  // ── storage/analysisRepository ─────────────────────────────────────────────
  {
    const { dir, dbPath } = makeTempDbPath();

    try {
      const { createAnalysisRepository } = require('../src/storage/analysisRepository');
      const repo = createAnalysisRepository({ dbPath });

      const saved = repo.saveAnalysisRun(makePersistParams());

      assert.strictEqual(saved.inserted, true, 'first save inserts a new analysis row');
      assert.ok(saved.row && saved.row.id, 'saved row has an id');
      assert.strictEqual(saved.row.source, 'tradingview_webhook', 'source persisted');
      assert.strictEqual(saved.row.last_candle_time, '2026-04-01T12:00:00.000Z', 'last_candle_time persisted');
      assert.strictEqual(saved.row.setup_quality, 'high', 'setup_quality extracted from tradeQualification');
      assert.strictEqual(saved.row.trade_bias, 'long', 'trade_bias extracted from tradeQualification');
      assert.strictEqual(saved.row.market_regime, 'risk_on', 'market_regime extracted from marketRegime');
      assert.ok(fs.existsSync(dbPath), 'database file created on first write');

      const recent = repo.listRecentAnalysisRuns({ symbolId: 'BINANCE:BTCUSDT', limit: 5 });
      assert.strictEqual(recent.length, 1, 'recent history returns inserted row');
      assert.strictEqual(recent[0].analysis_json.symbolId, 'BINANCE:BTCUSDT', 'analysis_json is parsed on read');
      assert.strictEqual(recent[0].request_json.query, 'BTCUSDT', 'request_json is parsed on read');
      assert.strictEqual(recent[0].warnings_json.length, 0, 'warnings_json is parsed on read');

      repo.close();
    } finally {
      cleanupTempDir(dir);
    }
  }

  console.log('✓ storage/analysisRepository: initializes schema and persists analysis_runs');

  {
    const { dir, dbPath } = makeTempDbPath();

    try {
      const { createAnalysisRepository } = require('../src/storage/analysisRepository');
      const repo = createAnalysisRepository({ dbPath });

      const first = repo.saveAnalysisRun(makePersistParams());
      const duplicate = repo.saveAnalysisRun(makePersistParams({
        correlationId: 'corr-2',
        groupId: 'group-2',
      }));

      assert.strictEqual(first.inserted, true, 'first identical snapshot inserts');
      assert.strictEqual(duplicate.inserted, false, 'duplicate candle snapshot is ignored');
      assert.strictEqual(duplicate.row.id, first.row.id, 'duplicate returns existing row');

      const all = repo.listRecentAnalysisRuns({ symbolId: 'BINANCE:BTCUSDT', limit: 10 });
      assert.strictEqual(all.length, 1, 'unique key prevents duplicate snapshots');

      repo.close();
    } finally {
      cleanupTempDir(dir);
    }
  }

  console.log('✓ storage/analysisRepository: deduplicates identical candle snapshots');

  {
    const { dir, dbPath } = makeTempDbPath();

    try {
      const { createAnalysisRepository } = require('../src/storage/analysisRepository');
      const repo = createAnalysisRepository({ dbPath });

      const root = repo.saveAnalysisRun(makePersistParams({
        groupId: 'group-mtf-1',
        analysis: makeAnalysis({
          timeframe: '1h',
          timestamp: '2026-04-01T12:01:00.000Z',
        }),
      }));

      const tradeCase = repo.createTradeCase({
        rootAnalysisId: root.row.id,
        symbolId: 'BINANCE:BTCUSDT',
        entryTimeframe: '1h',
        openedAt: '2026-04-01T12:05:00.000Z',
        status: 'open',
        entryPrice: 65010,
      });

      assert.ok(tradeCase.id, 'trade case created');

      repo.saveAnalysisRun(makePersistParams({
        groupId: 'group-mtf-1',
        tradeId: tradeCase.id,
        analysis: makeAnalysis({
          timeframe: '4h',
          lastCandleTime: '2026-04-01T12:00:00.000Z',
          timestamp: '2026-04-01T12:02:00.000Z',
        }),
        request: { query: 'BTCUSDT', timeframe: '4h' },
        rawPayload: { query: 'BTCUSDT', timeframe: '4h' },
      }));

      const byGroup = repo.listAnalysisRunsByGroupId('group-mtf-1');
      assert.strictEqual(byGroup.length, 2, 'group history returns both MTF snapshots');
      assert.deepStrictEqual(byGroup.map((row) => row.timeframe).sort(), ['1h', '4h'], 'group history spans both timeframes');

      const byTrade = repo.listAnalysisRunsByTradeId(tradeCase.id);
      assert.strictEqual(byTrade.length, 1, 'trade history returns linked snapshots');
      assert.strictEqual(byTrade[0].trade_id, tradeCase.id, 'trade_id persisted');

      const loadedTrade = repo.getTradeCaseById(tradeCase.id);
      assert.strictEqual(loadedTrade.status, 'open', 'trade case can be read back');
      assert.strictEqual(loadedTrade.entry_timeframe, '1h', 'trade case fields persisted');

      repo.close();
    } finally {
      cleanupTempDir(dir);
    }
  }

  console.log('✓ storage/analysisRepository: reads by group_id and trade_id');

  // ── tools/analyzeMarket: lastCandleTime ───────────────────────────────────
  {
    const analyzeMarketPath = '../src/tools/analyzeMarket';
    const symbolCachePath = '../src/cache/symbolCache';
    const candleCachePath = '../src/cache/candleCache';

    clearModule(analyzeMarketPath);
    clearModule(symbolCachePath);
    clearModule(candleCachePath);

    stubModule(symbolCachePath, {
      resolveSymbolCached: async () => ({
        id: 'BINANCE:BTCUSDT',
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        description: 'Bitcoin / TetherUS',
      }),
    });

    stubModule(candleCachePath, {
      fetchCandlesCached: async () => {
        const base = 1711962000;
        return Array.from({ length: 300 }, (_, index) => ({
          time: base + (index * 3600),
          open: 60000 + index,
          high: 60010 + index,
          low: 59990 + index,
          close: 60005 + index,
          volume: 1000 + index,
        }));
      },
    });

    try {
      const { analyzeMarket } = require(analyzeMarketPath);
      const result = await analyzeMarket({
        query: 'BTCUSDT',
        timeframe: '1h',
        options: {
          skipCoinGlass: true,
          skipCoinGecko: true,
          skipBybit: true,
        },
      });

      assert.strictEqual(result.lastCandleTime, new Date((1711962000 + (299 * 3600)) * 1000).toISOString(), 'lastCandleTime comes from the final candle');
      assert.ok(result.timestamp, 'analysis timestamp remains present');
    } finally {
      clearModule(analyzeMarketPath);
      clearModule(symbolCachePath);
      clearModule(candleCachePath);
    }
  }

  console.log('✓ tools/analyzeMarket: adds lastCandleTime without removing timestamp');

  // ── tools/analyzeMarketMTF: persistence integration ────────────────────────
  {
    const { dir, dbPath } = makeTempDbPath();
    const analyzeMarketModulePath = '../src/tools/analyzeMarket';
    const analyzeMarketMTFPath = '../src/tools/analyzeMarketMTF';

    clearModule(analyzeMarketMTFPath);
    clearModule(analyzeMarketModulePath);

    stubModule(analyzeMarketModulePath, {
      analyzeMarket: async ({ timeframe }) => makeAnalysis({
        timeframe,
        lastCandleTime: '2026-04-01T12:00:00.000Z',
        timestamp: timeframe === '1h'
          ? '2026-04-01T12:01:00.000Z'
          : '2026-04-01T12:01:30.000Z',
        signal: timeframe === '1h' ? 'pullback_watch' : 'breakout_watch',
      }),
    });

    try {
      const { analyzeMarketMTF } = require(analyzeMarketMTFPath);
      const result = await analyzeMarketMTF({
        query: 'BTCUSDT',
        timeframes: ['1h', '4h'],
        options: {
          persistence: {
            enabled: true,
            dbPath,
            source: 'mtf_manual',
            correlationId: 'corr-mtf-1',
            tradeId: 'trade-x',
          },
        },
      });

      assert.ok(result.persistence && result.persistence.groupId, 'MTF result exposes persistence groupId');

      const { createAnalysisRepository } = require('../src/storage/analysisRepository');
      const repo = createAnalysisRepository({ dbPath });
      const byGroup = repo.listAnalysisRunsByGroupId(result.persistence.groupId);
      assert.strictEqual(byGroup.length, 2, 'MTF persistence writes one row per timeframe');
      assert.deepStrictEqual(byGroup.map((row) => row.timeframe).sort(), ['1h', '4h'], 'persisted MTF rows keep timeframe separation');
      assert.ok(byGroup.every((row) => row.group_id === result.persistence.groupId), 'all MTF rows share the same group_id');
      repo.close();
    } finally {
      clearModule(analyzeMarketMTFPath);
      clearModule(analyzeMarketModulePath);
      cleanupTempDir(dir);
    }
  }

  console.log('✓ tools/analyzeMarketMTF: persists grouped snapshots');

  // ── API route: /analyze persistence integration ────────────────────────────
  {
    const { dir, dbPath } = makeTempDbPath();
    const analyzeRoutePath = '../src/api/routes/analyze';
    const analyzeMarketPath = '../src/tools/analyzeMarket';

    clearModule(analyzeRoutePath);
    clearModule(analyzeMarketPath);

    process.env.PERSISTENCE_ENABLED = 'true';
    process.env.PERSIST_ANALYZE_ROUTE = 'true';
    process.env.PERSISTENCE_DB_PATH = dbPath;

    stubModule(analyzeMarketPath, {
      analyzeMarket: async ({ timeframe }) => makeAnalysis({ timeframe }),
    });

    try {
      const analyzeRouter = require(analyzeRoutePath);
      const postLayer = analyzeRouter.stack.find(
        (layer) => layer.route && layer.route.methods && layer.route.methods.post
      );
      const handler = postLayer.route.stack[0].handle;

      const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
      };

      await handler(
        { body: { query: 'BTCUSDT', timeframe: '1h', options: {} } },
        res,
        (err) => { throw err || new Error('next called unexpectedly'); }
      );

      assert.strictEqual(res.statusCode, 200, '/analyze returns 200 when analysis succeeds');

      const { createAnalysisRepository } = require('../src/storage/analysisRepository');
      const repo = createAnalysisRepository({ dbPath });
      const rows = repo.listRecentAnalysisRuns({ symbolId: 'BINANCE:BTCUSDT', limit: 5 });
      assert.strictEqual(rows.length, 1, '/analyze persistence writes one snapshot');
      assert.strictEqual(rows[0].source, 'api_analyze', '/analyze uses api_analyze source');
      repo.close();
    } finally {
      delete process.env.PERSISTENCE_ENABLED;
      delete process.env.PERSIST_ANALYZE_ROUTE;
      delete process.env.PERSISTENCE_DB_PATH;
      clearModule(analyzeRoutePath);
      clearModule(analyzeMarketPath);
      cleanupTempDir(dir);
    }
  }

  console.log('✓ api/routes/analyze: persists snapshots when env is enabled');

  // ── API route: /webhook/tradingview persistence integration ────────────────
  {
    const { dir, dbPath } = makeTempDbPath();
    const webhookRoutePath = '../src/api/routes/webhookTradingView';
    const analyzeMarketPath = '../src/tools/analyzeMarket';
    const deliveryPath = '../src/delivery';

    clearModule(webhookRoutePath);
    clearModule(analyzeMarketPath);
    clearModule(deliveryPath);

    process.env.PERSISTENCE_ENABLED = 'true';
    process.env.PERSISTENCE_DB_PATH = dbPath;

    stubModule(analyzeMarketPath, {
      analyzeMarket: async ({ timeframe }) => makeAnalysis({ timeframe }),
    });

    stubModule(deliveryPath, {
      deliverAnalysis: async () => [],
    });

    try {
      const { handleWebhook } = require(webhookRoutePath);
      const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; },
      };

      await handleWebhook(
        { body: { query: 'BTCUSDT', timeframe: '1h' }, ip: '127.0.0.1' },
        res
      );

      assert.strictEqual(res.statusCode, 200, '/webhook returns 200 when analysis succeeds');

      const { createAnalysisRepository } = require('../src/storage/analysisRepository');
      const repo = createAnalysisRepository({ dbPath });
      const rows = repo.listRecentAnalysisRuns({ symbolId: 'BINANCE:BTCUSDT', limit: 5 });
      assert.strictEqual(rows.length, 1, '/webhook persistence writes one snapshot');
      assert.strictEqual(rows[0].source, 'tradingview_webhook', '/webhook uses tradingview_webhook source');
      assert.ok(rows[0].correlation_id, '/webhook persists correlation id');
      repo.close();
    } finally {
      delete process.env.PERSISTENCE_ENABLED;
      delete process.env.PERSISTENCE_DB_PATH;
      clearModule(webhookRoutePath);
      clearModule(analyzeMarketPath);
      clearModule(deliveryPath);
      cleanupTempDir(dir);
    }
  }

  console.log('✓ api/routes/webhookTradingView: persists snapshots when enabled');

  console.log('\n✅ All persistence.test.js tests passed\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
