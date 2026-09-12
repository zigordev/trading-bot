# General-settings Architecture

## Purpose

Legacy `general-settings` was not a coherent domain object. It was a container for:

- exchange credentials
- execution defaults
- backtesting timeranges
- favorable-timeslot ranges
- optimization validity windows
- timeframe period metadata

The new architecture decomposes those concerns into the service boundary that actually owns
them.

## Decomposition Strategy

The replacement strategy is:

- control-plane owns operator-authored trading configuration
- control-plane also owns operator-authored research/backtesting profiles
- OpenBao owns the secret values themselves
- research/backtesting will consume replay and optimization-specific settings at runtime
- timeframes or strategy-specific config own timeframe-related semantics

This keeps each record focused and reduces the chance that one global settings row becomes an
implicit dependency for every runtime path.

## Implemented Control-plane Slices

### Trading Defaults

Resource: `trading_defaults`

Purpose:

- store reusable operator-managed default execution settings
- keep notional sizing explicit and normalized
- keep business defaults separate from secret resolution

Current API shape:

- `name`
- `description`
- `defaultPositionNotionalUsd`
- `enabled`

This intentionally renames the legacy `defaultPositionPriceUsd` field.

Why:

- the legacy name implies a market price
- the actual usage is a dollar notional or position-size default
- `defaultPositionNotionalUsd` better reflects how future execution or simulation code
  will interpret it

`analysis-settings` now selects which `trading_defaults` profile applies to a
pair/timeframe/strategy binding. That keeps reusable execution defaults separate from
strategy-specific technical-analysis settings while still giving runtime consumers one joined
projection to consume.

### Research Settings

Resource: `research_settings`

Purpose:

- store reusable backtesting and optimization windows
- keep experiment-oriented configuration separate from live trading defaults
- give future replay/backtesting flows one named profile to consume

Current API shape:

- `name`
- `description`
- `backtestingTimerange`
- `favorableTimeslotsBacktestingTimerange`
- `optimizationValidityPeriod`
- `enabled`

Legacy mapping:

- `backtestingTimerange` stays a dedicated field
- `favorableTimeslotsBacktestingTimerange` stays a dedicated field
- `optimizationValidityPeriod` stays a dedicated field

The three window fields remain structured objects keyed by the supported timeframe codes:

- `1m`
- `3m`
- `5m`

That preserves the legacy semantics without keeping them trapped inside one catch-all
`general-settings` row.

## Deferred Slices

The following legacy `general-settings` concerns are intentionally not implemented in the
control-plane yet:

- no additional `general-settings` fields currently remain outside the new model
- future research/backtesting services may still introduce their own runtime-specific state,
  but that is separate from the authored CRUD resources migrated here

## Timeframe-period Data

Legacy `timeframePeriods` does not return as a global settings bucket.

It is now absorbed into the existing `timeframes` resource as `periodMs`.

Why:

- the period belongs to the timeframe identity itself
- historical-data and replay code need canonical duration data next to the timeframe code
- it avoids one more globally shared settings record

## Why OpenBao Matters Here

Binance credentials stay in OpenBao and are resolved directly by app/runtime config.

That gives a clean split:

- PostgreSQL stores structured business configuration only
- OpenBao stores secret values and access control
- future runtime services can resolve secrets at startup or on refresh without requiring the
  control-plane database to model secret locations while there is only one provider

This is the minimum standard for exchange credentials.

If the system later needs multiple exchange accounts or per-strategy credential selection,
then a dedicated credential-reference resource can be introduced. That complexity is deferred
until there is a concrete need for it.

## What Is Still Missing

Not implemented yet:

- additional resolved runtime projections for execution services
- versioned change history

## Expected Next Steps

1. define the runtime projection shape consumed by future execution services
2. decide whether execution should reference `trading_defaults` directly or use a richer
   execution profile concept
3. connect future `research/backtesting` jobs to `research_settings`
4. add versioned change history if operator workflows need promotion or rollback
