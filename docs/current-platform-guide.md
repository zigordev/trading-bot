# Current Platform Guide

## Purpose

This document explains the current state of `trading-bot` as it exists today:

- what parts the application has
- which technologies each part uses
- how those parts work together
- what is still missing
- how to test what is supposed to work so far

Use this as the single current-state overview. For deeper slice-by-slice details, see:

- `docs/architecture-overview.md`
- `docs/market-data-architecture.md`
- `docs/research-backtesting-architecture.md`
- `docs/local-first-start.md`

## What Exists Today

The current platform has three application services plus local supporting infrastructure.

### 1. control-plane

Purpose:

- operator-facing configuration service
- source of truth for authored trading configuration

Technology:

- TypeScript
- Fastify
- PostgreSQL via `pg`
- KafkaJS for config-change publication
- Swagger / Swagger UI
- Prometheus metrics

Current responsibilities:

- CRUD for:
  - `pairs`
  - `timeframes`
  - `strategies`
  - `risk_profiles`
  - `trading_defaults`
  - `research_settings`
  - `analysis_settings`
- resolved runtime projection at `/v1/runtime-config/analysis-settings`
- direct config-change event publication into Redpanda

Local URL:

- `http://localhost:3020`

### 2. market-data

Purpose:

- exchange connectivity
- normalized live market-event fanout
- historical market-data persistence

Technology:

- Rust
- Axum
- Tokio
- Reqwest
- Tokio Tungstenite for Binance websocket streams
- `rdkafka` for Redpanda/Kafka
- ClickHouse for historian storage
- Prometheus metrics

Current responsibilities:

- fetch active runtime config from the control-plane
- subscribe to Binance public:
  - klines
  - aggregate trades
- publish normalized events to Redpanda
- persist:
  - `market_data_klines`
  - `market_data_trades`
- backfill and tail-gap repair for klines
- expose recent and replay-oriented historian reads

Local URL:

- `http://localhost:3030`

### 3. research-backtesting

Purpose:

- offline replay/backtesting on top of ClickHouse

Technology:

- Rust
- Axum
- Tokio
- Reqwest
- direct ClickHouse reads
- shared strategy logic reused from the strategy library crate
- Prometheus metrics

Current responsibilities:

- read active analysis config from the control-plane
- read named `research_settings` profiles from the control-plane
- derive timeframe-specific replay windows
- replay the same `emaCross` logic used live
- persist completed backtest runs in ClickHouse
- return:
  - offline signals
  - quote-aware simulated trades
  - basic PnL summary
  - `backtestId`, `finishedAt`, and `durationMs`

Local URL:

- `http://localhost:3050`

## Supporting Infrastructure

The app-local stack also includes:

- PostgreSQL
  - local transactional store for the control-plane
- ClickHouse
- Alloy
  - local log shipping sidecar

The shared infrastructure comes from `platform-ops`:

- OpenBao
  - secrets
- Redpanda
  - durable event fanout
- Prometheus / Grafana / Loki / Jaeger
  - observability

## How The Parts Work Together

### Configuration flow

1. Operators create or update config in `control-plane`.
2. `control-plane` commits the change in PostgreSQL.
3. Immediately after commit, it publishes a config-change event to Redpanda.
4. `market-data` consumes those config-change events and refreshes its runtime view.

### Live market-data flow

1. `market-data` fetches active resolved `analysis_settings` from `control-plane`.
2. It derives one active subscription set per pair and timeframe.
3. It connects to Binance public websocket streams.
4. It normalizes incoming events.
5. It stores historical data in ClickHouse.
6. It publishes normalized events to Redpanda.

### Offline backtesting flow

1. A caller sends a backtest request to `research-backtesting`.
2. `research-backtesting` reads:
   - the target `analysis_setting`
   - the selected `research_settings` profile
3. It computes the replay window for that timeframe.
5. It warms the shared `emaCross` evaluator with pre-window candles.
6. It replays the historical closed klines through the same evaluator used live.
   configured risk profile and trading defaults.
8. It persists the completed run in ClickHouse.
9. It returns the persisted run payload with signals, simulated trades, and summary PnL.

## Historical Data And Backtesting Window Rules

`research_settings` stores timeframe-specific durations keyed by timeframe code, for example:

- `1m`
- `3m`
- `5m`

Those values are millisecond durations. That matches the useful part of the legacy behavior.

For the currently implemented backtests, required historian retention is:

`configured_window_ms + warmup_ms + aggregate_trade_coverage_for_requested_window`

Where:

- `configured_window_ms` comes from `research_settings`
- `warmup_ms = slowPeriod * BACKTEST_WARMUP_MULTIPLIER * periodMs`
- replay safety caps come from:
  - `BACKTEST_MAX_KLINES`
  - `BACKTEST_MAX_TRADES`

Default warmup behavior:

- `BACKTEST_WARMUP_MULTIPLIER=5`

Examples:

- `1m`, `slowPeriod=21`
  - warmup = `105 minutes`
- `3m`, `slowPeriod=21`
  - warmup = `315 minutes`
- `5m`, `slowPeriod=21`
  - warmup = `525 minutes`

For quote-aware accuracy, a longer window is only useful if ClickHouse also has aggregate trades
run becomes broader, but not more precise.

### Was the legacy timeframe-specific approach correct?

Yes, mostly.

What legacy got right:

- windows were timeframe-specific
- durations were effectively in milliseconds
- different timeframes naturally needed different amounts of historical data

What legacy also did beyond that:

- it used lower-granularity `S1` data to resolve stop-loss / take-profit hits after signals

The current implementation replaces that legacy approximation with best bid/ask replay plus
aggregate-trade fallback for the requested replay window.

So the correct interpretation is:

- current replay needs timeframe klines plus warmup for indicator state
- future full order-book-aware replay may still need lower-level market data beyond best bid/ask
  and aggregate trades

## How This Differs From The Legacy Application

The legacy application and the current platform solve related problems, but they do not do it in
the same way.

### High-level architecture difference

Legacy:

- one NestJS monorepo with many smaller services
- `pair`
- `timeframe`
- `general-settings`
- `analysis-settings`
- `historical-data`
- `backtesting`
- `strategy`
- `notification`
- Scylla used heavily across the system

Current:

- one smaller platform with clearer service boundaries
- `control-plane`
- `market-data`
- `research-backtesting`
- PostgreSQL for authored/transactional state
- ClickHouse for historical market data
- Rust for the runtime and research services

So the current platform is more consolidated and more explicit about the hot path. It is designed
around a small number of services instead of many CRUD-style microservices.

### Configuration difference

Legacy configuration was spread across separate services and one large `general-settings` object.

Current configuration is more normalized:

- `pairs`
- `timeframes`
- `strategies`
- `risk_profiles`
- `trading_defaults`
- `research_settings`
- `analysis_settings`

Important differences:

- legacy `general-settings` was one mixed bucket
- current splits that into:
  - `trading_defaults`
  - `research_settings`
  - OpenBao-managed secrets
- legacy `analysis-settings` embedded risk-style config more directly
- current `analysis_settings` references reusable `risk_profiles` and `trading_defaults`

So the current model is more relational and operator-friendly, and less dependent on one global
settings row.

### Historical-data difference

Legacy historical-data behavior:

- fetched Binance klines in parallel
- used Bottleneck with `maxConcurrent: 20`
- stored candles in Scylla
- managed missing-range repair itself
- also maintained lower-granularity `S1` history for some downstream workflows

Current historical-data behavior:

- `market-data` owns exchange ingestion
- uses Binance public websockets for live flow
- stores history in ClickHouse
- persists:
  - klines
  - aggregate trades
- exposes recent and replay-oriented HTTP reads


- current backfill is snapshot-only (`/api/v3/depth?limit=5`, using `lastUpdateId`) and does **not** reconstruct arbitrary
  and catches up quickly after gaps.

So the current version is more explicit about a dedicated historian and replay contract. It also
uses ClickHouse instead of Scylla because the target is stronger analytical and replay support.

### Strategy difference

Legacy strategy behavior:

- strategy logic and service boundaries were more tightly coupled to the old microservice layout
- startup and async orchestration were less strict
- the hot path had more boundary friction

Current strategy behavior:

- current supported strategy kinds are `emaCross`, `strategy1`, and `strategy2`
- the shared strategy library only exposes the evaluator logic used by offline replay

So the current platform is narrower but cleaner. It does less today, but the part it does is more
deliberately separated from config authoring and historical storage.

### Backtesting difference

Legacy backtesting:

- ran as its own service
- used timeframe-specific timeranges from `general-settings`
- prepared operating-timeframe and longer-timeframe data
- generated order-level results
- used lower-granularity `S1` data to resolve target/stop outcomes
- produced favorable-timeslot and optimization-style outputs

Current backtesting:

- runs in `research-backtesting`
- uses timeframe-specific timeranges from `research_settings`
- reuses the same `emaCross` evaluator used live
- uses best bid/ask quotes first, with aggregate-trade fallback, to resolve entries, stop-loss
  exits, take-profit exits, reversals, and optional window-end exits
- supports configurable fee and slippage assumptions
- still does not model partial fills or order-book-aware execution quality

This is the most important functional difference today:

- legacy backtesting used lower-granularity `S1` candles for execution resolution
- current backtesting uses best bid/ask quotes with aggregate-trade fallback, which is cleaner than
  the old `S1` shortcut for the retained replay window
- current backtesting still stops short of partial-fill and order-book simulation

### What The Current Platform Does Better

- clearer separation between config, live market ingestion, strategy evaluation, and offline replay
- shared strategy logic between live evaluation and replay
- stronger historian choice for analytical/replay workloads
- explicit runtime-config projection instead of reconstructing config in each service
- fewer service boundaries in the trading path

### What Legacy Still Had That Is Not Yet Rebuilt

- a richer end-to-end order simulation model
- more complete downstream workflows around optimization and research outputs
- notification and some broader operational features

So the accurate summary is:

- the current platform is architecturally cleaner and better aligned with the target design
- the legacy platform was functionally broader in some research and order-resolution areas
- the current implementation has not yet rebuilt every legacy capability, especially around
  live execution and deeper order-book-aware backtesting

## What Is Working Right Now

These parts should work today:

- `control-plane` health, docs, CRUD, runtime projection, and config-change events
- `market-data` health, Binance public ingestion, ClickHouse persistence, recent reads, replay reads
- `research-backtesting` health, ClickHouse kline/trade replay, `research_settings`-driven
  backtests, quote-aware stop-loss / take-profit / reversal simulation

These parts are intentionally not complete yet:

- real order execution
- exchange private/account API usage
- portfolio and position state
- partial-fill and order-book-aware backtesting
- optimization workflows
- additional strategy kinds beyond `emaCross`, `strategy1`, and `strategy2`

## What Is Still Missing

Main missing platform slices:

- `execution`
  - risk checks
  - order submission
  - reconciliation
  - position/order state

Main missing research depth:

- partial-fill execution backtesting
- order-book-aware replay for deeper execution realism
- optimization job orchestration
- richer analytics on top of historian data

Main missing strategy breadth:

- strategy kinds beyond `emaCross`

Main remaining engineering gaps:

- broader OpenTelemetry instrumentation
- stronger deduplication guarantees across reconnects
- more consumer-specific projections where needed

## How To Test What Should Work So Far

### 1. Start the stack

From the repo root:

```bash
npm run local:up
```

### 2. Check health

```bash
curl -fsS http://localhost:3020/health/readiness | jq
curl -fsS http://localhost:3030/health/readiness | jq
curl -fsS http://localhost:3050/health/readiness | jq
```

Expected:

- all three services return status `ok`

### 3. Seed a minimal runnable config set

Set the base URL:

```bash
BASE_URL=http://localhost:3020
```

Create a symbol:

```bash
curl -fsS -X POST "$BASE_URL/v1/symbols" \
  -H 'content-type: application/json' \
  -d '{
    "code": "BTCUSDT",
    "active": true,
    "baseAsset": "BTC",
    "destinationAsset": "USDT",
    "originAssetNeededFunds": 1000,
    "destinationAssetNeededFunds": 1000
  }' | jq
```

Create a timeframe:

```bash
curl -fsS -X POST "$BASE_URL/v1/timeframes" \
  -H 'content-type: application/json' \
  -d '{
    "code": "1m",
    "longerTimeframeCode": "5m",
    "longerTimeframeMultiplier": 5,
    "periodMs": 60000,
    "active": true
  }' | jq
```

Create a strategy:

```bash
curl -fsS -X POST "$BASE_URL/v1/strategies" \
  -H 'content-type: application/json' \
  -d '{
    "name": "emaCross",
    "description": "EMA cross test strategy",
    "activated": true,
    "parameters": {
      "kind": "emaCross",
      "fastPeriod": 9,
      "slowPeriod": 21
    }
  }' | jq
```

Create a risk profile:

```bash
curl -fsS -X POST "$BASE_URL/v1/risk-profiles" \
  -H 'content-type: application/json' \
  -d '{
    "name": "default",
    "description": "Default risk profile",
    "maximumStopLoss": 3,
    "minimumStopLoss": 1,
    "swingGap": 1,
    "rrr": 2,
    "enabled": true
  }' | jq
```

Create trading defaults:

```bash
curl -fsS -X POST "$BASE_URL/v1/trading-defaults" \
  -H 'content-type: application/json' \
  -d '{
    "name": "default",
    "description": "Default trading profile",
    "defaultPositionNotionalUsd": 100,
    "enabled": true
  }' | jq
```

Create an analysis setting:

```bash
curl -fsS -X POST "$BASE_URL/v1/analysis-settings" \
  -H 'content-type: application/json' \
  -d '{
    "pairCode": "BTCUSDT",
    "timeframeCode": "1m",
    "strategyName": "emaCross",
    "riskProfileName": "default",
    "tradingDefaultsName": "default",
    "technicalAnalysisSettings": {
      "fastPeriod": 9,
      "slowPeriod": 21
    },
    "enabled": true
  }' | jq
```

### 4. Validate the control-plane

```bash
curl -fsS http://localhost:3020/v1/runtime-config/analysis-settings | jq
```

Expected:

- one resolved active analysis-setting record

### 5. Validate market-data

Check subscriptions and status:

```bash
curl -fsS http://localhost:3030/v1/subscriptions | jq
curl -fsS http://localhost:3030/v1/status | jq
```

Check stored data:

```bash
curl -fsS "http://localhost:3030/v1/klines/BTCUSDT/1m?limit=5" | jq
curl -fsS "http://localhost:3030/v1/trades/BTCUSDT?limit=5" | jq
```

Check replay reads:

```bash
curl -fsS "http://localhost:3030/v1/replay/klines/BTCUSDT/1m?limit=5" | jq
curl -fsS "http://localhost:3030/v1/replay/trades/BTCUSDT?limit=5" | jq
```

Expected:

- subscriptions are non-empty
- status shows a live stream and healthy historian
- the recent and replay endpoints return data

Optional direct ClickHouse check:

```bash
docker compose --env-file docker/.env.app.local -f docker/compose.app.local.yml exec -T historical-store \
  clickhouse-client --query "
    SELECT
      pair_code,
      timeframe_code,
      countDistinct(open_time) AS candles
    FROM trading_bot_market_data.market_data_klines
    WHERE pair_code = 'BTCUSDT'
      AND timeframe_code = '1m'
    GROUP BY pair_code, timeframe_code
  "
```

### 6. Validate research-backtesting

Get one analysis-setting id:

```bash
ANALYSIS_SETTING_ID="$(curl -fsS http://localhost:3020/v1/runtime-config/analysis-settings | jq -r '.[0].id')"
```

For a fresh local historian, prefer an explicit recent window:

```bash
END_TIME_MS="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
START_TIME_MS="$((END_TIME_MS - 3 * 60 * 60 * 1000))"

curl -fsS -X POST http://localhost:3050/v1/backtests \
  -H 'content-type: application/json' \
  -d "{
    \"analysisSettingId\": \"${ANALYSIS_SETTING_ID}\",
    \"researchSettingsName\": \"default\",
    \"windowKind\": \"backtesting\",
    \"startTime\": ${START_TIME_MS},
    \"endTime\": ${END_TIME_MS}
  }" | jq
```

Expected:

- `backtestId` is present
- `finishedAt` is present
- `durationMs` is present
- `dataset.replayKlineCount` is non-zero
- `dataset.replayTradeCount` is non-zero
- `signals` contains offline EMA crossover events if the window has enough movement
- `trades` contains simulated entries/exits resolved from best bid/ask quotes with aggregate-trade fallback
- `summary.totalPnlUsd` is present

Optional persisted-result checks:

```bash
BACKTEST_ID="$(curl -fsS -X POST http://localhost:3050/v1/backtests \
  -H 'content-type: application/json' \
  -d "{
    \"analysisSettingId\": \"${ANALYSIS_SETTING_ID}\",
    \"researchSettingsName\": \"default\",
    \"windowKind\": \"backtesting\",
    \"startTime\": ${START_TIME_MS},
    \"endTime\": ${END_TIME_MS}
  }" | jq -r '.backtestId')"

curl -fsS "http://localhost:3050/v1/backtests?limit=5" | jq
curl -fsS "http://localhost:3050/v1/backtests/${BACKTEST_ID}" | jq
```

Important note:

- if you omit `startTime` and `endTime`, the service uses the legacy-style default window ending at the previous midnight UTC
- that is correct behavior, but it can fail on a brand-new local historian if you have not stored enough data yet

## Recommended Reading Order

If you want to understand the system from high level to detail:

1. `docs/current-platform-guide.md`
2. `docs/architecture-overview.md`
3. `docs/local-first-start.md`
4. `docs/market-data-architecture.md`
5. `docs/research-backtesting-architecture.md`
