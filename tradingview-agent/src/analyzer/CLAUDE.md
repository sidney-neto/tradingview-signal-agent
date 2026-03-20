# src/analyzer/ — Analysis logic

## Responsibility

All market analysis business logic lives here. No network I/O. No formatting for external services.

## What this layer does

- Compute indicators (EMA, RSI, ATR, volume)
- Detect pivot highs/lows, trendlines, consolidation/accumulation zones
- Detect chart patterns (`patterns/`)
- Classify trend, momentum, volume state, volatility state
- Apply signal classification rules
- Compute confidence scores (base → data quality → overlay adjustments)
- Generate human-readable PT-BR summaries

## Rules

- Do not invent values when data is missing — return `null` or `unknown`
- Keep calculations and classifications separate (indicators in their own files, rules in `rules.js`)
- Prefer transparent, auditable rules over weighted scoring systems
- A detector exception in `patterns/` must never kill the pipeline (`safeDetect` wrapper)
- Confidence range: always clamped to `[0.10, 0.95]` after all adjustments

## Key files

| File | Purpose |
|------|---------|
| `pipeline.js` | `computeAnalysisPipeline(candles, opts)` — shared by `analyzeMarket` and backtest |
| `rules.js` | `classifyTrend`, `classifyMomentum`, `classifySignal`, `computePullbackContext` |
| `scoring.js` | `computeDataQuality`, `adjustConfidenceForDataQuality` |
| `summary.js` | `buildSummary()` — PT-BR text block for Telegram |
| `perpContext.js` | CoinGlass overlay wiring — confidence delta |
| `bybitContext.js` | Bybit overlay helpers (`computeBybitContextAdjustment`) |
| `marketContext.js` | CoinGecko overlay wiring — confidence delta for altcoins |
| `patterns/index.js` | `detectChartPatterns(candles, options)` — entry point |

## Signal labels

- `breakout_watch`
- `pullback_watch`
- `bearish_breakdown_watch`
- `no_trade`

Signal priority is a sequential waterfall in `rules.js`. First matching condition wins. Do not replace with a multi-factor scoring system without validating the current waterfall first.

## Output shape (required fields)

Every analysis result must include:
`symbol`, `timeframe`, `trend`, `momentum`, `signal`, `confidence`, `invalidation`, `targets`, `summary`
