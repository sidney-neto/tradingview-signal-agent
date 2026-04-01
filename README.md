# tradingview-agent

Deterministic market analysis engine for conversational AI agents.

Built as an application layer over the [TradingView API](https://github.com/Mathieu2301/TradingView-API)
WebSocket client. Designed to be called by an OpenClaw agent or any AI orchestration layer.

---

## What it does

Given a symbol query and timeframe, `analyzeMarket()` returns a fully structured, deterministic analysis:

- **Trend classification** — EMA stack (20/50/100/200), SMA200
- **Momentum classification** — RSI14, volume state, trendline breaks
- **Signal detection** — `breakout_watch`, `pullback_watch`, `bearish_breakdown_watch`, `no_trade`
- **Confidence scoring** — base score + data quality adjustment + optional overlays
- **Trendline analysis** — pivot-based up/down trendline construction + break detection
- **Zone detection** — consolidation and accumulation zones
- **Optional overlays** — CoinGlass perp context, CoinGecko market breadth (graceful fallback when keys absent)
- **PT-BR summaries** — structured, mobile-friendly output for Telegram / agent responses

---

## Structure

```
tradingview-agent/              ← this repo
├── package.json
├── .env.example
├── src/
│   ├── adapters/
│   │   ├── tradingview/        ← thin adapter over @mathieuc/tradingview
│   │   │   ├── symbolSearch.js ← resolves query → symbolId
│   │   │   ├── candles.js      ← fetches OHLCV via WebSocket
│   │   │   ├── normalize.js
│   │   │   └── errors.js
│   │   ├── coinglass/          ← optional perp/macro context
│   │   │   ├── client.js
│   │   │   ├── funding.js
│   │   │   ├── openInterest.js
│   │   │   ├── macro.js        ← fear & greed, BTC dominance, altcoin season
│   │   │   └── ...
│   │   └── coingecko/          ← optional market breadth + trending
│   │       ├── client.js
│   │       ├── markets.js      ← top-50 gainers/losers → risk_on / risk_off
│   │       ├── trending.js
│   │       └── ...
│   ├── analyzer/
│   │   ├── indicators.js       ← EMA, SMA
│   │   ├── rsi.js              ← RSI (Wilder smoothing)
│   │   ├── atr.js              ← ATR + volatility classification
│   │   ├── volume.js           ← average volume + state classification
│   │   ├── pivots.js           ← pivot high/low detection
│   │   ├── trendlines.js       ← trendline construction + break detection
│   │   ├── zones.js            ← consolidation + accumulation zones
│   │   ├── rules.js            ← trend, momentum, signal classification
│   │   ├── scoring.js          ← data quality + confidence adjustment
│   │   ├── summary.js          ← PT-BR summary builder
│   │   ├── formatMTF.js        ← multi-timeframe formatter
│   │   ├── perpContext.js      ← CoinGlass bridge
│   │   └── marketContext.js    ← CoinGecko bridge
│   ├── config/
│   │   └── defaults.js
│   ├── tools/
│   │   ├── analyzeMarket.js    ← main pipeline function
│   │   └── openclawAnalyzeMarket.js  ← OpenClaw tool wrapper
│   └── utils/
│       ├── timeframes.js
│       └── validation.js
└── test/
    └── smoke.js                ← 27 deterministic smoke tests
```

---

## Quick start

```bash
npm install
npm test        # run smoke tests (no network required)
```

### Using the tool

```js
const { analyzeMarket } = require('./src/tools/analyzeMarket');

const result = await analyzeMarket({ query: 'BTC', timeframe: '4h' });
console.log(result.signal);     // 'breakout_watch' | 'pullback_watch' | ...
console.log(result.confidence); // 0.0 – 1.0
console.log(result.summary);    // structured PT-BR text block
```

### OpenClaw wrapper

```js
const { runAnalyzeTool } = require('./src/tools/openclawAnalyzeMarket');

const result = await runAnalyzeTool({ query: 'LINK', timeframe: '1h' });
if (result.ok) console.log(result.data);
else console.error(result.error.type, result.error.message);
```

---

## Environment variables

All keys are optional. Copy `.env.example` to `.env` and fill in what you want.

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `COINGLASS_API_KEY` | No | Enables perp context overlay (funding, OI, macro) |
| `COINGECKO_API_KEY` | No | Enables market breadth + trending overlay |
| `COINGECKO_API_TIER` | No | `demo` (default) or `paid` |
| `SESSION` | No | TradingView session cookie (authenticated features only) |
| `SIGNATURE` | No | TradingView signature cookie |

If a key is absent, the corresponding overlay is silently skipped — confidence uses the base + quality-adjusted score only.

---

## Dependencies

| Package | Purpose |
|---|---|
| [`@mathieuc/tradingview`](https://github.com/Mathieu2301/TradingView-API) | TradingView WebSocket client — OHLCV data, symbol search |

### Local development against a cloned tradingview-api

If you have `tradingview-api` cloned in the same parent directory, you can use
the local version instead of the npm package:

```json
// tradingview-agent/package.json
"@mathieuc/tradingview": "file:../tradingview-api"
```

Then run `npm install` inside `tradingview-agent/`.

---

## Output shape

```js
{
  symbol, symbolId, exchange, description,
  timeframe, price,
  trend,          // 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | ...
  momentum,       // 'bullish' | 'neutral_bullish' | 'neutral' | ...
  volumeState,    // 'very_low' | 'low' | 'average' | 'high' | 'very_high'
  volatilityState,
  signal,         // 'breakout_watch' | 'pullback_watch' | 'bearish_breakdown_watch' | 'no_trade'
  confidence,     // 0.0 – 1.0
  invalidation,   // string | null
  targets,        // string[]
  summary,        // PT-BR formatted text block
  indicators,     // { ema20, ema50, ema100, ema200, ma200, rsi14, avgVolume20, atr14 }
  trendlineState, // { activeTrendlineType, lineBreakDetected, lineBreakDirection, ... }
  zoneState,      // { zoneType, explanation, ... }
  perpContext,    // CoinGlass overlay | null
  macroContext,   // CoinGlass macro | null
  marketBreadthContext, // CoinGecko breadth | null
  trendingContext,      // CoinGecko trending | null
  confidenceBreakdown,  // { base, afterQuality, cgAdjustment, cgkoAdjustment, final }
  dataQuality,    // 0.0 – 1.0
  warnings,       // string[]
  candleCount,
  timestamp,
}
```

---

## Supported timeframes

`1m` `3m` `5m` `15m` `30m` `1h` `2h` `4h` `6h` `12h` `1d` `1w`

---

## License

MIT
