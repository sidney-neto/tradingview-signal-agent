# Guia de Prompts — TradingView Signal Agent

Exemplos de como interagir com o agente via **REST API**, **webhook** e **código Node.js**.
Todos os prompts assumem que o servidor está rodando em `http://localhost:3000`.

---

## Índice

1. [Health check](#1-health-check)
2. [Análise single-timeframe](#2-análise-single-timeframe)
3. [Análise multi-timeframe (MTF)](#3-análise-multi-timeframe-mtf)
4. [Webhook TradingView](#4-webhook-tradingview)
5. [Trade Qualification — interpretando o plano de trade](#5-trade-qualification--interpretando-o-plano-de-trade)
6. [MTF Qualification — confirmação entre timeframes](#6-mtf-qualification--confirmação-entre-timeframes)
7. [Market Regime — estado macro do mercado](#7-market-regime--estado-macro-do-mercado)
8. [Backtest via CLI](#8-backtest-via-cli)
9. [Integração com agente AI (OpenClaw)](#9-integração-com-agente-ai-openclaw)
10. [Padrões de uso para agentes autônomos](#10-padrões-de-uso-para-agentes-autônomos)

---

## 1. Health check

Verifica se o servidor está no ar, quais provedores estão configurados e quais timeframes são suportados.

```bash
curl http://localhost:3000/health
```

**Resposta esperada:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptimeSec": 142,
  "providers": {
    "coinglass": { "configured": true },
    "bybit":     { "configured": true },
    "coingecko": { "configured": true, "tier": "demo" }
  },
  "cache":    { "enabled": false },
  "delivery": { "enabled": true, "providers": ["telegram"] },
  "timeframes": ["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w"],
  "timestamp": "2026-04-01T22:00:00.000Z"
}
```

**Quando usar:** antes de enviar análises, para confirmar que provedores de contexto (CoinGlass, CoinGecko) estão ativos. Se `configured: false`, os campos `marketRegime` e sobreposições de confiança virão degradados.

---

## 2. Análise single-timeframe

### BTC perpetual — 1h

```bash
curl -s -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-api-key: SEU_API_KEY" \
  -d '{"query": "BTCUSDT.P", "timeframe": "1h"}'
```

### ETH — 4h

```bash
curl -s -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-api-key: SEU_API_KEY" \
  -d '{"query": "ETHUSDT", "timeframe": "4h"}'
```

### Busca por nome (sem ID exato)

```bash
curl -s -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-api-key: SEU_API_KEY" \
  -d '{"query": "SOLUSDT", "timeframe": "15m"}'
```

### Com exchange explícita

```bash
curl -s -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -H "x-api-key: SEU_API_KEY" \
  -d '{"query": "BINANCE:BTCUSDT", "timeframe": "1d"}'
```

**Campos-chave da resposta:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `signal` | string | `breakout_watch` \| `pullback_watch` \| `bearish_breakdown_watch` \| `no_trade` |
| `confidence` | number | 0.10 – 0.95 |
| `trend` | string | `strong_bullish` \| `bullish` \| `neutral` \| `bearish` \| `strong_bearish` |
| `momentum` | string | `bullish` \| `slightly_bullish` \| `neutral` \| `slightly_bearish` \| `bearish` |
| `invalidation` | string \| null | Condição que invalida o setup |
| `targets` | array | Targets de preço calculados |
| `tradeQualification` | object | Plano de trade estruturado (ver seção 5) |
| `marketRegime` | object | Regime macro do mercado (ver seção 7) |
| `chartPatterns` | array | Padrões gráficos detectados |
| `summary` | string | Resumo em PT-BR formatado para Telegram |

**Timeframes suportados:** `1m` `3m` `5m` `15m` `30m` `1h` `2h` `4h` `6h` `12h` `1d` `1w`

---

## 3. Análise multi-timeframe (MTF)

Use `analyzeMarketMTF` diretamente em Node.js para obter leitura consolidada de múltiplos timeframes com qualificação MTF automática.

### BTC — 30m / 1h / 4h / 1d

```js
const { analyzeMarketMTF } = require('./src/tools/analyzeMarketMTF');

const result = await analyzeMarketMTF({
  query: 'BTCUSDT.P',
  timeframes: ['30m', '1h', '4h', '1d'],
});

console.log(result.mtfSummary);          // resumo PT-BR consolidado
console.log(result.results['1h']);        // resultado completo do 1h
console.log(result.mtfQualification);    // qualificação cruzada entre TFs
```

### ETH — swing trade (1h base, 4h e 1d como referência)

```js
const result = await analyzeMarketMTF({
  query: 'ETHUSDT',
  timeframes: ['1h', '4h', '1d'],
});

// Verificar alinhamento entre TFs
const mtf = result.mtfQualification;
if (mtf) {
  console.log('Alinhamento:', mtf.overallAlignment);     // 'confirming' | 'conflicting' | 'neutral'
  console.log('Ajuste de confiança:', mtf.confidenceAdj); // ex: +0.06
  console.log('TFs confirmando:', mtf.confirming);
  console.log('TFs conflitando:', mtf.conflicting);
}
```

### Altcoin scalp — timeframes curtos

```js
const result = await analyzeMarketMTF({
  query: 'SOLUSDT',
  timeframes: ['5m', '15m', '1h'],
});

// Iterar por TF e filtrar apenas setups acionáveis
for (const [tf, r] of Object.entries(result.results)) {
  if (r.signal !== 'no_trade') {
    console.log(`[${tf}] ${r.signal} — confiança: ${r.confidence}`);
    console.log('  Qualidade:', r.tradeQualification?.setupQuality);
  }
}
```

**Campos da resposta MTF:**

| Campo | Descrição |
|-------|-----------|
| `results` | Objeto `{ [timeframe]: analyzeMarketResult }` |
| `errors` | Objeto `{ [timeframe]: { error, code } }` — TFs que falharam |
| `mtfSummary` | Bloco PT-BR formatado com todos os TFs |
| `mtfQualification` | Qualificação cruzada (ver seção 6) |
| `warnings` | Avisos agregados de todos os TFs |

---

## 4. Webhook TradingView

O webhook recebe alertas do TradingView, analisa o ativo e entrega o resultado via Telegram/OpenClaw.

### Payload mínimo

```json
{
  "secret": "SEU_WEBHOOK_SECRET",
  "query": "BTCUSDT.P",
  "timeframe": "1h"
}
```

### Payload completo com mensagem do alerta

```json
{
  "secret": "SEU_WEBHOOK_SECRET",
  "query": "BTCUSDT.P",
  "timeframe": "4h",
  "message": "RSI cruzou 50 — momentum bullish"
}
```

### Usando symbol + exchange (quando query não está disponível)

```json
{
  "secret": "SEU_WEBHOOK_SECRET",
  "symbol": "BTCUSDT",
  "exchange": "BINANCE",
  "timeframe": "1h"
}
```

### Via curl

```bash
curl -s -X POST http://localhost:3000/webhook/tradingview \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "SEU_WEBHOOK_SECRET",
    "query": "ETHUSDT.P",
    "timeframe": "1h"
  }'
```

### Com secret no header (alternativa mais segura)

```bash
curl -s -X POST http://localhost:3000/webhook/tradingview \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: SEU_WEBHOOK_SECRET" \
  -d '{"query": "BTCUSDT.P", "timeframe": "1h"}'
```

**Comportamentos de deduplicação:**

| Cenário | Comportamento |
|---------|--------------|
| Mesmo `(query, timeframe)` dentro de 10s | `409 Conflict` — análise bloqueada |
| Mesmo sinal entregue novamente dentro do TTL | Delivery pulado silenciosamente |
| `no_trade` repetido | TTL de 5 min para evitar ruído operacional |
| Sinal muda (ex: `no_trade` → `breakout_watch`) | Delivery liberado mesmo dentro do TTL |

**Resposta de sucesso (200):**
```json
{
  "status": "accepted",
  "correlationId": "a1b2c3d4-...",
  "normalizedRequest": { "query": "BTCUSDT.P", "timeframe": "1h" },
  "warnings": [],
  "analysis": { "...análise completa..." },
  "delivery": [{ "provider": "telegram", "success": true }]
}
```

**Suprimir entrega de `no_trade`** — útil para reduzir ruído no Telegram:
```bash
WEBHOOK_SUPPRESS_NO_TRADE=true npm run start:api
```

---

## 5. Trade Qualification — interpretando o plano de trade

`tradeQualification` está presente em toda análise. Contém o plano de execução estruturado.

### Exemplo de resposta com setup acionável

```json
{
  "tradeBias": "short",
  "setupQuality": "low",
  "entryZone": {
    "lower": 67464.63,
    "upper": 68718.97
  },
  "stopPrice": 73422.49,
  "takeProfitTargets": [
    { "level": 1, "price": 63000.00, "rMultiple": 1.0 },
    { "level": 2, "price": 58000.00, "rMultiple": 2.0 }
  ],
  "riskRewardRatio": 2.1,
  "qualityReasons": ["bearish_breakdown_signal: +0.3", "volume_low: -0.1"],
  "rejectReasons": []
}
```

### Lógica de `setupQuality`

| Valor | Significado |
|-------|------------|
| `high` | Setup forte — todos os critérios alinhados |
| `medium` | Setup moderado — maioria dos critérios ok |
| `low` | Setup fraco — use apenas com confluência adicional |
| `rejected` | Sem setup acionável — `tradeBias` será `flat` |

### Fluxo recomendado para agente

```js
const { signal, tradeQualification: tq, confidence } = result;

if (signal === 'no_trade' || tq.setupQuality === 'rejected') {
  // Sem trade — aguardar próxima vela
  return;
}

if (tq.setupQuality === 'high' && confidence >= 0.65) {
  // Setup de alta qualidade — executar com tamanho normal
  console.log(`Entrada: ${tq.entryZone.lower} – ${tq.entryZone.upper}`);
  console.log(`Stop: ${tq.stopPrice}`);
  console.log(`TP1: ${tq.takeProfitTargets[0]?.price}`);
} else if (tq.setupQuality === 'medium' && confidence >= 0.55) {
  // Setup médio — executar com tamanho reduzido
} else {
  // Qualidade insuficiente — não operar
}
```

### Verificar motivos de rejeição

```js
if (tq.rejectReasons.length > 0) {
  console.log('Setup rejeitado por:', tq.rejectReasons.join(', '));
  // Ex: "regime_risk_off: -0.08", "rsi_overbought: -0.05", "volume_low: -0.1"
}
```

---

## 6. MTF Qualification — confirmação entre timeframes

Avalia se os timeframes mais altos confirmam ou conflitam com o sinal do timeframe base.

### Exemplo de resposta

```json
{
  "baseTf": "1h",
  "baseSignal": "pullback_watch",
  "overallAlignment": "confirming",
  "confidenceAdj": 0.06,
  "confirming": ["4h", "1d"],
  "conflicting": [],
  "neutral": [],
  "details": [
    { "tf": "4h", "alignment": "confirming", "adj": 0.04 },
    { "tf": "1d", "alignment": "confirming", "adj": 0.02 }
  ]
}
```

### Interpretação de `overallAlignment`

| Valor | Significado | Ação sugerida |
|-------|------------|--------------|
| `confirming` | TFs maiores alinham com o sinal | Operar com confiança aumentada |
| `conflicting` | TFs maiores contradizem o sinal | Reduzir tamanho ou aguardar |
| `neutral` | TFs maiores sem tendência clara | Operar apenas se sinal forte |

### Usar MTF qualification para filtrar entradas

```js
const mtf = result.mtfQualification;

if (mtf?.overallAlignment === 'conflicting') {
  console.log('MTF conflitante — setup ignorado');
  return;
}

if (mtf?.overallAlignment === 'confirming') {
  const adjustedConfidence = result.confidence + (mtf.confidenceAdj || 0);
  console.log(`Confiança ajustada por MTF: ${adjustedConfidence.toFixed(2)}`);
}
```

---

## 7. Market Regime — estado macro do mercado

Classifica o estado macro do mercado com base nos provedores disponíveis (CoinGlass + CoinGecko).

### Exemplo de resposta com provedores ativos

```json
{
  "regime": "risk_off",
  "btcStructure": "dominant",
  "fearGreedState": "extreme_fear",
  "altcoinConditions": "unfavorable",
  "available": true,
  "reasons": [
    "fear_greed_extreme_fear(18)",
    "btc_dominance_high(58.3%)",
    "breadth_risk_off(32% gainers)"
  ]
}
```

### Valores possíveis de `regime`

| Regime | Descrição |
|--------|-----------|
| `risk_on` | Mercado em modo de risco — altcoins performando, volume alto, greed |
| `risk_off` | Mercado defensivo — BTC dominante, fear, breadth negativa |
| `overheated` | Extreme greed sem sinais opostos — cautela com longs |
| `neutral` | Sinais mistos ou provedores indisponíveis |

### Filtrar trades pelo regime

```js
const { marketRegime, signal, tradeQualification: tq } = result;

if (marketRegime?.available) {
  if (marketRegime.regime === 'risk_off' && tq.tradeBias === 'long') {
    console.log('Regime risk_off — setup long penalizado (-0.08 no setupQuality)');
  }

  if (marketRegime.regime === 'risk_on' && tq.tradeBias === 'short') {
    console.log('Regime risk_on — setup short penalizado (-0.05 no setupQuality)');
  }

  if (marketRegime.fearGreedState === 'extreme_greed') {
    console.log('Mercado sobreaquecido — evitar longs em breakout');
  }
}
```

### Verificar dimensões individuais

```js
const r = result.marketRegime;

if (r?.btcStructure === 'dominant') {
  // BTC dominance > 55% — altcoins sob pressão
}
if (r?.altcoinConditions === 'favorable') {
  // Altcoin season ativo — altcoins em outperformance
}
```

---

## 8. Backtest via CLI

Replays histórico de candles com o pipeline completo. Requer fixture JSON com candles OHLCV.

### Execução básica

```bash
npm run backtest -- --fixture fixtures/BTCUSDT_1h.json
```

### Com parâmetros customizados

```bash
# Win target 2%, loss cutoff 1%, lookahead 20 barras
npm run backtest -- \
  --fixture fixtures/BTCUSDT_4h.json \
  --win 2.0 \
  --loss 1.0 \
  --lookahead 20
```

### Com filtro de confiança mínima

```bash
# Só analisar setups com confiança ≥ 0.60
npm run backtest -- \
  --fixture fixtures/BTCUSDT_1h.json \
  --min-confidence 0.60
```

### Saída em JSON (para consumo por agente)

```bash
npm run backtest -- \
  --fixture fixtures/BTCUSDT_1h.json \
  --format json > resultado_backtest.json
```

### Formato do fixture (estrutura mínima)

```json
{
  "symbol": "BTCUSDT",
  "symbolId": "BINANCE:BTCUSDT",
  "timeframe": "1h",
  "candles": [
    { "time": 1700000000, "open": 35000, "high": 35500, "low": 34800, "close": 35200, "volume": 1200 },
    { "time": 1700003600, "open": 35200, "high": 35800, "low": 35100, "close": 35600, "volume": 980 }
  ]
}
```

### Interpretando o relatório de backtest

```
Signal         Total  Win   Loss  Expired  WinRate  AvgMFE  AvgMAE
breakout_watch    12    7     3      2       58%     2.1%    0.8%
pullback_watch     8    5     2      1       63%     1.8%    0.6%
bearish_break…     5    3     1      1       60%     2.4%    0.9%

Setup Quality Breakdown:
  high:   8 trades — WinRate: 75%
  medium: 12 trades — WinRate: 58%
  low:    5 trades — WinRate: 40%
```

> **Leitura:** `setupQuality: high` historicamente tem win rate significativamente melhor.
> Use esse dado para calibrar o filtro mínimo de qualidade no agente.

---

## 9. Integração com agente AI (OpenClaw)

Use `openclawAnalyzeMarket` para uma interface normalizada com mapeamento de erros estruturado.

### Chamada básica

```js
const { openclawAnalyzeMarket } = require('./src/tools/openclawAnalyzeMarket');

const result = await openclawAnalyzeMarket({
  query: 'BTCUSDT.P',
  timeframe: '1h',
});

if (!result.ok) {
  // Erros mapeados estruturalmente — sem try/catch necessário
  console.error(result.error.code, result.error.message);
  // Códigos: symbol_not_found | ambiguous_symbol | candle_fetch_timeout |
  //          insufficient_candles | unsupported_timeframe | internal_error
  return;
}

const { signal, confidence, tradeQualification, marketRegime } = result.data;
```

### Exemplo de resposta `ok: true`

```json
{
  "ok": true,
  "toolVersion": "1.0.0",
  "data": {
    "symbol": "BTCUSDT.P",
    "timeframe": "1h",
    "signal": "pullback_watch",
    "confidence": 0.63,
    "trend": "bullish",
    "momentum": "slightly_bearish",
    "invalidation": "Fechar abaixo da EMA50",
    "targets": [{ "price": 72000, "label": "resistência anterior" }],
    "tradeQualification": { "setupQuality": "medium", "tradeBias": "long", "..." },
    "marketRegime": { "regime": "risk_on", "available": true }
  },
  "meta": { "durationMs": 3240, "correlationId": "..." }
}
```

### Exemplo de resposta `ok: false`

```json
{
  "ok": false,
  "error": {
    "code": "candle_fetch_timeout",
    "message": "Candle fetch timed out after 20000ms for BTCUSDT.P/1h"
  },
  "toolVersion": "1.0.0"
}
```

---

## 10. Padrões de uso para agentes autônomos

### Padrão 1 — Triagem rápida antes de análise profunda

```js
// 1. Checar saúde do servidor
const health = await fetch('http://localhost:3000/health').then(r => r.json());
if (health.status !== 'ok') return; // servidor indisponível

const providersOk = health.providers.coinglass.configured &&
                    health.providers.coingecko.configured;

// 2. Analisar timeframe de referência
const r = await analyzeMarket({ query: 'BTCUSDT.P', timeframe: '4h' });

if (r.signal === 'no_trade') return; // sem setup — encerrar cedo

// 3. Só se houver sinal, expandir para MTF completo
const mtf = await analyzeMarketMTF({
  query: 'BTCUSDT.P',
  timeframes: ['1h', '4h', '1d'],
});
```

### Padrão 2 — Filtro em cascata (qualidade → confiança → regime)

```js
const { signal, confidence, tradeQualification: tq, marketRegime: mr } = result;

const isActionable =
  signal !== 'no_trade' &&
  tq.setupQuality !== 'rejected' &&
  confidence >= 0.55 &&
  !(mr?.available && mr.regime === 'risk_off' && tq.tradeBias === 'long');

if (!isActionable) {
  console.log('Setup filtrado:', { signal, quality: tq.setupQuality, confidence, regime: mr?.regime });
  return;
}
```

### Padrão 3 — Alert TradingView → análise → entrega no Telegram

Configurar no TradingView (campo "Mensagem do alerta"):

```json
{
  "secret": "{{strategy.order.alert_message}}",
  "query": "{{ticker}}",
  "timeframe": "{{interval}}",
  "message": "{{strategy.order.comment}}"
}
```

URL do webhook no TradingView:
```
https://SEU_DOMINIO/webhook/tradingview
```

O agente então:
1. Recebe o alerta
2. Normaliza o payload
3. Checa deduplicação (10s TTL)
4. Roda `analyzeMarket` completo
5. Entrega no Telegram com resumo PT-BR + trade qualification

### Padrão 4 — Rotina de monitoramento periódico

```js
const WATCHLIST = [
  { query: 'BTCUSDT.P', timeframe: '4h' },
  { query: 'ETHUSDT.P', timeframe: '4h' },
  { query: 'SOLUSDT',   timeframe: '1h' },
];

async function scan() {
  for (const item of WATCHLIST) {
    const r = await analyzeMarket(item);

    if (r.signal !== 'no_trade' && r.tradeQualification?.setupQuality !== 'rejected') {
      console.log(`ALERTA: ${r.symbol} ${item.timeframe} — ${r.signal} (${r.confidence})`);
      console.log(`  Entrada: ${JSON.stringify(r.tradeQualification.entryZone)}`);
      console.log(`  Stop: ${r.tradeQualification.stopPrice}`);
      console.log(`  Regime: ${r.marketRegime?.regime}`);
    }
  }
}

// Rodar a cada 15 minutos
setInterval(scan, 15 * 60 * 1000);
```

### Padrão 5 — Decisão baseada em `confidenceBreakdown`

```js
const cb = result.confidenceBreakdown;

console.log('Base confidence:', cb.base);
console.log('Após qualidade de dados:', cb.afterQuality);
console.log('Ajuste CoinGlass:', cb.cgAdjustment);
console.log('Ajuste Bybit:', cb.bybitAdjustment);
console.log('Ajuste CoinGecko:', cb.cgkoAdjustment);
console.log('Final:', cb.final);
console.log('Regime:', cb.regime);

// Se confiança final veio só do baseline (sem provedores),
// o agente pode tratar com mais cautela
if (!cb.cgAvailable && !cb.bybitAvailable && !cb.cgkoAvailable) {
  console.log('Aviso: confiança sem sobreposição de contexto externo');
}
```

---

## Referência rápida de sinais

| Sinal | Direção | Quando ocorre |
|-------|---------|---------------|
| `breakout_watch` | Long | Preço rompeu resistência ou EMA relevante |
| `pullback_watch` | Long | Tendência altista com pullback para suporte |
| `bearish_breakdown_watch` | Short | Tendência baixista ou rompimento de suporte |
| `no_trade` | Flat | Sem setup acionável no momento |

## Referência de códigos de erro HTTP

| Código | Significado |
|--------|------------|
| `200` | Análise concluída com sucesso |
| `400` | Input inválido — symbol não encontrado, timeframe inválido |
| `401` | API key ausente ou inválida |
| `408` | Timeout ao buscar candles do TradingView |
| `409` | Alerta duplicado dentro do TTL de deduplicação |
| `422` | Símbolo encontrado mas candles insuficientes para análise |
| `429` | Rate limit atingido |
| `500` | Erro interno inesperado |
