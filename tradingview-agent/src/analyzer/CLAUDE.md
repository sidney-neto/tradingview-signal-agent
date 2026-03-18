# Analyzer instructions

## Goal
Implement deterministic market-analysis logic for MVP v1.

## Scope
This layer should:
- calculate indicators
- classify trend
- classify momentum
- detect simple signal types
- generate confidence scores
- build structured outputs for the API and Telegram bot

## Rules
- Do not invent values when data is missing.
- Prefer transparent and explainable rules.
- Keep calculations and classifications separate.
- Avoid over-engineering.
- Keep the MVP focused on a few indicators and signal types.

## MVP indicators
- EMA20
- EMA50
- RSI14
- average volume
- ATR14 optional

## MVP signal labels
- breakout_watch
- pullback_watch
- bearish_breakdown_watch
- no_trade

## Output preference
Always produce structured objects with:
- symbol
- timeframe
- trend
- momentum
- signal
- confidence
- invalidation
- targets
- summary