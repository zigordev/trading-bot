# Execution Architecture

## Purpose

`execution` is the runtime service that turns the promoted trading configuration into an active
operating context.

The first implemented slice in this repository is intentionally narrow:

- hydrate the active promoted execution configuration from the control-plane
- expose liveness, readiness, metrics, and runtime status
- operate in `paper` mode by default
- prepare the boundary where live market-data consumption and trade generation will attach

It does not yet:

- submit live exchange orders
- reconcile exchange positions
- persist its own write model
- emit real execution trade events

## Current Contracts

The service currently reads:

- `GET /v1/ops/execution/summary` from the control-plane

The service currently exposes:

- `/health/liveness`
- `/health/readiness`
- `/metrics`
- `/v1/status`
- `/v1/promotion`

## Mode Model

Two modes are modeled:

- `paper`
  - live promoted configuration
  - no exchange order submission
  - future trades are simulated and published as operator-visible execution trades
- `live`
  - real exchange integration
  - future reconciliation and order-state handling

At the moment, the service starts and hydrates config in `paper` mode but does not yet generate
trades.

## Required Execution Settings

The minimum `execution-settings` record for paper trading is:

- `name`
- `enabled`
- `mode`
- `autoPromote`
- `selectionMetric`
- `requirePositivePnl`
- `minTradeCount`
- `allowedSymbols`
- `allowedTimeframes`
- `replaceOpenPositionPolicy`

Recommended first paper-trading values:

- `mode = paper`
- `enabled = true`
- `autoPromote = true`
- `selectionMetric = totalPnlPercent`
- `requirePositivePnl = false`
- `minTradeCount = 1`
- `allowedSymbols = []`
- `allowedTimeframes = []`
- `replaceOpenPositionPolicy = flatten`

Example payload:

```json
{
  "name": "paper-default",
  "enabled": true,
  "mode": "paper",
  "autoPromote": true,
  "selectionMetric": "totalPnlPercent",
  "requirePositivePnl": false,
  "minTradeCount": 1,
  "allowedSymbols": [],
  "allowedTimeframes": [],
  "replaceOpenPositionPolicy": "flatten"
}
```

This repo now also seeds that same example row in
`docker/postgres-seed-data.sql` as `paper-default`.

## Locked Decisions

These decisions are now fixed unless explicitly changed later.

### Promotion Rule

The best configuration is:

- the completed backtest with the highest `totalPnlPercent`

Current defaults around that rule:

- `selectionMetric = totalPnlPercent`
- `autoPromote = true`
- `minTradeCount = 1`
- `requirePositivePnl = false`

That means the system currently prefers the highest return even if all candidates are negative.
If you later want stricter promotion, add extra constraints rather than silently changing the
ranking definition.

### Replacement Behavior

When a new best configuration appears:

- execution switches immediately
- the current operating policy is `replaceOpenPositionPolicy = flatten`

Interpretation:

- the previous context should be stopped immediately
- any open position should be flattened before the new configuration starts opening fresh risk

### Paper Fill Model

For `paper` mode, the intended default is:

- use live market-data inputs
- generate signals with the shared strategy logic
- simulate fills from the first eligible post-signal market trade
- apply the same fixed fee/slippage assumptions used by replay until a better live-paper model is
  introduced
- do not model partial fills in the first slice

This keeps paper trading consistent with the current replay model while avoiding exchange-side
dependencies.

### Position Model

The default execution policy is:

- one open position at a time for the active promoted configuration
- no portfolio-wide multi-strategy allocator in the first slice
- position sizing comes from the promoted configuration / execution defaults
- opposite-direction signal closes and reverses immediately
- same-direction signal while already in position is ignored

### Runtime Safety

The default safety rules are:

- `paper` mode may run without a currently promoted config loaded, but it should not generate
  trades until one exists
- `live` mode should fail closed if no promoted config is available
- symbol/timeframe allowlists from `execution-settings` should be enforced when present
- stale or missing control-plane state should degrade readiness

### Trade Ledger Semantics

The operator console trade table is intended to show:

- one row per execution trade lifecycle
- open rows while a position is live
- closed rows once the round-trip is complete
- source promotion/backtest/config metadata attached for auditability

## Expected Next Steps

1. consume live market-data events for the promoted symbol/timeframe
2. reuse the shared `strategy-engine` evaluator for signal generation
3. implement paper-trade generation and publish execution-trade projection events
4. add a dedicated execution Kafka contract for promotions, orders, fills, and trades
5. add real exchange adapters and reconciliation for `live` mode
