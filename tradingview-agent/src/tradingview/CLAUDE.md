# TradingView adapter instructions

## Goal
This directory is the integration boundary with ../tradingview-api.

## Rules
- Build a thin adapter layer.
- Normalize outputs returned by the library.
- Avoid leaking internal library structures to the rest of the app.
- Prefer stable public APIs from tradingview-api.
- Do not copy core logic from tradingview-api unless absolutely necessary.

## Responsibilities
This directory should handle:
- symbol normalization
- timeframe normalization
- market data retrieval
- chart/candle retrieval
- indicator/study retrieval
- conversion into app-friendly objects

## Output preference
Functions in this directory should return normalized data structures that are safe for:
- analyzer/
- api/
- bot/

## Important
If tradingview-api behavior is unclear, inspect examples and tests first before adding workarounds.