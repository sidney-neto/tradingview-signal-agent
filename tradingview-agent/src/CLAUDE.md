# Source directory instructions

## Goal
Keep the source code modular, readable, and ready for incremental expansion.

## Separation of concerns
Keep these areas separate:
- bot
- api
- analyzer
- tradingview adapter
- config
- utils

## Rules
- Do not mix Telegram-specific formatting into the adapter layer.
- Do not put trading signal rules inside the bot layer.
- Keep business logic in analyzer/.
- Keep tradingview-api integration isolated in tradingview/.
- Keep configuration isolated in config/.

## Preferred implementation style
- small files
- clear function names
- explicit validation
- graceful error handling
- predictable JSON outputs