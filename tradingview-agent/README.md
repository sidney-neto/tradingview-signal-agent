# tradingview-agent

A deterministic market-analysis engine and backend service. Fetches OHLCV candles from TradingView via WebSocket, runs a local technical analysis pipeline, and returns structured, auditable signal objects.

Designed for use by AI agents (OpenClaw), Telegram bots, and any system that needs explainable technical analysis from a natural-language symbol query.

---

## What's implemented

- **REST API** — `GET /health`, `POST /analyze`, `POST /webhook/tradingview`
- **Analysis pipeline** — indicators, trend/momentum classification, signal detection, chart patterns, confidence scoring, optional overlay adjustments (CoinGlass, Bybit, CoinGecko)
- **Multi-timeframe analysis** — concurrent analysis across multiple timeframes
- **TradingView webhook ingestion** — normalize payload → dedup → analyze → respond
- **Delivery layer** — send analysis results to Telegram and/or OpenClaw after webhook events
- **Backtesting** — rolling-window replay over OHLCV fixture files with hit-rate stats
- **TTL cache** — in-memory caching for symbol resolution, candles, and overlay fetches

---

## Architecture

```
tradingview-agent/
  src/
    tools/
      analyzeMarket.js      ← single-timeframe entry point
      analyzeMarketMTF.js   ← multi-timeframe wrapper (concurrent)
      openclawAnalyzeMarket.js ← OpenClaw tool contract wrapper
    analyzer/
      pipeline.js           ← shared analysis pipeline (used by tools/ and backtest/)
      indicators.js         ← EMA(n), SMA(n)
      rsi.js                ← RSI 14 (Wilder smoothing)
      atr.js                ← ATR 14 (Wilder smoothing)
      volume.js             ← average volume (20)
      pivots.js             ← pivot high/low detection
      trendlines.js         ← up/down trendlines + line-break detection
      zones.js              ← consolidation + accumulation zone detection
      rules.js              ← trend, momentum, signal classification
      scoring.js            ← data-quality assessment + confidence adjustment
      summary.js            ← PT-BR human-readable summary generation
      perpContext.js        ← CoinGlass confidence overlay
      bybitContext.js       ← Bybit context helpers
      marketContext.js      ← CoinGecko confidence overlay
      patterns/
        index.js            ← detectChartPatterns() entrypoint
        *.js                ← 15 pattern detectors (H&S, double top/bottom, triangles, flags, wedges, …)
    api/
      server.js             ← Express app: /health, /analyze, /webhook/tradingview
      middleware/
        auth.js             ← requireApiKey (x-api-key header)
        rateLimit.js        ← rateLimit singleton + createRateLimit() factory
        webhookAuth.js      ← requireWebhookSecret (header or body field)
      routes/
        health.js           ← GET /health
        analyze.js          ← POST /analyze
        webhookTradingView.js ← POST /webhook/tradingview (normalize → dedup → analyze → deliver)
    delivery/
      dispatcher.js         ← deliverAnalysis() — fan-out to configured providers
      formatter.js          ← formatTelegramMessage(), formatOpenClawPayload()
      providers/
        telegram.js         ← POST to Telegram Bot API (native fetch)
        openclaw.js         ← POST to OPENCLAW_DELIVERY_URL (native fetch)
      index.js              ← barrel export
    backtest/
      analyzeCandles.js     ← analysis pipeline over pre-loaded candles (no network)
      runner.js             ← rolling-window replay
      evaluate.js           ← win/loss/expired + MFE/MAE
      report.js             ← bySignal, byPattern, byTimeframe, confidenceBuckets stats
      buckets.js            ← confidence bucket definitions and assignment
      validateFixture.js    ← fixture schema validation
      index.js              ← barrel export
    cache/
      symbolCache.js        ← TTL cache for symbol resolution
      candleCache.js        ← TTL cache for candle fetches
      overlayCache.js       ← TTL cache for CoinGlass/Bybit/CoinGecko
    adapters/tradingview/   ← thin adapter over @mathieuc/tradingview npm package
      symbolSearch.js       ← resolves query → symbolId
      candles.js            ← fetches OHLCV via WebSocket (one-shot)
      errors.js             ← domain error classes
    adapters/coinglass/     ← optional perp/macro context (read-only)
    adapters/bybit/         ← optional Bybit V5 public market data (read-only)
    adapters/coingecko/     ← optional market breadth context (read-only)
    config/
      defaults.js           ← tunable defaults (candle count, timeouts, etc.)
    utils/
      timeframes.js         ← timeframe mapping + validation
      validation.js         ← input validation
    logger.js               ← newline-delimited JSON logger
  backtest/
  test/
    smoke.js                ← 78 test groups (no network required)
  scripts/
    backtest.js             ← backtest CLI
```

Depends on `@mathieuc/tradingview` as an npm package (listed in `package.json`).

---

## Quick start

```bash
# From this directory
npm install

# Run the smoke tests (78 test groups, no network required)
node test/smoke.js

# Start the REST API server (port 3000 by default)
API_KEY=your_secret npm run start:api
# Or: PORT=8080 API_KEY=your_secret npm run start:api
```

---

## REST API

The API server is a minimal Express application. Start it with:

```bash
API_KEY=your_secret npm run start:api
# Listens on PORT env var (default: 3000)
```

### Authentication

Protected endpoints require an `x-api-key` header. Set the `API_KEY` environment variable before starting the server.

```bash
# Production
API_KEY=my-secret-key npm run start:api

# Development (no auth)
DISABLE_AUTH=true npm run start:api
```

**Auth behavior:**

| Condition | Result |
|-----------|--------|
| `API_KEY` set, correct key sent | Request passes |
| `API_KEY` set, no header | `401 Unauthorized` |
| `API_KEY` set, wrong header value | `403 Forbidden` |
| `API_KEY` not set, `DISABLE_AUTH≠true` | All protected requests → `401` |
| `DISABLE_AUTH=true` | All requests pass (dev mode; warning logged at startup) |

The provided key value is **never logged**.

### Rate limiting

Rate limiting is applied to `POST /analyze` (after auth). Configuration:

| Env var | Default | Description |
|---------|---------|-------------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window size in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `20` | Max requests per IP per window |

Exceeded limit returns `429` with headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

> **Multi-instance note:** Rate limit state is in-process only. Each instance maintains its own counter. For multi-instance deployments, a Redis-backed limiter is recommended.

### GET /health

Public endpoint — no auth required. Returns a liveness probe payload.

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

Returns a liveness probe payload.

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### POST /analyze

Runs `analyzeMarket` and returns the full structured result as JSON.

**Request body:**
```json
{
  "query":     "BTC",
  "timeframe": "1h",
  "options":   {}
}
```

**Example (with auth):**
```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_secret" \
  -d '{"query":"BTC","timeframe":"1h"}'
```

**Status codes:**

| Status | Meaning |
|--------|---------|
| `200` | Analysis returned successfully |
| `400` | Invalid input — bad query, unsupported timeframe, symbol not found |
| `408` | Candle fetch timed out |
| `422` | Symbol found but insufficient candles |
| `500` | Unexpected internal error |

### POST /webhook/tradingview

Receives a TradingView alert payload, normalizes it, runs the analysis pipeline, and returns a structured JSON response.

**Auth:** shared secret — set `TRADINGVIEW_WEBHOOK_SECRET` in the server environment. The secret can be sent in either:
- `X-Webhook-Secret` request header *(preferred)*
- `"secret"` field in the JSON payload

Rate limiting for the webhook is independent from `/analyze`. See env vars below.

**Request body:**
```json
{
  "secret":    "your-webhook-secret",
  "query":     "BTCUSDT",
  "timeframe": "1h",
  "exchange":  "BINANCE",
  "symbol":    "BTCUSDT",
  "message":   "optional raw TradingView alert message"
}
```

**Query resolution priority:**
1. `query` field — used as-is
2. `exchange` + `symbol` — joined as `"EXCHANGE:SYMBOL"`
3. `symbol` — used as-is (uppercased)

**Example — simulate a TradingView alert with curl:**
```bash
curl -X POST http://localhost:3000/webhook/tradingview \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: your-webhook-secret" \
  -d '{
    "query":     "BTCUSDT",
    "timeframe": "1h",
    "exchange":  "BINANCE",
    "message":   "TradingView alert fired"
  }'
```

Or with the secret in the payload:
```bash
curl -X POST http://localhost:3000/webhook/tradingview \
  -H "Content-Type: application/json" \
  -d '{
    "secret":    "your-webhook-secret",
    "symbol":    "BTCUSDT",
    "exchange":  "BINANCE",
    "timeframe": "1h"
  }'
```

**Success response (200):**
```json
{
  "status":            "accepted",
  "correlationId":     "uuid-v4",
  "normalizedRequest": { "query": "BINANCE:BTCUSDT", "timeframe": "1h" },
  "warnings":          [],
  "analysis":          { ... },
  "delivery":          [
    { "provider": "telegram",  "attempted": true, "success": true, "statusCode": 200 },
    { "provider": "openclaw",  "attempted": true, "success": true, "statusCode": 200 }
  ]
}
```

`delivery` is always present — it is an empty array when delivery is disabled, and includes one entry per configured provider otherwise. A failed delivery entry does **not** change the `200` status code.

**Status codes:**

| Status | Meaning |
|--------|---------|
| `200` | Alert accepted and analysis returned |
| `401` | Missing webhook secret |
| `403` | Invalid webhook secret |
| `408` | Candle fetch timed out |
| `409` | Duplicate alert within de-duplication TTL |
| `422` | Insufficient candles for analysis |
| `429` | Webhook rate limit exceeded |
| `400` | Malformed payload or unsupported timeframe |
| `500` | Unexpected internal error |

**Webhook environment variables:**

| Env var | Default | Description |
|---------|---------|-------------|
| `TRADINGVIEW_WEBHOOK_SECRET` | *(none)* | Required. Shared secret for webhook auth. Generate: `openssl rand -hex 32` |
| `WEBHOOK_RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms (independent of `/analyze`) |
| `WEBHOOK_RATE_LIMIT_MAX_REQUESTS` | `10` | Max webhook requests per IP per window |
| `WEBHOOK_DEDUP_TTL_MS` | `10000` | In-memory de-duplication window (ms). Set to `0` to disable |

**Security notes:**
- The secret is **never logged** — only presence/absence is recorded
- The webhook path fails closed if `TRADINGVIEW_WEBHOOK_SECRET` is not configured
- Use HTTPS in production so the secret is not transmitted in plaintext
- De-duplication state is in-memory only — it resets on server restart

**Limitations (first version):**
- No persistent queue — processing is synchronous per request
- De-duplication does not survive restarts
- Rate limit state is in-memory only — use Redis-backed limiting for multi-instance deployments

**Webhook log events:**

| Event | Level | When |
|-------|-------|------|
| `webhook.received` | info | Webhook request received |
| `webhook.normalized` | info | Payload normalized successfully |
| `webhook.dedup_rejected` | info | Duplicate alert within TTL |
| `webhook.success` | info | Analysis completed and returned |
| `webhook.analysis_error` | error | Analysis pipeline threw |
| `webhook.invalid_payload` | warn | Payload failed validation |
| `webhook_auth.missing_secret` | warn | No secret provided in request |
| `webhook_auth.invalid_secret` | warn | Secret provided but does not match |
| `webhook_auth.no_secret_configured` | warn | `TRADINGVIEW_WEBHOOK_SECRET` not set at startup |
| `delivery.telegram.result` | info | Telegram delivery outcome |
| `delivery.openclaw.result` | info | OpenClaw delivery outcome |
| `delivery.telegram.error` | warn | Telegram HTTP/timeout error |
| `delivery.openclaw.error` | warn | OpenClaw HTTP/timeout error |
| `webhook.delivery_crash` | error | Unexpected error in delivery layer |

---

## Delivery layer

After a successful webhook analysis, the engine optionally delivers the result to one or more downstream providers. Delivery is a non-fatal side effect — if it fails, the `200` response is still returned.

### Providers

**Telegram** — sends a PT-BR formatted text message to a bot chat:
1. Create a bot via [@BotFather](https://t.me/botfather) and copy the token
2. Get your chat ID (send a message and check the Telegram API)
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

Message format reuses `analysis.summary` (already built in PT-BR by the pipeline), prepended with a `[TradingView Webhook]` source header and appended with the `correlationId`. Messages are truncated to 4096 chars with a `[mensagem truncada]` notice.

**OpenClaw** — POSTs a structured JSON payload to an HTTP endpoint:
```json
{
  "ok": true,
  "toolVersion": "webhook/v1",
  "data": { "symbol": "BTCUSDT", "signal": "breakout_watch", "confidence": 0.72, ... },
  "meta": {
    "source": "tradingview_webhook",
    "correlationId": "uuid-v4",
    "request": { "query": "BTCUSDT", "timeframe": "1h" },
    "warnings": [],
    "rawPayload": { "query": "BTCUSDT", "timeframe": "1h" }
  }
}
```

The `secret` field is always stripped from `rawPayload` before forwarding. Set `OPENCLAW_SEND_FULL_ANALYSIS=true` to include the complete analysis object in `data` instead of the compact subset.

### Delivery environment variables

| Env var | Default | Description |
|---------|---------|-------------|
| `DELIVERY_ENABLED` | `false` | Set to `true` to activate delivery |
| `DELIVERY_PROVIDER` | `telegram` | Comma-separated: `telegram`, `openclaw`, or `telegram,openclaw` |
| `DELIVERY_TIMEOUT_MS` | `5000` | Per-provider HTTP request timeout in ms |
| `TELEGRAM_BOT_TOKEN` | *(none)* | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | *(none)* | Target chat/channel ID (integer or `@channelusername`) |
| `OPENCLAW_DELIVERY_URL` | *(none)* | Full URL to POST the analysis payload to |
| `OPENCLAW_API_KEY` | *(none)* | Sent as `Authorization: Bearer <key>` if set |
| `OPENCLAW_SEND_FULL_ANALYSIS` | `false` | Include full analysis object in OpenClaw payload |

### Example `.env` — Telegram only

```env
DELIVERY_ENABLED=true
DELIVERY_PROVIDER=telegram
TELEGRAM_BOT_TOKEN=123456789:AABBccDDeeFFggHH
TELEGRAM_CHAT_ID=-1001234567890
```

### Example `.env` — both providers

```env
DELIVERY_ENABLED=true
DELIVERY_PROVIDER=telegram,openclaw
DELIVERY_TIMEOUT_MS=8000
TELEGRAM_BOT_TOKEN=123456789:AABBccDDeeFFggHH
TELEGRAM_CHAT_ID=-1001234567890
OPENCLAW_DELIVERY_URL=https://openclaw.internal/ingest
OPENCLAW_API_KEY=oc-secret
OPENCLAW_SEND_FULL_ANALYSIS=false
```

---

## Multi-timeframe analysis (`analyzeMarketMTF`)

```js
const { analyzeMarketMTF } = require('./src/tools/analyzeMarketMTF');

const result = await analyzeMarketMTF({
  query:      'BTC',
  timeframes: ['1h', '4h', '1d'],
  options:    {},               // forwarded to each analyzeMarket call
});

// result.results['1h']  — full analyzeMarket output for 1h
// result.results['4h']  — full analyzeMarket output for 4h
// result.errors['1d']   — { error, code } if that timeframe failed
// result.mtfSummary     — PT-BR formatted multi-TF block (null if <2 succeeded)
// result.warnings       — per-timeframe failure messages
```

Timeframes are fetched concurrently. Per-timeframe errors are captured in `errors` instead of aborting the whole call.

---

## Structured logging

The engine emits newline-delimited JSON logs to stdout (info/debug) and stderr (warn/error).

```json
{"ts":1712345678901,"level":"info","event":"analysis.start","query":"BTC","timeframe":"1h"}
{"ts":1712345678950,"level":"info","event":"analysis.complete","query":"BTC","timeframe":"1h","signal":"pullback_watch","confidence":0.54}
{"ts":1712345679100,"level":"warn","event":"overlay.fetch.failed","source":"coinglass","error":"missing api key"}
```

**Key log events:**

| Event | Level | When |
|-------|-------|------|
| `analysis.start` | info | `analyzeMarket` invoked |
| `analysis.complete` | info | Analysis returned successfully |
| `candle.fetch.failed` | error | WebSocket fetch threw |
| `overlay.fetch.failed` | warn | CoinGlass / Bybit / CoinGecko failure |
| `pattern.detection.failed` | warn | `detectChartPatterns` threw |
| `pattern.detector.failed` | debug | Single detector threw inside `safeDetect` |
| `analysis.mtf.start` | info | `analyzeMarketMTF` invoked |
| `analysis.mtf.complete` | info | MTF run finished |
| `analysis.mtf.timeframe.failed` | warn | Individual TF failed inside MTF run |
| `api.analyze.request` | info | POST /analyze received |
| `api.analyze.success` | info | POST /analyze returned 200 |
| `api.analyze.client_error` | warn | POST /analyze returned 4xx |
| `api.analyze.failure` | error | POST /analyze returned 500 |
| `api.started` | info | Server listening |

**Control verbosity:**
```bash
LOG_LEVEL=debug npm run start:api   # show all log levels
LOG_LEVEL=warn  npm run start:api   # only warnings and errors
```

**New auth/rate-limit log events:**

| Event | Level | When |
|-------|-------|------|
| `auth.disabled` | warn | `DISABLE_AUTH=true` at startup |
| `auth.no_key_configured` | warn | `API_KEY` unset at startup |
| `auth.missing_key` | warn | Request has no `x-api-key` header |
| `auth.invalid_key` | warn | Request has wrong `x-api-key` (value never logged) |
| `rate_limit.exceeded` | warn | IP exceeded request limit |
| `overlay.cache.hit` | debug | Overlay data served from cache |
| `overlay.cache.miss` | debug | Overlay data fetched fresh |
| `candle.cache.hit` | debug | Candles served from cache |
| `symbol.cache.hit` | debug | Symbol resolution served from cache |

**Security:** The logger never receives raw `options` objects. Callers are responsible for not passing SESSION, SIGNATURE, or API key values as log context.

---

## TTL caching

The engine supports optional in-memory TTL caching for expensive I/O operations. Enable it with `CACHE_ENABLED=true`.

| Env var | Default | What is cached |
|---------|---------|----------------|
| `CACHE_ENABLED` | `false` | Master toggle |
| `CACHE_TTL_OVERLAYS_MS` | `300000` | CoinGlass, Bybit, CoinGecko overlay data (5 min) |
| `CACHE_TTL_CANDLES_MS` | `60000` | TradingView OHLCV candles (1 min) |
| `CACHE_TTL_SYMBOL_MS` | `300000` | Symbol resolution results (5 min) |

```bash
CACHE_ENABLED=true \
CACHE_TTL_OVERLAYS_MS=600000 \
API_KEY=my-secret \
npm run start:api
```

**Behavior:**
- Cache is per-process and in-memory. It is reset on restart.
- Errors are **never** cached — a failed fetch always triggers a fresh attempt.
- Cache hits/misses are logged at `debug` level.
- Multi-instance deployments each maintain independent caches (no shared state).

---

## Backtesting

Replay the analysis pipeline over historical OHLCV fixture files to measure signal quality.

### Fixture format

A JSON file containing an array of OHLCV candles, oldest-first:

```json
[
  { "time": 1700000000, "open": 40000, "high": 40500, "low": 39800, "close": 40200, "volume": 1234.5 },
  ...
]
```

- `time` — Unix timestamp in **seconds**
- `open`, `high`, `low`, `close` — price floats
- `volume` — volume float

A synthetic 300-candle fixture is provided at `test/fixtures/candles-btc-1h.json` for testing.

### CLI

```bash
node scripts/backtest.js \
  --file     test/fixtures/candles-btc-1h.json \
  --symbol   BTCUSDT \
  --timeframe 1h

# Full options:
node scripts/backtest.js \
  --file      test/fixtures/candles-btc-1h.json \
  --symbol    BTCUSDT \
  --timeframe 1h \
  --lookahead 12        \  # forward bars for outcome evaluation (default: 10)
  --win-pct   2.0       \  # % move needed for a win (default: 1.5)
  --loss-pct  1.0       \  # % move against signal that counts as a loss (default: 0.75)
  --min-conf  0.45      \  # skip signals below this confidence (default: 0.4)
  --min-window 60       \  # minimum candles before first signal (default: 50)
  --out report.json        # write JSON to file instead of stdout
```

Or via npm:

```bash
npm run backtest -- --file test/fixtures/candles-btc-1h.json --symbol BTCUSDT --timeframe 1h
```

### Output

Each `bySignal`, `overall`, `confidenceBuckets`, and `byPattern` group has the same shape:

```json
{
  "count":         45,
  "wins":          25,
  "losses":        14,
  "expired":        6,
  "decided":       39,
  "winRate":       0.64,
  "avgConfidence": 0.54,
  "avgMfePct":     1.82,
  "avgMaePct":    -0.41
}
```

Full report:

```json
{
  "symbol": "BTCUSDT",
  "timeframe": "1h",
  "config": {
    "lookaheadBars": 10, "winPct": 1.5, "lossPct": 0.75,
    "minConfidence": 0.4, "entryMode": "next-open",
    "signals": ["breakout_watch","pullback_watch","bearish_breakdown_watch"],
    "buckets": ["0.00-0.49","0.50-0.59","0.60-0.69","0.70-0.79","0.80-1.00"]
  },
  "totalCandles": 300,
  "totalSteps": 241,
  "totalEligible": 119,
  "totalNoTrade": 114,
  "totalAnalysisSkipped": 0,
  "bySignal": {
    "breakout_watch":          { "count": 74, "wins": 28, "losses": 46, "decided": 74, "winRate": 0.38, "avgConfidence": 0.50, "avgMfePct": 1.21, "avgMaePct": -0.38 },
    "pullback_watch":          { "count": 3,  "wins": 1,  "losses": 2,  "decided": 3,  "winRate": 0.33, "avgConfidence": 0.55, "avgMfePct": 0.95, "avgMaePct": -0.60 },
    "bearish_breakdown_watch": { "count": 42, "wins": 16, "losses": 26, "decided": 42, "winRate": 0.38, "avgConfidence": 0.50, "avgMfePct": 1.08, "avgMaePct": -0.31 }
  },
  "overall": { "count": 119, "wins": 45, "losses": 74, "decided": 119, "winRate": 0.38, "avgConfidence": 0.50, "avgMfePct": 1.16, "avgMaePct": -0.36 },
  "confidenceBuckets": {
    "0.00-0.49": { "count": 61, "wins": 26, "losses": 35, "decided": 61, "winRate": 0.43, "avgConfidence": 0.47 },
    "0.50-0.59": { "count": 49, "wins": 17, "losses": 32, "decided": 49, "winRate": 0.35, "avgConfidence": 0.51 },
    "0.60-0.69": { "count": 8,  "wins": 2,  "losses": 6,  "decided": 8,  "winRate": 0.25, "avgConfidence": 0.64 },
    "0.70-0.79": { "count": 1,  "wins": 0,  "losses": 1,  "decided": 1,  "winRate": 0.00, "avgConfidence": 0.75 },
    "0.80-1.00": { "count": 0,  "wins": 0,  "losses": 0,  "decided": 0,  "winRate": null, "avgConfidence": null }
  },
  "byPattern": {
    "head_and_shoulders": { "count": 50, "wins": 17, "losses": 33, "winRate": 0.34, "avgConfidence": 0.51 },
    "double_bottom":      { "count": 23, "wins": 11, "losses": 12, "winRate": 0.48, "avgConfidence": 0.49 },
    "cup_and_handle":     { "count": 30, "wins": 10, "losses": 20, "winRate": 0.33, "avgConfidence": 0.49 },
    "rectangle":          { "count": 11, "wins": 5,  "losses": 6,  "winRate": 0.45, "avgConfidence": 0.49 },
    "no_pattern":         { "count": 5,  "wins": 2,  "losses": 3,  "winRate": 0.40, "avgConfidence": 0.50 }
  },
  "generatedAt": "2026-03-20T10:00:00.000Z"
}
```

Aggregated multi-fixture reports also include:
```json
{
  "byTimeframe": {
    "1h": { "count": 119, "wins": 45, "losses": 74, "winRate": 0.38 },
    "4h": { "count": 89,  "wins": 38, "losses": 51, "winRate": 0.43 }
  },
  "byFixture": [
    { "symbol": "BTCUSDT", "timeframe": "1h", "overall": { ... }, "bySignal": { ... } },
    { "symbol": "ETHUSDT", "timeframe": "4h", "overall": { ... }, "bySignal": { ... } }
  ]
}
```

**New report fields:**

| Field | Description |
|-------|-------------|
| `decided` | `wins + losses` (excludes expired) |
| `avgMfePct` | Average max favorable excursion (% from entry) |
| `avgMaePct` | Average max adverse excursion (% from entry), typically negative |
| `confidenceBuckets` | Signal stats split by confidence range |
| `byPattern` | Signal stats split by primary detected chart pattern |
| `byTimeframe` | Signal stats split by timeframe *(aggregate reports only)* |
| `byFixture` | Per-fixture summary *(aggregate reports only)* |
| `config.buckets` | Confidence bucket label list used for this report |

**Confidence buckets** — helps answer:
- "Do higher-confidence signals actually perform better?"
- "What confidence threshold should I use in production?"

Default buckets: `0.00–0.49`, `0.50–0.59`, `0.60–0.69`, `0.70–0.79`, `0.80–1.00` (configurable via `buildReport({ buckets })`)

**Pattern breakdown** — counting strategy:
- Each eligible signal is counted **once** under its primary pattern (highest-quality confirmed pattern, or first forming if none confirmed)
- Signals where pattern detection was skipped (`--skip-patterns`) or found nothing appear under `"no_pattern"`
- Enables answering: "Which patterns produce the best win rate in this dataset?"

**Evaluation assumptions (explicit):**
- Entry price = open of the first bar after the signal (`next-open` mode) or signal-bar close (`close` mode)
- **Bullish** signal wins if price reaches `+winPct%` before `−lossPct%` within `lookahead` bars
- **Bearish** signal wins if price reaches `−winPct%` before `+lossPct%` within `lookahead` bars
- `no_trade` signals are excluded from evaluation (`outcome = skipped`)
- `winRate` = wins / (wins + losses); expired signals are excluded from the denominator
- High/Low of each bar are used, not just close, so intrabar moves count
- This is **not** a portfolio simulator — do not mistake hit-rate statistics for a tradeable edge

---

## Primary API

### `analyzeMarket({ query, timeframe, options? })`

```js
const { analyzeMarket } = require('./src/tools/analyzeMarket');

const result = await analyzeMarket({
  query:     'BTC',      // or 'AAPL', 'BINANCE:BTCUSDT', 'ETH/USDT', etc.
  timeframe: '15m',      // see supported timeframes below
  options: {
    // all optional
    candleCount:  300,          // default: 300
    timeoutMs:    20000,        // WebSocket fetch timeout (ms), default: 20000
    symbolFilter: 'crypto',     // market filter for symbol search (optional)
    token:        '',           // TradingView session token (optional, for auth)
    signature:    '',           // TradingView session signature (optional)
  }
});
```

---

## Supported timeframes

| Label | Description |
|-------|-------------|
| `1m`  | 1 minute    |
| `3m`  | 3 minutes   |
| `5m`  | 5 minutes   |
| `15m` | 15 minutes  |
| `30m` | 30 minutes  |
| `1h`  | 1 hour      |
| `2h`  | 2 hours     |
| `4h`  | 4 hours     |
| `6h`  | 6 hours     |
| `12h` | 12 hours    |
| `1d`  | 1 day       |
| `1w`  | 1 week      |

---

## Output shape

```js
{
  // Identity
  symbol:         'BTCUSDT',
  symbolId:       'BINANCE:BTCUSDT',
  exchange:       'BINANCE',
  description:    'Bitcoin / Tether USD',
  timeframe:      '15m',

  // Price
  price:          67420.5,

  // Classification
  trend:          'bullish',          // strong_bullish | bullish | neutral_bullish | neutral_bearish | bearish | strong_bearish | unknown
  momentum:       'neutral_bullish',  // overextended_bullish | bullish | neutral_bullish | neutral_bearish | bearish | oversold_bearish | unknown
  volumeState:    'average',          // very_high | high | average | low | very_low | unknown
  volatilityState:'moderate',         // extreme | high | moderate | low | very_low | unknown
  signal:         'pullback_watch',   // breakout_watch | pullback_watch | bearish_breakdown_watch | no_trade

  // Confidence + risk
  confidence:     0.47,               // 0–1 (adjusted for data quality)
  invalidation:   'Close below EMA50 or prior swing low.',
  targets:        ['Test of recent highs or upper range.'],

  // Indicators
  indicators: {
    ema20:       67105.2,
    ema50:       65842.1,
    ema100:      63020.4,
    ema200:      58102.7,
    ma200:       57800.1,
    rsi14:       58.3,
    avgVolume20: 12400,
    atr14:       1240.5,
  },

  // Chart patterns (null array when ≤40 candles or options.skipPatterns=true)
  chartPatterns: [
    {
      type:              'head_and_shoulders',    // see pattern types below
      displayName:       'Ombro-Cabeça-Ombro',   // PT-BR label
      bias:              'bearish',               // bullish | bearish | neutral
      status:            'near_breakout',         // forming | near_breakout | confirmed
      confidence:        0.56,                   // 0–0.70 (capped; quality-derived)
      quality:           0.72,                   // raw quality score 0–1
      timeframe:         '1h',
      startIndex:        120,                    // candle index of pattern start
      endIndex:          199,                    // candle index of pattern end (current)
      keyLevels:         { ... },                // pattern-specific price levels
      breakoutLevel:     67400.0,
      invalidationLevel: 68200.0,
      explanation:       'Ombro-Cabeça-Ombro: ...',
      source:            'pattern_detector',
    }
  ],

  // Structure
  trendlineState: {
    activeTrendlineType: 'bearish',   // bearish | bullish | both | none
    bearishTrendline: { ... },
    bullishTrendline: null,
    lineBreakDetected:    false,
    lineBreakDirection:   'none',     // bullish_break | bearish_break | none
    pivotContext: { ... },
    explanation:  'Price is below bearish trendline (68500) — resistance overhead.',
  },

  zoneState: {
    zoneType:     'none',             // consolidation | accumulation | none
    zoneHigh:     null,
    zoneLow:      null,
    zoneStrength: null,
    breakoutRisk: 'low',
    explanation:  '...',
  },

  // Optional CoinGecko context (null when COINGECKO_API_KEY is absent or unavailable)
  marketBreadthContext: {
    regime:         'risk_on',  // risk_on | risk_off | mixed
    total:          50,
    gainers:        35,
    losers:         13,
    neutral:        2,
    gainersPercent: 70,
    vsCurrency:     'usd',
    source:         'coingecko',
  },
  trendingContext: {
    isTrending:    false,       // true if base coin is in CoinGecko trending list
    trendingRank:  null,        // 1-based rank when isTrending=true
    matchedSymbol: null,
    matchedName:   null,
    source:        'coingecko',
  },

  // Meta
  dataQuality:    'fair',            // good | fair | poor
  warnings:       ['EMA200 unavailable (likely insufficient history).'],
  candleCount:    287,
  summary:        'BTCUSDT @ 67420.5 (15m) Trend: Bullish. Momentum: Neutral Bullish...',
  timestamp:      '2026-03-16T10:00:00.000Z',
}
```

---

## Error types

All errors from the adapter layer are typed domain errors exported from `src/adapters/tradingview/errors.js`:

| Class | When |
|-------|------|
| `SymbolNotFoundError`       | Query returned no matching symbol |
| `AmbiguousSymbolError`      | Multiple equally-good matches (rare) |
| `UnsupportedTimeframeError` | Timeframe not in supported list |
| `MarketDataUnavailableError`| TradingView session or symbol error |
| `CandleFetchTimeoutError`   | WebSocket timeout |
| `InsufficientCandlesError`  | Too few candles for reliable analysis |
| `SessionError`              | Low-level WebSocket client failure |

---

## Computed indicators and features

| Feature | Method |
|---------|--------|
| EMA 20/50/100/200 | Standard EMA (seed = SMA, k = 2/(n+1)) |
| MA 200 | Simple rolling average |
| RSI 14 | Wilder's smoothing |
| ATR 14 | Wilder's smoothing, True Range |
| Avg Volume (20) | Rolling simple average |
| Pivot highs/lows | N-bar lookback on each side |
| Bearish trendline | Descending pivot-high pairs, slope + projection |
| Bullish trendline | Ascending pivot-low pairs, slope + projection |
| Line-break detection | Price close crossing projected trendline level |
| Consolidation zone | ATR-relative range compression over lookback window |
| Accumulation zone | Consolidation + prior decline + low defense heuristics |

All computations are local to this repository and do not depend on TradingView indicators or external proprietary code.

---

## Chart pattern detection

`detectChartPatterns(candles, options)` in `src/analyzer/patterns/` runs a conservative heuristic pipeline over the candle series. It is called automatically by `analyzeMarket()` and returned as `chartPatterns`.

### Detected patterns

| Type constant | Display name (PT-BR) | Bias |
|---|---|---|
| `head_and_shoulders` | Ombro-Cabeça-Ombro | bearish |
| `inverse_head_and_shoulders` | OCO Invertido | bullish |
| `double_top` | Topo Duplo | bearish |
| `double_bottom` | Fundo Duplo | bullish |
| `ascending_triangle` | Triângulo Ascendente | bullish |
| `descending_triangle` | Triângulo Descendente | bearish |
| `symmetrical_triangle` | Triângulo Simétrico | neutral |
| `bull_flag` | Bandeira de Alta | bullish |
| `bear_flag` | Bandeira de Baixa | bearish |
| `bull_pennant` | Flâmula de Alta | bullish |
| `bear_pennant` | Flâmula de Baixa | bearish |
| `rising_wedge` | Cunha Ascendente | bearish |
| `falling_wedge` | Cunha Descendente | bullish |
| `cup_and_handle` | Xícara e Alça | bullish |
| `rectangle` | Retângulo / Range | neutral |

### Design constraints

- **No lookahead**: only current bar and history are used
- **ATR-relative tolerances**: all thresholds scale with volatility, not fixed prices
- **Conservative**: patterns with `quality < 0.28` are rejected; under-detection preferred
- **Non-blocking**: a detector exception never kills the pipeline (`safeDetect` wrapper)
- **Deterministic**: same candles always produce the same output
- Requires at least 40 candles; returns `[]` otherwise

### Options

| Option | Default | Description |
|---|---|---|
| `atr` | estimated from last 14 bars | ATR value for tolerance scaling |
| `avgVolume` | `0` | 20-bar average volume (used for `volumeBonus`) |
| `timeframe` | `null` | Timeframe label attached to output |
| `lookback` | `5` | Pivot lookback window (bars on each side) |
| `maxPatterns` | `5` | Maximum patterns returned (sorted by quality desc) |

Pass `options.skipPatterns = true` to `analyzeMarket()` to bypass pattern detection entirely.

---

## Signal priority order

Signal classification in `src/analyzer/rules.js` uses a sequential if/else waterfall. This is a deliberate MVP v1 design choice for simplicity and auditability. The first matching condition wins:

| Priority | Signal | Condition |
|----------|--------|-----------|
| 1 | `breakout_watch` | Bullish trendline break + bullish trend alignment |
| 2 | `breakout_watch` | Accumulation zone + bullish structure emerging |
| 3 | `pullback_watch` | Bullish trend + bullish momentum, not overextended |
| 4 | `pullback_watch` | Bearish trendline intact above price, bullish trend context |
| 5 | `bearish_breakdown_watch` | Bearish trendline break + bearish trend alignment |
| 6 | `bearish_breakdown_watch` | Bearish trend + bearish momentum |
| 7 | `no_trade` (confident, 0.60) | Consolidation zone detected |
| 8 | `no_trade` (default, 0.50) | No condition matched — ambiguous or mixed market |

To change which signal fires in a given market condition, re-order these branches. Do not replace this waterfall with a multi-factor scoring system until the MVP is stable and the priority order has been validated against real outputs.

**`no_trade` confidence:** A value of `0.50` means the system is moderately confident there is no actionable setup — not that the system failed. A value of `0.60` means the system detected a consolidation zone and is more confident that no directional trade is appropriate until the zone breaks.

---

## Future integration hooks

The codebase is structured so the following can be added without refactoring core logic:

- **Telegram bot** (`src/bot/`) — command-based interface (`/analyze SYMBOL TIMEFRAME`)
- **Watchlist scanning** — iterate a symbol list, filter by signal
- **Alerting** — compare consecutive `analyzeMarket` calls for signal transitions
- **TradingView authentication** — pass `token` + `signature` from `loginUser` into options
- **Bybit context wiring** — bridge `bybitContext.js` confidence adjustments into the pipeline (analogous to `perpContext.js`)
- **Redis-backed rate limiting** — for multi-instance deployments
- **Persistent job queue** — for high-volume webhook scenarios
- **Custom indicator integration** — `getIndicator` + `ChartSession.Study` (future adapter module)

---

## Troubleshooting

**Webhook returns 401**
`TRADINGVIEW_WEBHOOK_SECRET` is not set. The webhook fails closed — set a secret first.

**Webhook returns 403**
Secret is set but the provided value is wrong. Check `X-Webhook-Secret` header or `"secret"` body field.

**Webhook returns 409**
Duplicate alert within the dedup TTL window (default 10 s). This is by design — TradingView can fire the same alert multiple times. Wait for the TTL to expire or set `WEBHOOK_DEDUP_TTL_MS=0` to disable dedup.

**Webhook returns 429**
Rate limit exceeded for the webhook endpoint. Default: 10 requests per 60 s per IP. Adjust via `WEBHOOK_RATE_LIMIT_MAX_REQUESTS`.

**Delivery enabled but nothing is sent**
- Check `DELIVERY_ENABLED=true` and `DELIVERY_PROVIDER` is set correctly
- For Telegram: verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are both set
- For OpenClaw: verify `OPENCLAW_DELIVERY_URL` is reachable from the server
- Check logs for `delivery.telegram.error` or `delivery.openclaw.http_error` events

**Telegram delivery returns HTTP 400**
Usually means `TELEGRAM_CHAT_ID` is wrong (wrong format or bot not added to the chat).

**Analysis returns 408**
TradingView WebSocket timed out fetching candles. Default timeout: 20 s. Increase with `options.timeoutMs` or check network connectivity.

**Backtest fixture validation error**
Candles must be sorted oldest-first with monotonically increasing `time` values. Verify `time` is in Unix seconds, not milliseconds.

**Results look stale when cache is enabled**
TTL cache is per-process and in-memory. To force fresh data: restart the server or reduce `CACHE_TTL_CANDLES_MS`.

**`no_trade` signals in every step during backtest**
The minimum candle window before the first signal is 50 bars by default. For short fixtures, most early bars will emit `no_trade` until enough history is accumulated.

---

## CoinGlass adapter

An additive context layer that enriches analysis with perpetual futures and macro crypto data. It does **not** replace or modify the TradingView analysis engine — it is an independent module.

### Setup

```bash
export COINGLASS_API_KEY=your_key_here
```

The adapter reads `COINGLASS_API_KEY` from the environment. All five context functions throw `MissingApiKeyError` synchronously if the key is absent.

### Available functions

```js
const {
  getFundingContext,
  getOpenInterestContext,
  getLongShortContext,
  getLiquidationContext,
  getMacroContext,
} = require('./src/adapters/coinglass');
```

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `getFundingContext(symbol, options?)` | `/api/futures/funding-rate/history` | Crowded long/short positioning via funding rates |
| `getOpenInterestContext(symbol, options?)` | `/api/futures/open-interest/aggregated-history` | OI expansion/contraction across all exchanges |
| `getLongShortContext(symbol, options?)` | `/api/futures/global-long-short-account-ratio/history` | Account-level crowd bias |
| `getLiquidationContext(symbol, options?)` | `/api/futures/liquidation/history` | Recent squeeze / flush context |
| `getMacroContext(options?)` | Fear & Greed, BTC Dominance, Altcoin Season | Macro crypto regime |

### Symbol formats

All functions accept raw symbol strings in any of these formats:

```
'BINANCE:MMTUSDT.P'  →  base coin: MMT,  pair: MMTUSDT
'BTCUSDT.P'          →  base coin: BTC,  pair: BTCUSDT
'BTCUSDT'            →  base coin: BTC,  pair: BTCUSDT
'BTC'                →  base coin: BTC  (OI endpoint only)
```

### Options

All functions accept an options object. Key shared options:

| Option | Default | Description |
|--------|---------|-------------|
| `exchange` | `'Binance'` | Exchange name (funding/longShort/liquidation) |
| `interval` | `'1h'` / `'4h'` | Aggregation interval |
| `limit` | `24` / `42` | Number of records |
| `timeoutMs` | `10000` | Request timeout (ms) |

### Error types

All errors extend `CoinGlassError` and carry a `.code` string:

| Code | Class | When |
|------|-------|------|
| `missing_api_key` | `MissingApiKeyError` | `COINGLASS_API_KEY` not set |
| `unauthorized` | `UnauthorizedError` | Invalid key (HTTP 401/403) |
| `rate_limited` | `RateLimitedError` | Too many requests (HTTP 429) |
| `upstream_unavailable` | `UpstreamUnavailableError` | CoinGlass server error / network failure |
| `invalid_symbol` | `InvalidSymbolError` | Symbol string is empty or unparseable |
| `invalid_response` | `InvalidResponseError` | Unexpected JSON shape or non-zero API code |
| `timeout` | `CoinGlassTimeoutError` | Request exceeded `timeoutMs` |
| `unsupported_feature` | `UnsupportedFeatureError` | Feature not yet implemented |
| `internal_error` | `CoinGlassInternalError` | Unexpected adapter-level failure |

### Current status

CoinGlass data is fetched and surfaced in `analyzeMarket()` output via `perpContext`. A small confidence adjustment is applied via `src/analyzer/perpContext.js` — funding regime, OI trend, and macro Fear & Greed can shift confidence for relevant signals. When `COINGLASS_API_KEY` is not set or the API call fails, the overlay degrades gracefully and confidence is unaffected.

---

## CoinGecko adapter

An optional discovery and market-breadth layer. Does **not** replace or modify the TradingView analysis engine — it is an independent module.

### Setup

```bash
export COINGECKO_API_KEY=your_key_here        # demo or paid key (optional, but recommended)
export COINGECKO_API_TIER=demo                # 'demo' (default) or 'paid'
```

No key is required for basic usage (public tier), but the rate limit is aggressive (~10–30 req/min). A demo key raises the limit and improves reliability.

### Available functions

```js
const {
  getTrending,
  getTopCoins,
  getPrice,
  getMarketChart,
} = require('./src/adapters/coingecko');
```

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `getTrending(options?)` | `GET /search/trending` | Top trending coins + categories (updated ~every 10 min) |
| `getTopCoins(options?)` | `GET /coins/markets` | Top N coins by market cap + breadth metrics |
| `getPrice(ids, options?)` | `GET /simple/price` | Current price by CoinGecko ID (e.g. `'bitcoin'`) |
| `getMarketChart(id, options?)` | `GET /coins/{id}/market_chart` | Historical price/volume series for a coin |

### Options

| Option | Default | Applies to |
|--------|---------|------------|
| `vsCurrency` | `'usd'` | getTopCoins, getPrice, getMarketChart |
| `perPage` | `50` | getTopCoins (max 250) |
| `days` | `30` | getMarketChart |
| `timeoutMs` | `10000` | all functions |

### Normalized output shapes

**`getTrending()`**
```js
{
  topTrending: [{ id, symbol, name, marketCapRank, priceChangePercent24h, score, thumb }],
  trendingIds: ['solana', 'pepe', ...],
  trendingSymbols: ['SOL', 'PEPE', ...],
  categories: [{ id, name, marketCap1hChange }],
  warnings: [],
  source: 'coingecko',
}
```

**`getTopCoins()`**
```js
{
  leaders: [{ id, symbol, name, rank, price, marketCap, priceChangePercent24h, volume24h, ... }],
  marketBreadth: { total, gainers, losers, neutral, gainersPercent, regime },
  vsCurrency: 'usd',
  warnings: [],
  source: 'coingecko',
}
// regime: 'risk_on' (>=60% green) | 'risk_off' (<=40% green) | 'mixed'
```

**`getMarketChart(id)`**
```js
{
  id: 'bitcoin', vsCurrency: 'usd', days: 30,
  prices:     [{ time: <ms>, value: <price> }],
  marketCaps: [{ time: <ms>, value: <cap> }],
  volumes:    [{ time: <ms>, value: <vol> }],
  source: 'coingecko',
}
```

### Error types

All errors extend `CoinGeckoError` with a `.code` string:

| Code | Class | When |
|------|-------|------|
| `missing_api_key` | `MissingApiKeyError` | Key explicitly required but absent |
| `unauthorized` | `UnauthorizedError` | Invalid key (HTTP 401/403) |
| `rate_limited` | `RateLimitedError` | Too many requests (HTTP 429) |
| `plan_restricted` | `PlanRestrictedError` | Endpoint requires plan upgrade |
| `upstream_unavailable` | `UpstreamUnavailableError` | Server error / network failure |
| `symbol_not_found` | `SymbolNotFoundError` | No coin found for query |
| `invalid_response` | `InvalidResponseError` | Unexpected JSON shape |
| `timeout` | `CoinGeckoTimeoutError` | Request exceeded `timeoutMs` |

### Current status and integration

CoinGecko enriches `analyzeMarket()` output with two optional fields and a small confidence overlay:

- **`marketBreadthContext`** — broad market breadth summary (regime, gainers/losers ratio) from the top 50 coins by market cap
- **`trendingContext`** — whether the analyzed asset appears in CoinGecko's current trending list (matched by base coin symbol, e.g. `BINANCE:MMTUSDT.P → MMT`)

Both fields are `null` when `COINGECKO_API_KEY` is not set or when CoinGecko is unavailable. The core signal engine and TradingView data are never affected by CoinGecko availability.

#### Confidence overlay

A small confidence adjustment is applied to **altcoin** `pullback_watch` and `breakout_watch` signals only. BTC and ETH are excluded.

| Condition | Signal | Δ confidence |
|---|---|---|
| `risk_on` breadth | breakout or pullback | +0.03 |
| `risk_off` breadth | `breakout_watch` | −0.05 |
| `risk_off` breadth | `pullback_watch` | −0.03 |
| `mixed` breadth | any | 0 |
| Trending (rank ≤ 3) | `breakout_watch` | +0.05 |
| Trending (rank ≤ 3) | `pullback_watch` | +0.03 |
| Trending (rank > 3) | `breakout_watch` | +0.03 |
| Trending (rank > 3) | `pullback_watch` | +0.02 |

Total CoinGecko delta is capped at `[−0.05, +0.08]`. The adjustment is visible in `confidenceBreakdown.cgkoAdjustment` and explained in `confidenceBreakdown.cgkoReasons`.

The bridge lives in `src/analyzer/marketContext.js`. Adjustment logic is in `computeMarketContextAdjustment()` (pure function, unit-tested).

Planned future wiring:
- Trending rank as a discovery signal for watchlist scans
- Agent responses: "what is trending right now?"

---

## Bybit adapter

An official read-only public market-data layer using the **Bybit V5 REST API**. TradingView remains the primary source of technical structure and signal logic. The Bybit adapter is additive — it is optional, and its absence does not affect the core analysis engine.

### Purpose

- Provides **official** perpetual/futures context directly from Bybit
- Complements CoinGlass (which can be plan-restricted) as a funding/OI source
- Designed for later wiring into the signal confidence pipeline

### Available functions

```js
const {
  getInstrumentInfo,
  getTickerContext,
  getFundingContext,
  getOpenInterestContext,
  getLongShortContext,
} = require('./src/adapters/bybit');
```

| Function | Endpoint | Returns |
|---|---|---|
| `getInstrumentInfo(symbol, opts?)` | `/v5/market/instruments-info` | Contract metadata: category, status, tickSize, qtyStep, contractType |
| `getTickerContext(symbol, opts?)` | `/v5/market/tickers` | Snapshot: lastPrice, markPrice, indexPrice, fundingRate, openInterest, basis, volume24h |
| `getFundingContext(symbol, opts?)` | `/v5/market/funding/history` | currentFunding, averageFunding, fundingBias, fundingRegime |
| `getOpenInterestContext(symbol, opts?)` | `/v5/market/open-interest` | currentOI, oiTrend, oiExpansion, oiRegime |
| `getLongShortContext(symbol, opts?)` | `/v5/market/account-ratio` | longShortRatio (buyRatio), crowdBias, crowdingRisk |

All functions accept symbols in any project format: `BTCUSDT`, `BTCUSDT.P`, `BINANCE:BTCUSDT.P`.

### Environment variables

```bash
BYBIT_ENV=mainnet          # mainnet (default) | testnet
BYBIT_BASE_URL=            # optional base URL override
BYBIT_TIMEOUT_MS=10000     # optional request timeout
```

No API key required — all functions use public Bybit V5 endpoints.

### Error classes

| Class | Code | Cause |
|---|---|---|
| `MissingSymbolError` | `missing_symbol` | Symbol argument absent |
| `InvalidSymbolError` | `invalid_symbol` | Symbol not found on Bybit |
| `GeoRestrictedError` | `geo_restricted` | HTTP 403 — geo block |
| `RateLimitedError` | `rate_limited` | HTTP 429 |
| `UpstreamUnavailableError` | `upstream_unavailable` | HTTP 5xx |
| `BybitTimeoutError` | `timeout` | Request timed out |
| `InvalidResponseError` | `invalid_response` | Malformed V5 envelope |
| `BybitApiError` | `api_error` | V5 retCode ≠ 0 |

### Future work

- **Signal engine wiring** — bridge funding/OI/LS into `src/analyzer/bybitContext.js` (analogous to `perpContext.js`) and wire confidence adjustments
- **WebSocket** — `src/adapters/bybit/ws.js` for live ticker/orderbook streaming (`wss://stream.bybit.com/v5/public/linear`)
- **Authenticated endpoints** — add `privateClient.js` with HMAC-SHA256 signing for orders, positions, and account management (future trading execution phase)

---

## Requirements

- Node.js >= 16
- `npm install` from the `tradingview-agent/` directory (installs `@mathieuc/tradingview` and `express`)
- All external API keys are optional — the engine degrades gracefully without them
  - `COINGLASS_API_KEY` — for CoinGlass perp/macro overlay
  - `COINGECKO_API_KEY` — for CoinGecko market breadth overlay
  - `BYBIT_ENV` — Bybit V5 uses public endpoints (no key required)
