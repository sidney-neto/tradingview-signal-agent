# src/ — Source directory

## Separation of concerns

| Directory | Responsibility |
|-----------|---------------|
| `adapters/tradingview/` | Thin wrapper over `@mathieuc/tradingview` — symbol resolution, candle fetching, normalization |
| `adapters/coinglass/` | Optional CoinGlass perp/macro context (read-only, gracefully degraded) |
| `adapters/bybit/` | Optional Bybit V5 public market data (read-only, no API key required) |
| `adapters/coingecko/` | Optional CoinGecko market breadth context (read-only, gracefully degraded) |
| `analyzer/` | All business logic — indicators, rules, scoring, summary, chart patterns |
| `api/` | Express routes + middleware (auth, rate limiting, webhook) |
| `backtest/` | Rolling-window replay framework — analysis pipeline over historical fixtures |
| `cache/` | TTL-based in-memory caches for symbol, candle, and overlay fetches |
| `delivery/` | Telegram and OpenClaw output providers — wired into the webhook handler |
| `tools/` | Top-level entry points: `analyzeMarket`, `analyzeMarketMTF`, `openclawAnalyzeMarket` |
| `config/` | Tunable constants and defaults |
| `utils/` | Timeframe mapping, input validation |
| `logger.js` | Newline-delimited JSON logger (stdout/stderr) |
| `bot/` | Telegram bot commands — **not yet implemented** |

## Rules

- Business logic stays in `analyzer/` — not in routes, bot, or adapters
- Telegram-specific formatting stays in `delivery/formatter.js` — not in the analyzer
- TradingView internals isolated in `adapters/tradingview/` — do not import `@mathieuc/tradingview` directly elsewhere
- Delivery failures must never propagate to callers
- No invented values — return `null` or degrade gracefully
- Predictable JSON outputs with explicit field types

## Preferred style

- Small, focused files
- Clear function names
- Explicit validation at system boundaries (user input, external APIs)
- Typed domain errors with `.code` strings
