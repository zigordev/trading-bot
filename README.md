# trading-bot

Fresh repository for the new trading bot implementation.

Legacy code was moved to `../trading-bot-legacy/`.

## Current scope

This repository currently contains the first migration slice:

- target repository structure
- local infrastructure bootstrap for app-specific services
- runnable control-plane API
- runnable Rust `market-data` service
- runnable Rust `strategy-engine` service
- PostgreSQL-backed CRUD for pairs, timeframes, strategies, risk profiles, trading defaults, and analysis settings
- direct config-change event publication into Redpanda
- automatic Kafka topic provisioning for the control-plane, market-data, and strategy-engine contracts
- a resolved runtime-config projection for active analysis settings
- Binance combined kline, aggregate-trade, and book-ticker stream consumption driven by that runtime projection
- ClickHouse-backed historical kline, aggregate-trade, and book-ticker storage plus startup backfill and tail-gap repair for klines
- historian inspection and replay-oriented query endpoints in `market-data`
- in-memory `emaCross` strategy evaluation on live closed klines
- runnable Rust `research-backtesting` service
- direct ClickHouse kline and aggregate-trade replay for offline backtests
- offline `emaCross` replay using the same strategy logic used by the live strategy-engine
- env-driven timeframe-specific backtest windows
- trade-tape-aware stop-loss, take-profit, reversal, fee, and slippage simulation in offline backtests
- persisted ClickHouse-backed backtest run storage plus list/get retrieval
- normalized signal publication into Redpanda
- normalized market-data event publication into Redpanda on dedicated topics
- local-first documentation that assumes `platform-ops` is the shared base

No live order execution has been added yet.

## Planned structure

- `apps/control-plane/`
- `contracts/proto/`
- `crates/market-data/`
- `crates/research-backtesting/`
- `crates/strategy-engine/`
- `crates/execution/`
- `docs/`
- `docker/`
- `scripts/`

## Docs

- `docs/current-platform-guide.md`
- `docs/remaining-implementation-work.md`
- `docs/architecture-overview.md`
- `docs/analysis-settings-architecture.md`
- `docs/config-change-events-architecture.md`
- `docs/general-settings-architecture.md`
- `docs/market-data-architecture.md`
- `docs/backtest-replay-precision-guide.md`
- `docs/research-backtesting-architecture.md`
- `docs/research-settings-architecture.md`
- `docs/local-first-start.md`
- `docs/strategy-engine-architecture.md`

## Current local service surface

`control-plane` on `http://localhost:3020`:

- `/docs`
- `/health/liveness`
- `/health/readiness`
- `/metrics`
- `/v1/info`
- `/v1/pairs`
- `/v1/timeframes`
- `/v1/strategies`
- `/v1/risk-profiles`
- `/v1/trading-defaults`
- `/v1/analysis-settings`
- `/v1/runtime-config/analysis-settings`

`market-data` on `http://localhost:3030`:

- `/health/liveness`
- `/health/readiness`
- `/metrics`
- `/v1/info`
- `/v1/subscriptions`
- `/v1/status`
- `/v1/klines/:pair_code/:timeframe_code`
- `/v1/trades/:pair_code`
- `/v1/book-tickers/:pair_code`
- `/v1/replay/klines/:pair_code/:timeframe_code`
- `/v1/replay/trades/:pair_code`
- `/v1/replay/book-tickers/:pair_code`

`strategy-engine` on `http://localhost:3040`:

- `/health/liveness`
- `/health/readiness`
- `/metrics`
- `/v1/info`
- `/v1/status`
- `/v1/analyses`

`research-backtesting` on `http://localhost:3050`:

- `/health/liveness`
- `/health/readiness`
- `/metrics`
- `/v1/info`
- `/v1/status`
- `/v1/backtests`
- `/v1/backtests/:backtest_id`

## Local commands

```bash
npm test
npm run build
npm run local:up
npm run local:down
npm run local:reset
```

`npm test` runs the control-plane Node test suite plus the Rust `market-data`,
`research-backtesting`, and `strategy-engine` tests.
`npm run build` builds the control-plane plus the Rust `market-data`,
`research-backtesting`, and `strategy-engine` crates.

These commands only start and stop the app-specific local infrastructure.
Shared dependencies such as OpenBao, Redpanda, and observability come from `platform-ops`.
The app-local services create the Kafka topics they need on startup, so no manual Redpanda topic
bootstrap step is required for the default local-first path.
