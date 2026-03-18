# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A deterministic market analysis engine built as an application layer over the TradingView WebSocket API. It produces structured, auditable trading signal analysis with confidence scoring for use by conversational AI agents (OpenClaw) and Telegram bots.

The workspace is a monorepo. The active package is `tradingview-agent/`.

## Commands

```bash
# From tradingview-agent/
npm install      # Install dependencies
npm test         # Run 27 smoke tests (no network or API keys required)
node test/smoke.js  # Same as npm test
```

Tests use Node.js built-in `assert`. No test framework required. All tests are deterministic and run against synthetic data.

## Architecture

The primary entry point is `src/tools/analyzeMarket.js`. It orchestrates the full analysis pipeline:

1. **Input validation** — `src/utils/validation.js`
2. **Symbol resolution** — `src/adapters/tradingview/symbolSearch.js`
3. **Candle fetching** — `src/adapters/tradingview/candles.js` (WebSocket, with timeout)
4. **Indicator computation** — `src/analyzer/` (EMA/SMA, RSI14, ATR14, volume)
5. **Feature detection** — pivots, trendlines, consolidation/accumulation zones
6. **Classification** — `src/analyzer/rules.js` (trend, momentum, signal, confidence)
7. **Optional overlays** (gracefully degraded if API keys absent):
   - CoinGlass perp context — `src/analyzer/perpContext.js`
   - CoinGecko market breadth — `src/analyzer/marketContext.js`
8. **Summary generation** — `src/analyzer/summary.js` (PT-BR formatted for Telegram)

`src/tools/openclawAnalyzeMarket.js` wraps `analyzeMarket` with a normalized input/output contract for AI agent integration, mapping domain errors to structured error objects.

### Layer separation rules

- Business logic lives in `src/analyzer/`
- TradingView WebSocket integration is isolated in `src/adapters/tradingview/`
- CoinGlass and CoinGecko integrations are isolated in `src/adapters/coinglass/` and `src/adapters/coingecko/`
- Configuration constants are centralized in `src/config/defaults.js`
- Do not mix Telegram formatting into the adapter layer
- Do not put signal rules inside the bot layer

### Confidence scoring

Confidence is accumulated in stages: base confidence → data quality adjustment (`src/analyzer/scoring.js`) → CoinGlass delta → CoinGecko delta. The full breakdown is returned in `confidenceBreakdown`.

### Signal types

- `breakout_watch`
- `pullback_watch`
- `bearish_breakdown_watch`
- `no_trade`

### Supported timeframes

`1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `12h`, `1d`, `1w`

## Environment Variables

Copy `.env.example` to `.env`. All variables are optional — the engine degrades gracefully without them:

- `COINGLASS_API_KEY` — enables perp/macro overlays
- `COINGECKO_API_KEY` — enables market breadth/trending overlays
- `COINGECKO_API_TIER` — `demo` (default) or `paid`
- `SESSION`, `SIGNATURE` — TradingView session cookies

## Key Design Principles

- **Deterministic over AI-style interpretation** — rules must be explicit and auditable
- **Do not invent values when data is missing** — return `null` or degrade gracefully
- **Keep calculations and classifications separate** — indicators in their own files, rules in `rules.js`
- **Typed domain errors** — each adapter defines its own error classes (e.g., `SymbolNotFoundError`, `CandleFetchTimeoutError`) enabling precise handling in the OpenClaw wrapper
- **Thin adapter pattern** — adapters isolate library internals from business logic; do not couple app code to `@mathieuc/tradingview` internals
- **Minimal dependencies** — only `@mathieuc/tradingview` as a production dependency

## Planned but Not Yet Implemented

- `src/api/` — REST endpoints (`/health`, `/analyze`)
- `src/bot/` — Telegram bot commands
