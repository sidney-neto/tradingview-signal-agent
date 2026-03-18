# Project instructions

## Goal
Build an MVP v1 Telegram-based market analysis service using the local sibling repository ../tradingview-api as the market-data source.

## Architecture
This project is the application layer.
It should contain:
- Telegram bot integration
- analysis API
- signal logic
- formatting
- validation
- future OpenClaw integration hooks

It should NOT duplicate the core TradingView library.

## MVP v1 scope
Implement only:
- Telegram bot
- /health endpoint
- /analyze endpoint
- command: /analyze SYMBOL TIMEFRAME

Supported timeframes:
- 5m
- 15m
- 1h

Supported analysis features:
- EMA20
- EMA50
- RSI14
- volume average
- ATR14 optional

Supported signal labels:
- breakout_watch
- pullback_watch
- bearish_breakdown_watch
- no_trade

## Rules
- Keep the MVP simple.
- Prefer deterministic rules over vague AI-style interpretation.
- Build a thin adapter around ../tradingview-api.
- Do not tightly couple the app to internal implementation details of tradingview-api.
- Explain file-by-file impact before large edits.
- Keep dependencies minimal.
- Handle errors gracefully.

## Future direction
The project may later integrate with:
- OpenClaw
- alerting workflows
- watchlists
- multi-timeframe analysis
- memory/context features

But do not implement those until the MVP is stable.

## Output style
When proposing work, separate:
- MVP now
- future-ready hooks
- optional improvements