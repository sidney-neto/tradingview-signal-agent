# Bot instructions

## Goal
Implement a simple Telegram interface for the MVP market-analysis service.

## Scope
This directory should only handle:
- Telegram command parsing
- user-facing message formatting
- API/analyzer invocation
- friendly error responses

## Rules
- Do not place market-analysis logic here.
- Do not directly depend on low-level tradingview-api internals here.
- Keep commands simple and predictable.

## MVP commands
- /start
- /help
- /analyze SYMBOL TIMEFRAME

## Output style
Responses should be:
- concise
- structured
- easy to read on mobile
- explicit when data retrieval fails