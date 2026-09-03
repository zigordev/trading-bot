# Backtest Replay Precision Guide

This guide explains how backtests are currently built from the three historical tables and what impact each one has on signal quality and execution realism.

## 1. Purpose of each market-data table

### `market_data_klines`

This is the **signal table**.

It is built from:

- startup/backfill REST pulls (`/api/v3/klines`)
- live websocket kline stream events

It contains candle data (`open/high/low/close`, `volume`, `trade_count`, `open_time`, `timeframe_code`) and is the only table that directly drives indicator state for the configured strategy.

For backtests:

- defines the kline timeline used for EMA warmup + decision points,
- defines signal timing,
- gates whether the strategy has enough history to evaluate a run.

### `market_data_trades`

This is the **execution-event table** for trade flow.

It is built from:

- startup/backfill REST pulls (`/api/v3/aggTrades`)
- live websocket aggregate trade stream events

It stores aggregate trade records (`aggregate_trade_id`, `trade_time`, `price`, `quantity`, `market_maker`, update time fields).

For backtests:

- provides event-ordering input for fill simulation,
- provides fallback execution path when quote snapshots are unavailable,
- improves realism of intrabar/edge behavior when fills are not book-based.

This is the **quote-realism table**.

It is built from:

- live websocket `bookTicker` events,
- periodic REST top-of-book snapshots (`/api/v3/depth?limit=5`) when checkpoint is stale/missing.

It stores top-of-book (`bid`/`ask`) and `order_book_update_id`.

For backtests:

- allows spread-aware fill simulation,
- improves fill pricing realism relative to trade-only simulation,
- is preferred source when available in replay.

## 2. Data flow during startup + runtime

`market-data` creates subscriptions from resolved analysis settings and runs:

1. Resolve active settings from control-plane (`/v1/runtime-config/analysis-settings`).
2. Build the active symbol/timeframe set from runtime configuration.
3. Run hourly closed-window retrieval and gap repair:
   - `market_data_klines`: historical candle backfill from Binance (`/klines`) using stored checkpoints.
   - `market_data_trades`: historical aggregate-trade backfill (`/aggTrades`) using stored checkpoints.

Both writers persist to ClickHouse and emit status via `/v1/status` and `/health`.

## 3. How replay reads are assembled

When a backtest is executed (`research-backtesting`), it pulls the same analysis window from:

- `replay_klines(pair,timeframe,window)`
- `replay_trades(pair,window)`

The execution layer merges these sources chronologically and simulates fills from the aggregate-trade tape.

So in practice:

- `klines` controls strategy timing/signals,
- `trades` provide a chronological tape of market activity,
- backtests run only when both sources are complete enough for the requested replay window.

## 5. Precision limitations to keep in mind

- backfills/repairs only from a checkpoint-forward model,
- use the last closed hour as the dataset boundary,
- may leave a dataset partial until missing aggregate-trade-id gaps are repaired.

### Ingestion mode differences

- During backfill, rows are marked `ingestion_mode="backfill"` and are still written to history.
- Backtest uses these rows primarily for chronology and fills, not as separate business logic branches.

## 6. Practical quality checks

Use these checks to verify per-pair quality before trusting signal-level conclusions:

1. Kline freshness:

- `market_data_klines`: does it cover requested window and required warmup?

2. Trade continuity:

- `market_data_trades`: is there reasonable tape density over the same window?

3. Quote coverage:

In the UI/API view:

- `/v1/replay/klines/:pair/:tf`
- `/v1/replay/trades/:pair`

If ticker rows are missing, treat fills as “tickers-absent fallback” quality.

## 7. Recommended operational profile

For stable signal testing:

- prioritize robust `market_data_klines` and `market_data_trades` continuity.

For execution realism studies:

- extend run duration over windows with active tickers coverage.
- avoid comparing results across runs where only the ticker coverage changed.

For strict precision workflows:

- mark runs as degraded when kline/trade/window coverage is below threshold,
- optionally gate production promotion on required source coverage.

## 8. Related files

- `crates/market-data/src/service.rs` (ingestion, backfill, replay fetches)
- `crates/market-data/src/db.rs` (ClickHouse schema + replay queries)
- `crates/market-data/src/main.rs` (replay endpoints)
- `crates/research-backtesting/src/service.rs` (run orchestration and replay loading)
- `crates/research-backtesting/src/execution_simulation.rs` (merge + fill precedence logic)
