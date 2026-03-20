# tradingview-agent

A deterministic market-analysis backend for conversational AI agents.

Designed to be called by an [OpenClaw](https://openclaw.io)-style agent or any AI orchestration layer that wants structured, explainable technical analysis from a natural-language symbol query.

---

## Architecture

```
tradingview-agent/
  src/
    adapters/tradingview/   ← thin adapter over ../tradingview-api
      symbolSearch.js       ← resolves query → symbolId via searchMarketV3
      candles.js            ← fetches OHLCV via Client + ChartSession (one-shot WebSocket)
      normalize.js          ← normalizes raw TradingView data shapes
      errors.js             ← domain error classes
    adapters/coinglass/     ← additive perp/macro context layer (read-only)
      client.js             ← shared HTTP client (auth, timeout, error mapping)
      errors.js             ← typed CoinGlass error classes
      normalize.js          ← response unwrapper + OHLC normalizer + symbol helpers
      funding.js            ← getFundingContext()
      openInterest.js       ← getOpenInterestContext()
      longShort.js          ← getLongShortContext()
      liquidation.js        ← getLiquidationContext()
      macro.js              ← getMacroContext() (F&G, BTC.D, Altcoin Season)
      index.js              ← barrel export
    adapters/bybit/         ← official Bybit V5 public market-data layer (read-only)
      client.js             ← shared V5 HTTP client (mainnet/testnet, envelope, error mapping)
      errors.js             ← typed Bybit error classes
      normalize.js          ← symbol normalization + record normalizers
      instruments.js        ← getInstrumentInfo()
      tickers.js            ← getTickerContext()
      funding.js            ← getFundingContext()
      openInterest.js       ← getOpenInterestContext()
      longShort.js          ← getLongShortContext()
      index.js              ← barrel export
    analyzer/
      indicators.js         ← EMA(n), SMA(n)
      rsi.js                ← RSI 14 (Wilder smoothing)
      atr.js                ← ATR 14 (Wilder smoothing)
      volume.js             ← average volume (20)
      pivots.js             ← pivot high/low detection
      trendlines.js         ← up/down trendlines + line-break detection
      zones.js              ← consolidation + accumulation zone detection
      rules.js              ← trend, momentum, signal classification
      scoring.js            ← data-quality assessment + confidence adjustment
      summary.js            ← human-readable summary generation
      patterns/
        index.js            ← detectChartPatterns() entrypoint
        normalize.js        ← pattern schema + PATTERN_TYPES/BIAS/STATUS enums
        geometry.js         ← fitLine, lineAt, isFlat, isRising, isFalling, findLowest, …
        scoring.js          ← scoreSymmetry, countTouches, weightedScore, qualityToConfidence, …
        headShoulders.js    ← Head & Shoulders / Inverse H&S
        doubleTopBottom.js  ← Double Top / Double Bottom
        triangles.js        ← Ascending, Descending, Symmetrical Triangles
        flags.js            ← Bull/Bear Flags and Pennants
        wedges.js           ← Rising Wedge (bearish) / Falling Wedge (bullish)
        cupHandle.js        ← Cup and Handle
        rectangles.js       ← Rectangle / Range
    tools/
      analyzeMarket.js      ← main entry point function
    config/
      defaults.js           ← tunable defaults
    utils/
      timeframes.js         ← timeframe mapping + validation
      validation.js         ← input validation
```

Depends on `../tradingview-api` as a local sibling package — it is **not** duplicated here.

---

## Quick start

```bash
# From this directory
npm install

# Run the smoke test
node test/smoke.js
```

---

## Primary API

### `analyzeMarket({ query, timeframe, options? })`

```js
const { analyzeMarket } = require('./src/tools/analyzeMarket');

const result = await analyzeMarket({
  query:     'BTC',      // or 'AAPL', 'BINANCE:BTCUSDT', 'ETH/USDT', etc.
  timeframe: '15m',      // see supported timeframes below
  options: {
    // all optional
    candleCount:  300,          // default: 300
    timeoutMs:    20000,        // WebSocket fetch timeout (ms), default: 20000
    symbolFilter: 'crypto',     // market filter for symbol search (optional)
    token:        '',           // TradingView session token (optional, for auth)
    signature:    '',           // TradingView session signature (optional)
  }
});
```

---

## Supported timeframes

| Label | Description |
|-------|-------------|
| `5m`  | 5 minutes   |
| `15m` | 15 minutes  |
| `30m` | 30 minutes  |
| `1h`  | 1 hour      |
| `4h`  | 4 hours     |
| `1d`  | 1 day       |
| `1w`  | 1 week      |

---

## Output shape

```js
{
  // Identity
  symbol:         'BTCUSDT',
  symbolId:       'BINANCE:BTCUSDT',
  exchange:       'BINANCE',
  description:    'Bitcoin / Tether USD',
  timeframe:      '15m',

  // Price
  price:          67420.5,

  // Classification
  trend:          'bullish',          // strong_bullish | bullish | neutral_bullish | neutral_bearish | bearish | strong_bearish | unknown
  momentum:       'neutral_bullish',  // overextended_bullish | bullish | neutral_bullish | neutral_bearish | bearish | oversold_bearish | unknown
  volumeState:    'average',          // very_high | high | average | low | very_low | unknown
  volatilityState:'moderate',         // extreme | high | moderate | low | very_low | unknown
  signal:         'pullback_watch',   // breakout_watch | pullback_watch | bearish_breakdown_watch | no_trade

  // Confidence + risk
  confidence:     0.47,               // 0–1 (adjusted for data quality)
  invalidation:   'Close below EMA50 or prior swing low.',
  targets:        ['Test of recent highs or upper range.'],

  // Indicators
  indicators: {
    ema20:       67105.2,
    ema50:       65842.1,
    ema100:      63020.4,
    ema200:      58102.7,
    ma200:       57800.1,
    rsi14:       58.3,
    avgVolume20: 12400,
    atr14:       1240.5,
  },

  // Chart patterns (null array when ≤40 candles or options.skipPatterns=true)
  chartPatterns: [
    {
      type:              'head_and_shoulders',    // see pattern types below
      displayName:       'Ombro-Cabeça-Ombro',   // PT-BR label
      bias:              'bearish',               // bullish | bearish | neutral
      status:            'near_breakout',         // forming | near_breakout | confirmed
      confidence:        0.56,                   // 0–0.70 (capped; quality-derived)
      quality:           0.72,                   // raw quality score 0–1
      timeframe:         '1h',
      startIndex:        120,                    // candle index of pattern start
      endIndex:          199,                    // candle index of pattern end (current)
      keyLevels:         { ... },                // pattern-specific price levels
      breakoutLevel:     67400.0,
      invalidationLevel: 68200.0,
      explanation:       'Ombro-Cabeça-Ombro: ...',
      source:            'pattern_detector',
    }
  ],

  // Structure
  trendlineState: {
    activeTrendlineType: 'bearish',   // bearish | bullish | both | none
    bearishTrendline: { ... },
    bullishTrendline: null,
    lineBreakDetected:    false,
    lineBreakDirection:   'none',     // bullish_break | bearish_break | none
    pivotContext: { ... },
    explanation:  'Price is below bearish trendline (68500) — resistance overhead.',
  },

  zoneState: {
    zoneType:     'none',             // consolidation | accumulation | none
    zoneHigh:     null,
    zoneLow:      null,
    zoneStrength: null,
    breakoutRisk: 'low',
    explanation:  '...',
  },

  // Optional CoinGecko context (null when COINGECKO_API_KEY is absent or unavailable)
  marketBreadthContext: {
    regime:         'risk_on',  // risk_on | risk_off | mixed
    total:          50,
    gainers:        35,
    losers:         13,
    neutral:        2,
    gainersPercent: 70,
    vsCurrency:     'usd',
    source:         'coingecko',
  },
  trendingContext: {
    isTrending:    false,       // true if base coin is in CoinGecko trending list
    trendingRank:  null,        // 1-based rank when isTrending=true
    matchedSymbol: null,
    matchedName:   null,
    source:        'coingecko',
  },

  // Meta
  dataQuality:    'fair',            // good | fair | poor
  warnings:       ['EMA200 unavailable (likely insufficient history).'],
  candleCount:    287,
  summary:        'BTCUSDT @ 67420.5 (15m) Trend: Bullish. Momentum: Neutral Bullish...',
  timestamp:      '2026-03-16T10:00:00.000Z',
}
```

---

## Error types

All errors from the adapter layer are typed domain errors exported from `src/adapters/tradingview/errors.js`:

| Class | When |
|-------|------|
| `SymbolNotFoundError`       | Query returned no matching symbol |
| `AmbiguousSymbolError`      | Multiple equally-good matches (rare) |
| `UnsupportedTimeframeError` | Timeframe not in supported list |
| `MarketDataUnavailableError`| TradingView session or symbol error |
| `CandleFetchTimeoutError`   | WebSocket timeout |
| `InsufficientCandlesError`  | Too few candles for reliable analysis |
| `SessionError`              | Low-level WebSocket client failure |

---

## Computed indicators and features

| Feature | Method |
|---------|--------|
| EMA 20/50/100/200 | Standard EMA (seed = SMA, k = 2/(n+1)) |
| MA 200 | Simple rolling average |
| RSI 14 | Wilder's smoothing |
| ATR 14 | Wilder's smoothing, True Range |
| Avg Volume (20) | Rolling simple average |
| Pivot highs/lows | N-bar lookback on each side |
| Bearish trendline | Descending pivot-high pairs, slope + projection |
| Bullish trendline | Ascending pivot-low pairs, slope + projection |
| Line-break detection | Price close crossing projected trendline level |
| Consolidation zone | ATR-relative range compression over lookback window |
| Accumulation zone | Consolidation + prior decline + low defense heuristics |

All computations are local to this repository and do not depend on TradingView indicators or external proprietary code.

---

## Chart pattern detection

`detectChartPatterns(candles, options)` in `src/analyzer/patterns/` runs a conservative heuristic pipeline over the candle series. It is called automatically by `analyzeMarket()` and returned as `chartPatterns`.

### Detected patterns

| Type constant | Display name (PT-BR) | Bias |
|---|---|---|
| `head_and_shoulders` | Ombro-Cabeça-Ombro | bearish |
| `inverse_head_and_shoulders` | OCO Invertido | bullish |
| `double_top` | Topo Duplo | bearish |
| `double_bottom` | Fundo Duplo | bullish |
| `ascending_triangle` | Triângulo Ascendente | bullish |
| `descending_triangle` | Triângulo Descendente | bearish |
| `symmetrical_triangle` | Triângulo Simétrico | neutral |
| `bull_flag` | Bandeira de Alta | bullish |
| `bear_flag` | Bandeira de Baixa | bearish |
| `bull_pennant` | Flâmula de Alta | bullish |
| `bear_pennant` | Flâmula de Baixa | bearish |
| `rising_wedge` | Cunha Ascendente | bearish |
| `falling_wedge` | Cunha Descendente | bullish |
| `cup_and_handle` | Xícara e Alça | bullish |
| `rectangle` | Retângulo / Range | neutral |

### Design constraints

- **No lookahead**: only current bar and history are used
- **ATR-relative tolerances**: all thresholds scale with volatility, not fixed prices
- **Conservative**: patterns with `quality < 0.28` are rejected; under-detection preferred
- **Non-blocking**: a detector exception never kills the pipeline (`safeDetect` wrapper)
- **Deterministic**: same candles always produce the same output
- Requires at least 40 candles; returns `[]` otherwise

### Options

| Option | Default | Description |
|---|---|---|
| `atr` | estimated from last 14 bars | ATR value for tolerance scaling |
| `avgVolume` | `0` | 20-bar average volume (used for `volumeBonus`) |
| `timeframe` | `null` | Timeframe label attached to output |
| `lookback` | `5` | Pivot lookback window (bars on each side) |
| `maxPatterns` | `5` | Maximum patterns returned (sorted by quality desc) |

Pass `options.skipPatterns = true` to `analyzeMarket()` to bypass pattern detection entirely.

---

## Signal priority order

Signal classification in `src/analyzer/rules.js` uses a sequential if/else waterfall. This is a deliberate MVP v1 design choice for simplicity and auditability. The first matching condition wins:

| Priority | Signal | Condition |
|----------|--------|-----------|
| 1 | `breakout_watch` | Bullish trendline break + bullish trend alignment |
| 2 | `breakout_watch` | Accumulation zone + bullish structure emerging |
| 3 | `pullback_watch` | Bullish trend + bullish momentum, not overextended |
| 4 | `pullback_watch` | Bearish trendline intact above price, bullish trend context |
| 5 | `bearish_breakdown_watch` | Bearish trendline break + bearish trend alignment |
| 6 | `bearish_breakdown_watch` | Bearish trend + bearish momentum |
| 7 | `no_trade` (confident, 0.60) | Consolidation zone detected |
| 8 | `no_trade` (default, 0.50) | No condition matched — ambiguous or mixed market |

To change which signal fires in a given market condition, re-order these branches. Do not replace this waterfall with a multi-factor scoring system until the MVP is stable and the priority order has been validated against real outputs.

**`no_trade` confidence:** A value of `0.50` means the system is moderately confident there is no actionable setup — not that the system failed. A value of `0.60` means the system detected a consolidation zone and is more confident that no directional trade is appropriate until the zone breaks.

---

## Future integration hooks

The codebase is structured so the following can be added without refactoring core logic:

- **OpenClaw tool registration**: wrap `analyzeMarket` as an OpenClaw `Tool` definition
- **Multi-timeframe analysis**: call `analyzeMarket` across timeframes, merge `trendlineState` / `zoneState`
- **Watchlist scanning**: iterate a symbol list, filter by signal
- **Alerting**: compare consecutive `analyzeMarket` calls for signal transitions
- **TradingView authentication**: pass `token` + `signature` from `loginUser` into options
- **Custom indicator integration**: `getIndicator` + `ChartSession.Study` (future adapter module)

---

---

## CoinGlass adapter

An additive context layer that enriches analysis with perpetual futures and macro crypto data. It does **not** replace or modify the TradingView analysis engine — it is an independent module.

### Setup

```bash
export COINGLASS_API_KEY=your_key_here
```

The adapter reads `COINGLASS_API_KEY` from the environment. All five context functions throw `MissingApiKeyError` synchronously if the key is absent.

### Available functions

```js
const {
  getFundingContext,
  getOpenInterestContext,
  getLongShortContext,
  getLiquidationContext,
  getMacroContext,
} = require('./src/adapters/coinglass');
```

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `getFundingContext(symbol, options?)` | `/api/futures/funding-rate/history` | Crowded long/short positioning via funding rates |
| `getOpenInterestContext(symbol, options?)` | `/api/futures/open-interest/aggregated-history` | OI expansion/contraction across all exchanges |
| `getLongShortContext(symbol, options?)` | `/api/futures/global-long-short-account-ratio/history` | Account-level crowd bias |
| `getLiquidationContext(symbol, options?)` | `/api/futures/liquidation/history` | Recent squeeze / flush context |
| `getMacroContext(options?)` | Fear & Greed, BTC Dominance, Altcoin Season | Macro crypto regime |

### Symbol formats

All functions accept raw symbol strings in any of these formats:

```
'BINANCE:MMTUSDT.P'  →  base coin: MMT,  pair: MMTUSDT
'BTCUSDT.P'          →  base coin: BTC,  pair: BTCUSDT
'BTCUSDT'            →  base coin: BTC,  pair: BTCUSDT
'BTC'                →  base coin: BTC  (OI endpoint only)
```

### Options

All functions accept an options object. Key shared options:

| Option | Default | Description |
|--------|---------|-------------|
| `exchange` | `'Binance'` | Exchange name (funding/longShort/liquidation) |
| `interval` | `'1h'` / `'4h'` | Aggregation interval |
| `limit` | `24` / `42` | Number of records |
| `timeoutMs` | `10000` | Request timeout (ms) |

### Error types

All errors extend `CoinGlassError` and carry a `.code` string:

| Code | Class | When |
|------|-------|------|
| `missing_api_key` | `MissingApiKeyError` | `COINGLASS_API_KEY` not set |
| `unauthorized` | `UnauthorizedError` | Invalid key (HTTP 401/403) |
| `rate_limited` | `RateLimitedError` | Too many requests (HTTP 429) |
| `upstream_unavailable` | `UpstreamUnavailableError` | CoinGlass server error / network failure |
| `invalid_symbol` | `InvalidSymbolError` | Symbol string is empty or unparseable |
| `invalid_response` | `InvalidResponseError` | Unexpected JSON shape or non-zero API code |
| `timeout` | `CoinGlassTimeoutError` | Request exceeded `timeoutMs` |
| `unsupported_feature` | `UnsupportedFeatureError` | Feature not yet implemented |
| `internal_error` | `CoinGlassInternalError` | Unexpected adapter-level failure |

### Current status

CoinGlass is currently a **read-only context layer**. It does not affect `analyzeMarket()` outputs. Future integration points:

- Funding regime filter on `pullback_watch` confidence
- OI expansion check for `breakout_watch` conviction
- Macro Fear & Greed as a confidence multiplier for altcoin setups

---

## CoinGecko adapter

An optional discovery and market-breadth layer. Does **not** replace or modify the TradingView analysis engine — it is an independent module.

### Setup

```bash
export COINGECKO_API_KEY=your_key_here        # demo or paid key (optional, but recommended)
export COINGECKO_API_TIER=demo                # 'demo' (default) or 'paid'
```

No key is required for basic usage (public tier), but the rate limit is aggressive (~10–30 req/min). A demo key raises the limit and improves reliability.

### Available functions

```js
const {
  getTrending,
  getTopCoins,
  getPrice,
  getMarketChart,
} = require('./src/adapters/coingecko');
```

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `getTrending(options?)` | `GET /search/trending` | Top trending coins + categories (updated ~every 10 min) |
| `getTopCoins(options?)` | `GET /coins/markets` | Top N coins by market cap + breadth metrics |
| `getPrice(ids, options?)` | `GET /simple/price` | Current price by CoinGecko ID (e.g. `'bitcoin'`) |
| `getMarketChart(id, options?)` | `GET /coins/{id}/market_chart` | Historical price/volume series for a coin |

### Options

| Option | Default | Applies to |
|--------|---------|------------|
| `vsCurrency` | `'usd'` | getTopCoins, getPrice, getMarketChart |
| `perPage` | `50` | getTopCoins (max 250) |
| `days` | `30` | getMarketChart |
| `timeoutMs` | `10000` | all functions |

### Normalized output shapes

**`getTrending()`**
```js
{
  topTrending: [{ id, symbol, name, marketCapRank, priceChangePercent24h, score, thumb }],
  trendingIds: ['solana', 'pepe', ...],
  trendingSymbols: ['SOL', 'PEPE', ...],
  categories: [{ id, name, marketCap1hChange }],
  warnings: [],
  source: 'coingecko',
}
```

**`getTopCoins()`**
```js
{
  leaders: [{ id, symbol, name, rank, price, marketCap, priceChangePercent24h, volume24h, ... }],
  marketBreadth: { total, gainers, losers, neutral, gainersPercent, regime },
  vsCurrency: 'usd',
  warnings: [],
  source: 'coingecko',
}
// regime: 'risk_on' (>=60% green) | 'risk_off' (<=40% green) | 'mixed'
```

**`getMarketChart(id)`**
```js
{
  id: 'bitcoin', vsCurrency: 'usd', days: 30,
  prices:     [{ time: <ms>, value: <price> }],
  marketCaps: [{ time: <ms>, value: <cap> }],
  volumes:    [{ time: <ms>, value: <vol> }],
  source: 'coingecko',
}
```

### Error types

All errors extend `CoinGeckoError` with a `.code` string:

| Code | Class | When |
|------|-------|------|
| `missing_api_key` | `MissingApiKeyError` | Key explicitly required but absent |
| `unauthorized` | `UnauthorizedError` | Invalid key (HTTP 401/403) |
| `rate_limited` | `RateLimitedError` | Too many requests (HTTP 429) |
| `plan_restricted` | `PlanRestrictedError` | Endpoint requires plan upgrade |
| `upstream_unavailable` | `UpstreamUnavailableError` | Server error / network failure |
| `symbol_not_found` | `SymbolNotFoundError` | No coin found for query |
| `invalid_response` | `InvalidResponseError` | Unexpected JSON shape |
| `timeout` | `CoinGeckoTimeoutError` | Request exceeded `timeoutMs` |

### Current status and integration

CoinGecko enriches `analyzeMarket()` output with two optional fields and a small confidence overlay:

- **`marketBreadthContext`** — broad market breadth summary (regime, gainers/losers ratio) from the top 50 coins by market cap
- **`trendingContext`** — whether the analyzed asset appears in CoinGecko's current trending list (matched by base coin symbol, e.g. `BINANCE:MMTUSDT.P → MMT`)

Both fields are `null` when `COINGECKO_API_KEY` is not set or when CoinGecko is unavailable. The core signal engine and TradingView data are never affected by CoinGecko availability.

#### Confidence overlay

A small confidence adjustment is applied to **altcoin** `pullback_watch` and `breakout_watch` signals only. BTC and ETH are excluded.

| Condition | Signal | Δ confidence |
|---|---|---|
| `risk_on` breadth | breakout or pullback | +0.03 |
| `risk_off` breadth | `breakout_watch` | −0.05 |
| `risk_off` breadth | `pullback_watch` | −0.03 |
| `mixed` breadth | any | 0 |
| Trending (rank ≤ 3) | `breakout_watch` | +0.05 |
| Trending (rank ≤ 3) | `pullback_watch` | +0.03 |
| Trending (rank > 3) | `breakout_watch` | +0.03 |
| Trending (rank > 3) | `pullback_watch` | +0.02 |

Total CoinGecko delta is capped at `[−0.05, +0.08]`. The adjustment is visible in `confidenceBreakdown.cgkoAdjustment` and explained in `confidenceBreakdown.cgkoReasons`.

The bridge lives in `src/analyzer/marketContext.js`. Adjustment logic is in `computeMarketContextAdjustment()` (pure function, unit-tested).

Planned future wiring:
- Trending rank as a discovery signal for watchlist scans
- Agent responses: "what is trending right now?"

---

## Bybit adapter

An official read-only public market-data layer using the **Bybit V5 REST API**. TradingView remains the primary source of technical structure and signal logic. The Bybit adapter is additive — it is optional, and its absence does not affect the core analysis engine.

### Purpose

- Provides **official** perpetual/futures context directly from Bybit
- Complements CoinGlass (which can be plan-restricted) as a funding/OI source
- Designed for later wiring into the signal confidence pipeline

### Available functions

```js
const {
  getInstrumentInfo,
  getTickerContext,
  getFundingContext,
  getOpenInterestContext,
  getLongShortContext,
} = require('./src/adapters/bybit');
```

| Function | Endpoint | Returns |
|---|---|---|
| `getInstrumentInfo(symbol, opts?)` | `/v5/market/instruments-info` | Contract metadata: category, status, tickSize, qtyStep, contractType |
| `getTickerContext(symbol, opts?)` | `/v5/market/tickers` | Snapshot: lastPrice, markPrice, indexPrice, fundingRate, openInterest, basis, volume24h |
| `getFundingContext(symbol, opts?)` | `/v5/market/funding/history` | currentFunding, averageFunding, fundingBias, fundingRegime |
| `getOpenInterestContext(symbol, opts?)` | `/v5/market/open-interest` | currentOI, oiTrend, oiExpansion, oiRegime |
| `getLongShortContext(symbol, opts?)` | `/v5/market/account-ratio` | longShortRatio (buyRatio), crowdBias, crowdingRisk |

All functions accept symbols in any project format: `BTCUSDT`, `BTCUSDT.P`, `BINANCE:BTCUSDT.P`.

### Environment variables

```bash
BYBIT_ENV=mainnet          # mainnet (default) | testnet
BYBIT_BASE_URL=            # optional base URL override
BYBIT_TIMEOUT_MS=10000     # optional request timeout
```

No API key required — all functions use public Bybit V5 endpoints.

### Error classes

| Class | Code | Cause |
|---|---|---|
| `MissingSymbolError` | `missing_symbol` | Symbol argument absent |
| `InvalidSymbolError` | `invalid_symbol` | Symbol not found on Bybit |
| `GeoRestrictedError` | `geo_restricted` | HTTP 403 — geo block |
| `RateLimitedError` | `rate_limited` | HTTP 429 |
| `UpstreamUnavailableError` | `upstream_unavailable` | HTTP 5xx |
| `BybitTimeoutError` | `timeout` | Request timed out |
| `InvalidResponseError` | `invalid_response` | Malformed V5 envelope |
| `BybitApiError` | `api_error` | V5 retCode ≠ 0 |

### Future work

- **Signal engine wiring** — bridge funding/OI/LS into `src/analyzer/bybitContext.js` (analogous to `perpContext.js`) and wire confidence adjustments
- **WebSocket** — `src/adapters/bybit/ws.js` for live ticker/orderbook streaming (`wss://stream.bybit.com/v5/public/linear`)
- **Authenticated endpoints** — add `privateClient.js` with HMAC-SHA256 signing for orders, positions, and account management (future trading execution phase)

---

## Requirements

- Node.js >= 16
- Sibling repository `../tradingview-api` must exist and be valid
- `COINGLASS_API_KEY` environment variable (required only for CoinGlass adapter functions)
- `COINGECKO_API_KEY` environment variable (optional; public tier works without it)
