# API instructions

## Goal
Expose a minimal and stable API for the MVP.

## MVP endpoints
- GET /health
- POST /analyze

## Rules
- Keep request and response schemas explicit.
- Validate inputs carefully.
- Return normalized JSON.
- Fail gracefully with clear error messages.
- Do not embed Telegram-specific formatting in API responses.

## Output preference
Responses should be deterministic and machine-friendly.