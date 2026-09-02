# Research-backtesting Architecture

## Purpose

`research/backtesting` is the first offline runtime slice built on top of the ClickHouse
historian.

It exists to answer one question with the same strategy logic used live:

- "What signals, and what quote-aware simulated execution outcomes, would this configured
  analysis have produced over a historical window?"

The current implementation lives in the Rust crate `crates/research-backtesting`.

## Responsibilities

Current responsibilities:

- fetch the resolved `analysis-settings` projection from the control-plane on demand
- fetch named `research_settings` profiles from the control-plane on demand
- derive a replay window from timeframe-specific research durations
- warm the evaluator with pre-window candles
- replay the requested closed klines through the shared `emaCross` evaluator
- simulate entries, stop-loss exits, take-profit exits, reversals, and optional window-end exits
- apply configurable fee and slippage assumptions to the simulated fills
- persist completed backtest runs into ClickHouse
- expose recent persisted backtest runs and full persisted run lookup

Explicit non-responsibilities:

- live trading
- exchange connectivity
- order placement
- portfolio accounting
- optimization job orchestration
- partial-fill execution matching
- order-book-aware execution matching

## Current API

Current surface on `http://localhost:3050`:

- `/health/liveness`
- `/health/readiness`
- `/metrics`
- `/v1/info`
- `/v1/status`
- `/v1/backtests`
- `/v1/backtests/{backtest_id}`

`POST /v1/backtests` accepts:

- `analysisSettingId`
- `researchSettingsName`
- `windowKind`
  - `backtesting`
  - `favorableTimeslots`
  - `optimizationValidity`
- optional `startTime`
- optional `endTime`
- optional `warmupCandles`

Current contract note:

- `closeOpenPositionAtEnd` is not part of the request model
- still-open positions are currently left open at the replay boundary rather than force-closed

If `startTime` and `endTime` are omitted, the service uses the selected `research_settings`
window for the analysis timeframe and applies the legacy-style default:

- `endTime = previous midnight UTC`
- `startTime = endTime - configuredDurationMs`

The returned payload includes:

- `backtestId`
- `finishedAt`
- `durationMs`
- the resolved analysis record
- the selected research-settings profile
- the effective replay and warmup window
- execution assumptions
- emitted offline signals
- simulated trades
- summary counts and PnL

`GET /v1/backtests` returns recent persisted summaries.

`GET /v1/backtests/{backtest_id}` returns the full persisted payload for a previous run.

Persisted runs are stored in ClickHouse table:

- `research_backtest_runs`

Each persisted run also stores total request processing time in milliseconds:

- `durationMs`

## Shared Strategy Logic

The offline evaluator reuses `crates/strategy-engine/src/strategy_logic.rs`.

That means live and replay currently share:

- strategy-kind resolution
- parameter resolution
- EMA state updates
- crossover detection

This is deliberate. Backtesting should not silently diverge from live strategy behavior because of
two separate indicator implementations.

## Current Execution Model

available, with aggregate-trade fallback when quote coverage is missing.

Current fill model:

- generate signals from closed timeframe klines using the shared `emaCross` evaluator
- open a position at the first executable event at or after the signal timestamp
  - ask for long entry
  - bid for short entry
  - fall back to aggregate trades if no quote arrives first
- size the position from `trading_defaults.defaultPositionNotionalUsd`
- derive stop-loss distance from `risk_profile.swingGap`, clamped between
  `minimumStopLoss` and `maximumStopLoss`
- derive take-profit distance from `risk_profile.rrr`
- close on the first executable event that crosses:
  - the stop-loss threshold
  - the take-profit threshold
  - the opposite signal timestamp
  - long exits evaluate against bid
  - short exits evaluate against ask
- optionally close the last open position at the end of the window
- apply configurable fee and slippage assumptions to each filled side

This is useful for:

- validating that replay uses the same strategy logic as live trading
- verifying that `research_settings` windows drive historical reads correctly
- checking that risk and trading-defaults settings affect simulated outcomes
- comparing signal behavior with quote-aware fill resolution
- keeping replay results inspectable after service restarts

It is not yet enough for:

- partial-fill modeling
- full order-book-aware execution quality analysis
- full portfolio or order-state accounting

## Historical Retention Requirements

For the currently implemented quote-aware backtest, required historian retention is:

In the current code:

- the configured research window comes from `research_settings`
- it is timeframe-specific
- it is stored in milliseconds
- replay safety caps come from:
  - `BACKTEST_MAX_KLINES`
  - `BACKTEST_MAX_TRADES`
- warmup defaults to:
  - `slowPeriod * BACKTEST_WARMUP_MULTIPLIER`
  - default multiplier: `5`

So the practical formula is:

`required_history_ms = research_window_ms + (slow_period * warmup_multiplier * timeframe_period_ms)`

Examples with default multiplier `5`:

- `1m`, `slowPeriod = 21`
  - warmup = `21 * 5 * 60_000 = 6_300_000 ms`
  - warmup = `105 minutes`
- `3m`, `slowPeriod = 21`
  - warmup = `21 * 5 * 180_000 = 18_900_000 ms`
  - warmup = `315 minutes`
- `5m`, `slowPeriod = 21`
  - warmup = `21 * 5 * 300_000 = 31_500_000 ms`
  - warmup = `525 minutes`

If you want arbitrary user-selected backtests to work without missing-data failures, ClickHouse
should retain at least:

- the longest configured `research_settings` window for that timeframe
- plus the expected warmup margin
- and aggregate trades covering the full requested replay window

## Was The Legacy Approach Correct?

Mostly yes, with one important nuance.

What the legacy system got right:

- backtesting windows were timeframe-specific
- durations were stored as milliseconds
- different timeframes naturally required different historical spans

That logic is still correct and is now explicit in `research_settings`.

What the legacy system also did, and why it mattered:

- it used lower-granularity `S1` historical data to resolve whether targets or stops would have
  been hit after a signal

The current implementation replaces that legacy approximation with best bid/ask quote replay and
aggregate-trade fallback for the window it is able to retain in ClickHouse.

So the correct interpretation is:

- timeframe-specific durations in milliseconds are still the right control-plane model
- timeframe klines plus warmup are still required for indicator evaluation
- if you later want partial-fill or full order-book simulation, best bid/ask plus aggregate trades
  will still not be enough

## Expected Next Steps

1. keep ClickHouse retention aligned with the widest research window you want to support
2. add order-book replay if you need deeper execution realism than best bid/ask plus aggregate trades
3. extract the execution-simulation rules into a crate reused directly by the future live
   `execution` service
4. add optimization and batch job orchestration on top of the same historian
