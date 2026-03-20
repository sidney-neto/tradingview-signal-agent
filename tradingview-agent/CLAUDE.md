# CLAUDE.md — tradingview-agent

Guidance for Claude Code sessions working in this repository.

---

## What this project is

A deterministic market analysis engine and backend service. It fetches OHLCV candles from TradingView via WebSocket, runs a local technical analysis pipeline, and returns structured signal objects. It is designed for use by AI agents (OpenClaw) and Telegram delivery.

This is **not** an MVP scaffold — it is a functional production-quality backend.

---

## What is already implemented

### Analysis pipeline
- `src/tools/analyzeMarket.js` — single-timeframe analysis entry point
- `src/tools/analyzeMarketMTF.js` — multi-timeframe wrapper (concurrent, per-TF error isolation)
- `src/analyzer/pipeline.js` — shared analysis pipeline (indicators → features → classification → patterns → scoring → summary)
- Indicators: EMA20/50/100/200, MA200, RSI14, ATR14, AvgVolume20
- Signal types: `breakout_watch`, `pullback_watch`, `bearish_breakdown_watch`, `no_trade`
- Chart patterns: 15 detected patterns (head_and_shoulders, double_top/bottom, triangles, flags, wedges, cup_and_handle, rectangle)
- Optional overlays: CoinGlass (perp context), CoinGecko (market breadth), Bybit (funding/OI/LS) — all gracefully degraded if keys absent

### REST API (`src/api/`)
- `GET /health` — public liveness probe
- `POST /analyze` — full single-timeframe analysis (auth: `x-api-key` header)
- `POST /webhook/tradingview` — TradingView alert ingestion (auth: shared secret)
- Auth, rate limiting (per-endpoint, independent), deduplication of repeated webhook alerts
- Start: `npm run start:api`

### Delivery layer (`src/delivery/`)
- `dispatcher.js` — fans out to one or both providers; failures are isolated; never breaks the webhook 200 response
- `providers/telegram.js` — sends PT-BR formatted analysis to a Telegram chat via Bot API
- `providers/openclaw.js` — POSTs structured JSON to an OpenClaw HTTP endpoint
- `formatter.js` — `formatTelegramMessage()` (4096-char cap), `formatOpenClawPayload()` (compact/full modes, secret-stripped)
- Wired into `POST /webhook/tradingview` — result included in `delivery[]` response field
- Enabled via `DELIVERY_ENABLED=true`

### Backtesting (`src/backtest/`)
- `analyzeCandles.js` — runs analysis pipeline on pre-loaded candles (no network)
- `runner.js` — rolling-window replay over a candle array, strict temporal ordering (no lookahead)
- `report.js` — builds `bySignal`, `byPattern`, `byTimeframe`, `byFixture`, `confidenceBuckets` stats
- `evaluate.js` — win/loss/expired determination using High/Low per bar; MFE and MAE tracking
- CLI: `npm run backtest -- --fixture path/to/fixture.json [options]`

### Infrastructure
- `src/cache/` — TTL-based in-memory caches for symbol resolution, candles, and overlay fetches
- `src/logger.js` — newline-delimited JSON logging (stdout for info/debug, stderr for warn/error)
- `src/adapters/tradingview/` — thin adapter over `@mathieuc/tradingview` npm package
- `src/adapters/coinglass/`, `src/adapters/bybit/`, `src/adapters/coingecko/` — optional read-only context adapters

### Tests
- `test/smoke.js` — 78 test groups, all deterministic, no network required
- Run: `npm test`

---

## Architecture boundaries — do not cross

| Boundary | Rule |
|----------|------|
| Analysis logic | Lives in `src/analyzer/` only — never in API routes, bot layer, or adapters |
| Telegram formatting | Lives in `src/delivery/formatter.js` — not in the analyzer or adapter layers |
| TradingView internals | Isolated in `src/adapters/tradingview/` — do not import from `@mathieuc/tradingview` anywhere else |
| Signal rules | Live in `src/analyzer/rules.js` — one waterfall, first match wins |
| Delivery failures | Must never propagate to callers — catch inside `deliverAnalysis()` |
| Backtest lookahead | `runBacktest` must only use candles[0..i] at each step — never future bars |

---

## Key invariants to preserve

- **No invented values** — return `null` or degrade gracefully when data is missing
- **Deterministic** — same candles always produce the same output; no randomness or AI interpretation
- **Typed domain errors** — `SymbolNotFoundError`, `CandleFetchTimeoutError`, etc. — used in `openclawAnalyzeMarket.js` for structured error mapping
- **Confidence accumulation** — base → data quality → CoinGlass delta → CoinGecko delta → capped `[0.10, 0.95]`
- **Webhook dedup** — SHA-256 key on `(query|timeframe)`, in-memory TTL store; resets on restart — by design
- **Backtest bucket sums** — sum of all bucket counts must equal `totalEligible`; each step counted once

---

## How the webhook flow works

```
POST /webhook/tradingview
  → webhookRateLimit (independent from /analyze limiter)
  → requireWebhookSecret (header or body field, fails closed if env not set)
  → normalizePayload (query resolution: query > exchange+symbol > symbol)
  → dedup check (SHA-256 key, 10s TTL by default)
  → analyzeMarket({ query, timeframe })
  → deliverAnalysis({ source, request, analysis, rawPayload, warnings, correlationId })
      → telegram.send() + openclaw.send() concurrently (if DELIVERY_ENABLED=true)
  → 200 { status, correlationId, normalizedRequest, warnings, analysis, delivery[] }
```

---

## How backtesting works

```
npm run backtest -- --fixture BTCUSDT_1h.json --lookahead 10 --win 1.5 --loss 0.75

  → validateFixture (schema + ordering checks)
  → runBacktest (rolling window: for each candle i, analyze candles[0..i], evaluate candles[i+1..i+lookahead])
  → evaluateOutcome (win if ±% target hit first within lookahead; expired if neither)
  → buildReport (bySignal, confidenceBuckets, byPattern)
  → formatTable or JSON output
```

---

## Where to make changes safely

| Task | Where |
|------|-------|
| Add a new signal type | `src/analyzer/rules.js` (add branch) + tests |
| Add a new indicator | `src/analyzer/` + wire into `pipeline.js` |
| Add a new chart pattern | `src/analyzer/patterns/` (new file + register in `index.js`) |
| Add a new delivery provider | `src/delivery/providers/` (new file) + wire in `dispatcher.js` |
| Add a new API endpoint | `src/api/routes/` (new file) + register in `server.js` |
| Change confidence scoring | `src/analyzer/scoring.js` — mind the cap and `confidenceBreakdown` fields |
| Add a new overlay adapter | `src/adapters/` + wire in `analyzeMarket.js` |

---

## Current next-step priorities (as of 2026-03-20)

1. Telegram bot layer (`src/bot/`) — command-based interface (`/analyze SYMBOL TIMEFRAME`)
2. Persistent job queue — for high-volume webhook scenarios
3. Redis-backed rate limiting — for multi-instance deployments
4. More backtest fixture data — for meaningful pattern/signal comparison
5. Bybit context wiring — bridge `bybitContext.js` into confidence scoring (analogous to `perpContext.js`)
