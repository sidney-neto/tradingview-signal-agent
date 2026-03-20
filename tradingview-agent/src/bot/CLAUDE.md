# src/bot/ — Telegram bot

## Status

**Not yet implemented.** This directory is a placeholder.

The delivery layer (`src/delivery/`) already handles sending analysis results to Telegram after webhook events. The bot layer is intended for interactive command-based usage.

## Planned scope

When implemented, this layer should only handle:
- Telegram command parsing (`/analyze SYMBOL TIMEFRAME`, `/help`, `/start`)
- Invoking `analyzeMarket` or `analyzeMarketMTF`
- Formatting responses for Telegram (reuse `src/delivery/formatter.js` where possible)
- Returning friendly error messages

## Rules (when implemented)

- No market analysis logic here — call `analyzeMarket` / `analyzeMarketMTF` from `src/tools/`
- No direct dependency on `@mathieuc/tradingview` internals
- No signal rules inside the bot layer
- Reuse PT-BR formatting from `src/delivery/formatter.js` and `src/analyzer/summary.js`
