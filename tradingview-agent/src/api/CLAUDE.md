# src/api/ — REST API layer

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | none | Liveness probe — always public |
| `POST` | `/analyze` | `x-api-key` header | Single-timeframe market analysis |
| `POST` | `/webhook/tradingview` | shared secret | TradingView alert ingestion + optional delivery |

## Middleware

- `auth.js` — `requireApiKey` — validates `x-api-key` against `API_KEY` env var; bypass with `DISABLE_AUTH=true`
- `rateLimit.js` — `rateLimit` singleton for `/analyze`; `createRateLimit(opts)` factory for independent limiters per endpoint
- `webhookAuth.js` — `requireWebhookSecret` — validates secret from `X-Webhook-Secret` header or `body.secret`; fails closed if `TRADINGVIEW_WEBHOOK_SECRET` is not set

## Rules

- Keep request and response schemas explicit
- Validate all inputs — return 400 with a clear `error` + `code` field on failure
- Return normalized JSON — no Telegram-specific formatting in API responses
- Domain errors from `analyzeMarket` map to specific HTTP codes (see `routes/analyze.js` and `routes/webhookTradingView.js`)
- Delivery failures must never change a successful 200 response

## Starting the server

```bash
API_KEY=your_secret npm run start:api
```
