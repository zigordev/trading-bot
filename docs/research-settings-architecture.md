# Research-settings Architecture

## Purpose

`research-settings` is the reusable configuration resource for replay, backtesting, and
optimization windows.

It exists to migrate the research-oriented part of legacy `general-settings` into a named,
versionable control-plane record instead of keeping those values inside one global row.

## Why This Lives In Control-plane

The target architecture still keeps `research/backtesting` as its own runtime boundary, but
the authoring workflow belongs in the control-plane:

- operators need CRUD for these settings before the runtime service exists
- the values change much less often than market data or backtest results
- the resource should be reusable across multiple future replay or optimization jobs
- PostgreSQL gives a durable source of truth for profile-based configuration

So the current placement is:

- control-plane owns CRUD and persistence
- future `research/backtesting` code will consume the records

## Legacy Mapping

The legacy `general-settings` record mixed three research-oriented fields:

- `backtestingTimerange`
- `favorableTimeslotsBacktestingTimerange`
- `optimizationValidityPeriod`

The new design keeps those concepts intact but moves them into a reusable named profile.

## Current Data Model

Current API shape:

- `name`
- `description`
- `backtestingTimerange`
- `favorableTimeslotsBacktestingTimerange`
- `optimizationValidityPeriod`
- `enabled`

Persistence shape:

- `id`
- the fields above
- `createdAt`
- `updatedAt`

## Window Semantics

Each window field is stored as a structured object keyed by supported timeframe codes:

- `1m`
- `3m`
- `5m`

Each value is a positive integer duration in milliseconds.

That preserves the useful part of the legacy shape:

- backtesting lookback windows stay timeframe-specific
- favorable-timeslot analysis windows stay timeframe-specific
- optimization validity stays timeframe-specific

without forcing those concerns into unrelated runtime services yet.

This is also how the legacy code worked. The old timerange helper received millisecond durations
and converted them into concrete `startDate` and `endDate` windows per timeframe. That part of
the legacy approach was correct and is now carried forward explicitly instead of being implicit in
one global settings row.

## Why This Is Separate From Trading Defaults

`trading_defaults` and `research_settings` should not be merged.

They serve different operational purposes:

- `trading_defaults` affects live execution behavior
- `research_settings` affects replay, optimization, and historical experimentation

Keeping them separate avoids one settings profile from becoming an implicit dependency for both
live trading and offline research flows.

## Current Responsibilities

Implemented now:

- persisted CRUD in control-plane
- OpenAPI exposure through the control-plane docs
- profile-based storage of legacy research windows
- direct config-change event publication
- runtime consumption by the `research/backtesting` service

Not implemented yet:

- job-level references from future replay or optimization workflows
- versioned configuration history

## Relationship To Timeframes

Legacy `timeframePeriods` is intentionally not stored here.

That data is now carried by `timeframes.periodMs`, because the duration of a timeframe belongs
to the timeframe definition itself, not to a research profile.

## Expected Next Steps

1. decide which future replay/backtesting jobs reference a research profile by name
2. expand the current `research/backtesting` service beyond aggregate-trade execution simulation
   into deeper order-book-aware replay and optimization jobs
3. add versioned profile history if research workflows need reproducible promotion semantics
