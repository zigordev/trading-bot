# Strategy-engine Architecture

## Purpose

`strategy-engine` is the first service that converts normalized market data into actual trading
intent.

It sits after `market-data` and before future `execution`.

## Responsibilities

Current responsibilities:

- fetch the resolved runtime projection from `/v1/runtime-config/analysis-settings`
- keep the active analysis set fresh through config-change events plus periodic reconciliation
- warm per-analysis state from recent stored candles exposed by `market-data`
- consume live closed kline events from Redpanda
- evaluate supported strategies in memory
- publish normalized signal events into Redpanda
- expose health, readiness, metrics, runtime status, and active-analysis inspection endpoints

Explicit non-responsibilities:

- storing secrets in PostgreSQL
- owning authored configuration
- subscribing to exchange APIs directly
- placing orders
- portfolio accounting
- execution simulation as a network service

## Why It Uses The Resolved Projection

Like `market-data`, the strategy-engine should not reconstruct the configuration graph itself.

It consumes the control-plane projection so it gets one already-resolved payload containing:

- pair
- timeframe
- strategy
- risk profile
- trading defaults
- technical analysis settings

That keeps authoring concerns inside the control-plane while runtime services consume a stable,
materialized contract.
It also provisions the Kafka topics it consumes and publishes during startup, so readiness does
not depend on prior market-data traffic.

## Current Strategy Contract

The first supported strategy kind is `emaCross`.

The kind resolves in this order:

1. `strategies.parameters.kind`
2. normalized `strategyName`

The engine currently treats only `emaCross` as executable. Other strategy kinds are ignored on
refresh and counted as unsupported in status/metrics.

For `emaCross`, period parameters resolve in this order:

1. `analysisSettings.technicalAnalysisSettings.fastPeriod` / `slowPeriod`
2. `strategies.parameters.fastPeriod` / `slowPeriod`
3. defaults `9` / `21`

Validation rules:

- both periods must be positive integers
- `slowPeriod` must be strictly greater than `fastPeriod`

## State Model

The engine keeps one in-memory evaluator per active supported `analysis_settings` row.

Each evaluator stores:

- strategy identity
- pair and timeframe binding
- risk profile and trading defaults snapshot
- rolling close-price window
- last fast EMA
- last slow EMA
- last processed candle close time

The state is intentionally ephemeral. On restart, the engine rebuilds it from recent stored
klines served by `market-data`.

## Warmup Model

Before consuming live signals, the engine warms each evaluator from:

- `market-data` HTTP endpoint `/v1/klines/{pairCode}/{timeframeCode}`

That endpoint reads from the ClickHouse-backed `market_data_klines` historical store populated by the
market-data service.

Warmup goals:

- avoid cold-start strategy blindness
- avoid replaying the full broker topic to rebuild state
- keep the strategy-engine decoupled from market-data storage internals

Warmup is bounded by `STRATEGY_WARMUP_HISTORY_LIMIT`.

The same evaluator code is also reused offline by the `research/backtesting` crate. That keeps
the live and replay paths aligned at the strategy-logic level instead of maintaining two
independent EMA implementations.

## Live Evaluation Model

The engine consumes:

- `trading-bot.market-data.klines.v1`
- `trading-bot.control-plane.config-changes.v1`

It evaluates only:

- live events
- closed candles

Backfill candles are used by `market-data` to repair storage, but they do not trigger signal
publication inside `strategy-engine`.

Signal emission rule:

- emit `long` when fast EMA crosses from `<= slow` to `> slow`
- emit `short` when fast EMA crosses from `>= slow` to `< slow`

No signal is emitted when there is no crossover.

## Signal Contract

Current topic:

- `trading-bot.strategy-engine.signals.v1`

The strategy-engine ensures this topic exists on startup together with the configured
`CONFIG_CHANGE_EVENTS_TOPIC` and `MARKET_DATA_KLINES_TOPIC`.

Current event shape includes:

- `eventId`
- `eventType`
- `source`
- `occurredAt`
- `exchange`
- `analysisSettingId`
- `pairCode`
- `timeframeCode`
- `strategyName`
- `strategyKind`
- `signalKind`
- `signalDirection`
- `closeTime`
- `closePrice`
- `klineEventId`
- `fastEma`
- `slowEma`
- `riskProfileName`
- `riskProfile`
- `tradingDefaultsName`
- `tradingDefaults`
- `technicalAnalysisSettings`

This is intentionally rich enough that a future execution service can consume a signal without
re-querying the control-plane on every message.

## Performance Notes

This slice follows the architecture goal of keeping the critical path direct:

- market event arrives
- strategy state updates in memory
- signal is generated

The durable broker remains outside the inner technical-analysis loop. Kafka is used for fanout
into the next stage, not as an in-loop state store.

Relative to the legacy system, this should be better for live evaluation latency because:

- state is maintained per analysis binding in memory
- evaluation happens on already-normalized market-data events
- recent warmup avoids replaying a large historical stream on every restart

## Remaining Gaps

Still pending:

- additional strategy kinds
- order-intent enrichment beyond signal generation
- execution consumer
- portfolio and position state
- stronger signal audit/history storage if required
