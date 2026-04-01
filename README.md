# tradingview-signal-agent

Deterministic crypto market analysis engine built on top of TradingView candle data.

It is designed for AI agents, webhook-driven workflows, and automation that need structured signal analysis instead of opaque text output.

## 📌 What This Project Is

This project is a Node.js workspace whose runnable package lives in [`tradingview-agent/`](tradingview-agent/).

At a high level, it:

- fetches OHLCV candles from TradingView
- runs a deterministic technical analysis pipeline locally
- classifies trend, momentum, volatility, and signal state
- optionally enriches the result with market context from CoinGlass, CoinGecko, and Bybit
- exposes the result through code, REST endpoints, and TradingView webhook ingestion

Typical outputs include:

- `breakout_watch`
- `pullback_watch`
- `bearish_breakdown_watch`
- `no_trade`

## ⚙️ How The Project Works

The core flow is:

1. A symbol query such as `BTC`, `ETHUSDT`, or `BINANCE:BTCUSDT.P` is received.
2. The TradingView adapter resolves that query into a market symbol.
3. The TradingView candle adapter fetches recent candles over WebSocket.
4. The local analyzer computes indicators, pivots, trendlines, zones, patterns, trend, momentum, and signal.
5. Optional context layers adjust or enrich the output:
   - CoinGlass: perp and macro context
   - CoinGecko: breadth and trending context
   - Bybit: public perp context fallback
6. The final response is returned as a structured JSON object or delivered through webhook-connected channels.

Core modules:

- `tradingview-agent/src/tools/analyzeMarket.js`: main single-timeframe entrypoint
- `tradingview-agent/src/tools/analyzeMarketMTF.js`: multi-timeframe wrapper
- `tradingview-agent/src/analyzer/pipeline.js`: deterministic analysis core
- `tradingview-agent/src/api/`: REST API and TradingView webhook ingestion
- `tradingview-agent/src/delivery/`: Telegram and OpenClaw delivery layer
- `tradingview-agent/src/backtest/`: replay/backtest utilities for fixture-based validation

## 🧪 Usage Examples

### 1. Use from code

```js
const { analyzeMarket } = require('./tradingview-agent/src/tools/analyzeMarket');

async function run() {
  const result = await analyzeMarket({
    query: 'BTC',
    timeframe: '1h',
  });

  console.log(result.signal);
  console.log(result.confidence);
  console.log(result.summary);
}

run().catch(console.error);
```

### 2. Use through the API

Start the API from the package directory:

```bash
cd tradingview-agent
API_KEY=your_secret npm run start:api
```

Then call the analysis endpoint:

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_secret" \
  -d '{"query":"BTC","timeframe":"1h"}'
```

### 3. Use multi-timeframe analysis

```js
const { analyzeMarketMTF } = require('./tradingview-agent/src/tools/analyzeMarketMTF');

async function run() {
  const result = await analyzeMarketMTF({
    query: 'ETH',
    timeframes: ['1h', '4h', '1d'],
  });

  console.log(result.mtfSummary);
}

run().catch(console.error);
```

## 📣 TradingView Alert / Prompt Examples

If you want TradingView alerts to hit this project through the webhook route, use JSON payloads like these.

### Minimal alert payload

```json
{
  "secret": "your-webhook-secret",
  "query": "BTCUSDT",
  "timeframe": "1h"
}
```

### Exchange + symbol payload

```json
{
  "secret": "your-webhook-secret",
  "exchange": "BINANCE",
  "symbol": "ETHUSDT",
  "timeframe": "4h"
}
```

### Perpetual pair payload

```json
{
  "secret": "your-webhook-secret",
  "query": "BINANCE:BTCUSDT.P",
  "timeframe": "15m",
  "message": "TradingView alert fired"
}
```

Useful TradingView-side query examples:

- `BTC`
- `ETH`
- `BTCUSDT`
- `BINANCE:BTCUSDT`
- `BINANCE:BTCUSDT.P`
- `BYBIT:ETHUSDT.P`

## 🚀 QuickStart

### 1. Install dependencies

From the repository root:

```bash
npm install
```

### 2. Run the smoke tests

The workspace test script on `main` still expects a local `.env`, so the most direct smoke-test command is:

```bash
node tradingview-agent/test/smoke.js
```

### 3. Prepare environment variables

```bash
cp tradingview-agent/.env.example tradingview-agent/.env
```

Optional keys:

- `COINGLASS_API_KEY`
- `COINGECKO_API_KEY`
- `TRADINGVIEW_WEBHOOK_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `OPENCLAW_DELIVERY_URL`

### 4. Start the API

```bash
cd tradingview-agent
API_KEY=your_secret npm run start:api
```

### 5. Check health

```bash
curl http://localhost:3000/health
```

### 6. Send a test analysis request

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_secret" \
  -d '{"query":"BTC","timeframe":"1h"}'
```

## 🧭 Supported Timeframes

The current project supports:

`1m` `3m` `5m` `15m` `30m` `1h` `2h` `4h` `6h` `12h` `1d` `1w`

## 📝 Notes

- The analysis core is deterministic and local.
- External context providers are optional and degrade gracefully when unavailable.
- The project includes a REST API, TradingView webhook ingestion, delivery modules, and backtest helpers.
- More implementation detail is available in [`tradingview-agent/README.md`](tradingview-agent/README.md).

## 📄 License

MIT
