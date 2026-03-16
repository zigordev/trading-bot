# Architecture Overview

## Target service boundaries

The target architecture is intentionally small. This is not a CRUD microservice system.

- `control-plane`
  - admin API
  - configuration management
  - strategy and risk settings
- `market-data`
  - exchange connectivity
  - normalized market events
  - ClickHouse historian persistence and recovery
- `strategy-engine`
  - in-memory technical analysis
  - signal generation
- `research/backtesting`
  - ClickHouse replay
  - offline strategy evaluation
  - research-window driven backtests
- `execution`
  - risk checks
  - order state machine
  - exchange order submission
  - reconciliation

## Critical path

The critical trading path should stay direct:

1. market event arrives
2. strategy state updates in memory
3. signal is generated
4. risk checks run
5. order is sent to the exchange

The durable broker is not part of that path.

## Redpanda usage

`platform-ops` already provides Redpanda. It should be used for durable asynchronous flows:

- configuration change events
- order audit events
- fills and lifecycle fanout
- notifications
- replay and backtesting inputs
- background processing triggers

It should not sit between signal generation and order submission.

The current control-plane already uses Redpanda for configuration fanout through direct Kafka
publication after PostgreSQL commits. That means:

- PostgreSQL remains the system of record for authored configuration
- every successful config mutation is published directly to the config-change topic after commit
- the services provision the Kafka topics they own during startup, so a fresh local stack does not
  require manual topic bootstrap
- delivery is at-least-once, so consumers should treat `eventId` as the deduplication key

## Shared platform dependencies

This repository is designed to integrate with `platform-ops` for:

- OpenBao secrets
- Redpanda
- OpenTelemetry ingestion
- Prometheus, Grafana, Loki, and Jaeger
- shared Docker network `platform_ops_shared`
- future AWS deployment wiring

## App-specific infrastructure

This repository owns only what is application-specific:

- operational database
- control-plane container
- market-data container
- alloy sidecar for local log shipping
- app-specific bootstrap scripts
- repo-local documentation

## Current implemented slice

The repository currently implements the first control-plane slice plus the first runtime path
through market-data, strategy-engine, and research-backtesting:

- `control-plane`
  - liveness endpoint
  - readiness endpoint with PostgreSQL check
  - Prometheus-style metrics endpoint
  - OpenAPI docs
  - persisted CRUD for `pairs`
  - persisted CRUD for `timeframes`
    - includes canonical `periodMs` metadata derived from the old `timeframePeriods` concept
  - persisted CRUD for `strategies`
  - persisted CRUD for `risk_profiles`
  - persisted CRUD for `trading_defaults`
  - persisted CRUD for `research_settings`
  - persisted CRUD for `analysis_settings`
  - direct config-change event publication for all configuration resources
  - resolved runtime projection for active `analysis_settings`
- `market-data`
  - liveness endpoint
  - readiness endpoint
  - Prometheus-style metrics endpoint
  - startup runtime-config fetch from the control-plane
  - config-change driven subscription refresh
  - periodic runtime-config reconciliation
  - startup Kafka topic provisioning for consumed and published contracts
  - Binance combined websocket kline, aggregate-trade, and book-ticker stream consumption
  - normalized kline, aggregate-trade, and book-ticker fanout into Redpanda
  - persisted kline, aggregate-trade, and book-ticker storage in ClickHouse
  - replay-oriented historian query endpoints
  - startup backfill and tail-gap repair for active kline subscriptions
  - inspection endpoints for active subscriptions, runtime status, and recent stored historian rows
- `strategy-engine`
  - liveness endpoint
  - readiness endpoint
  - Prometheus-style metrics endpoint
  - startup runtime-config fetch from the control-plane
  - config-change driven analysis refresh
  - startup Kafka topic provisioning for consumed and published contracts
  - periodic runtime-config reconciliation
  - recent-kline warmup from market-data
  - in-memory `emaCross` strategy evaluation on live closed klines
  - normalized signal fanout into Redpanda
  - inspection endpoints for active analyses and runtime status
- `research/backtesting`
  - liveness endpoint
  - readiness endpoint
- Prometheus-style metrics endpoint
- on-demand backtest execution endpoint
 - direct ClickHouse kline, aggregate-trade, and book-ticker replay reads
- on-demand `research_settings` lookup from the control-plane
- legacy-compatible timeframe-specific replay-window derivation
- shared `emaCross` strategy logic reused offline from `strategy-engine`
 - quote-aware stop-loss, take-profit, reversal, fee, and slippage simulation with aggregate-trade fallback
- local PostgreSQL
- local Alloy sidecar

Pending:

- additional consumer-facing configuration projections
- order execution
- optimization workflows

## Analysis-settings slice

`analysis-settings` is the first control-plane resource that turns standalone reference data
into an executable configuration graph.

This slice is intentionally implemented inside the `control-plane`, not as a separate
microservice. The control-plane owns operator-managed configuration, and `analysis-settings`
is fundamentally a binding record that says:

- which `pair` a strategy applies to
- on which `timeframe`
- using which `strategy`
- with which `risk_profile`
- with which `trading_defaults` profile
- and with which strategy-specific technical-analysis parameters

The new model does not copy the legacy shape verbatim. Instead of embedding raw
`riskSettings` inside every row, it references a reusable `risk_profile`. That keeps risk
configuration normalized and lets one profile be reused across multiple
pair/timeframe/strategy bindings.

The current implementation stores `analysis_settings` as relational configuration using the
unique business keys that operators already manage:

- `pairCode` references `pairs.code`
- `timeframeCode` references `timeframes.code`
- `strategyName` references `strategies.name`
- `riskProfileName` references `risk_profiles.name`
- `tradingDefaultsName` references `trading_defaults.name`

This keeps the API human-readable while still enforcing referential integrity in PostgreSQL.
Updates to those referenced business keys cascade into `analysis_settings`, so the control-plane
remains the source of truth for configuration names and codes.

The binding is unique on `pairCode + timeframeCode + strategyName`. That means the current
architecture allows one active analysis configuration per trading context and strategy. Changing
the risk profile or technical-analysis parameters updates that binding rather than creating a
parallel duplicate.

`analysis-settings` is still a control-plane concern only. It does not execute analysis itself.
The current implementation now exposes one resolved runtime projection for active and operable
bindings at `/v1/runtime-config/analysis-settings`. That read model joins:

- the `analysis_settings` binding
- the referenced `pair`
- the referenced `timeframe`
- the referenced `strategy`
- the referenced `risk_profile`
- the referenced `trading_defaults`

This gives runtime services such as `market-data`, `strategy-engine`, and future
`research/backtesting` flows one materialized payload shape to consume without moving
configuration authoring out of the control-plane. Additional projections are still pending, but
config fanout is already implemented and multiple runtime consumers now use this projection
directly.

Detailed design notes for this slice live in `docs/analysis-settings-architecture.md`.

## Market-data slice

`market-data` is the first runtime service that consumes the control-plane contract.

Its responsibilities are intentionally narrow:

- fetch the resolved `analysis-settings` projection from the control-plane
- derive one live kline subscription per unique `pairCode + timeframeCode`
- derive one live trade and book-ticker subscription per active `pairCode`
- keep that subscription set fresh through config-change events plus periodic reconciliation
- connect to Binance combined websocket streams for the active subscription set
- normalize incoming market payloads into internal event contracts
- publish those normalized events to Redpanda for future consumers
- persist klines, aggregate trades, and book tickers in the ClickHouse historical store
- expose replay-oriented historian reads for klines, trades, and book tickers
- repair missing tail candles on startup and refresh through bounded REST backfill

The service does not own authored configuration, does not store secrets in PostgreSQL, and does
not execute strategy logic. It is the exchange-connectivity edge that converts runtime
configuration into a live event feed plus a dedicated historical store. The implemented
`research/backtesting` slice now consumes the same ClickHouse historian for offline replay.

Detailed design notes for this slice live in `docs/market-data-architecture.md`.

## Strategy-engine slice

`strategy-engine` is the first service that turns normalized market events into trading intent.

Its responsibilities are intentionally narrow:

- fetch the resolved `analysis-settings` projection from the control-plane
- warm per-analysis state from recent stored klines served by `market-data`
- consume live closed kline events from Redpanda
- evaluate supported strategies in memory
- publish normalized signal events for future execution consumers

The current implementation supports one concrete strategy kind: `emaCross`.

That support is deliberately explicit rather than pretending every arbitrary strategy record is
executable. A strategy becomes runnable when:

- the resolved analysis binding is active and operable
- the referenced strategy is activated
- the strategy kind resolves to `emaCross`
  - either from `strategies.parameters.kind`
  - or, as a fallback, from the normalized strategy name
- `fastPeriod` and `slowPeriod` are valid
  - from `technicalAnalysisSettings`
  - or from `strategies.parameters`

On each live closed kline, the service updates the in-memory EMA state for matching
`analysis_settings` bindings. It emits a signal only on actual crossover:

- `long` when fast EMA crosses above slow EMA
- `short` when fast EMA crosses below slow EMA

The current `research/backtesting` slice reuses this same evaluator logic offline rather than
reimplementing EMA behavior in a separate code path.

Detailed design notes for this slice live in `docs/strategy-engine-architecture.md`.

## Research/backtesting slice

`research/backtesting` is now the first offline consumer built on top of the ClickHouse
historian.

Its current responsibilities are intentionally narrow:

- fetch the resolved `analysis-settings` projection from the control-plane on demand
- fetch named `research_settings` profiles from the control-plane on demand
- derive a replay window from the timeframe-specific research window in milliseconds
- read historical klines directly from ClickHouse for that pair/timeframe window
- read historical aggregate trades and book tickers directly from ClickHouse for fill resolution
  inside that window
- warm the shared evaluator with extra candles before the requested replay window
- replay historical closed klines through the same `emaCross` strategy logic used live
- simulate entries, stop-loss exits, take-profit exits, reversals, and optional window-end exits
  from best bid/ask quotes with aggregate-trade fallback
- apply configurable fee and slippage assumptions to the simulated fills
- persist completed backtest runs in ClickHouse for later retrieval

This is not yet a full live execution replacement. It does not currently model:

- partial fills
- level-2 order-book-aware execution
- live order submission or reconciliation

That distinction matters for historian retention:

- for the currently implemented quote-aware backtests, you need the configured timeframe-specific
  window, indicator warmup candles, aggregate trades, and book tickers covering the replay window
- if you later want full order-book-aware or partial-fill simulation, you will also need
  lower-level market data such as order-book state for the same period

Detailed design notes for this slice live in `docs/research-backtesting-architecture.md`.

## General-settings decomposition

Legacy `general-settings` mixed unrelated concerns into one record:

- exchange API credentials
- default position sizing
- backtesting timeranges
- optimization windows
- timeframe-related lookup data

The new architecture does not recreate that bag as one resource.

Instead:

- exchange credentials stay in OpenBao and are resolved from static app config
  - they are not modeled as control-plane records while there is only one exchange/provider
- default position sizing becomes `trading_defaults`
  - the legacy field `defaultPositionPriceUsd` is renamed to
    `defaultPositionNotionalUsd` because it is a position-size/notional concept,
    not a market price
- backtesting and optimization settings become reusable `research_settings` profiles
  - they are authored in the control-plane now and are already consumed by the first
    `research/backtesting` flow
- timeframe-related period metadata moves into `timeframes.periodMs`
  - this absorbs the old `timeframePeriods` lookup into the resource that actually owns the
    timeframe identity

Detailed design notes for this decomposition live in `docs/general-settings-architecture.md`
and `docs/research-settings-architecture.md`.

Detailed design notes for config fanout live in `docs/config-change-events-architecture.md`.
