# Analysis-settings Architecture

## Purpose

`analysis-settings` is the control-plane resource that binds reference configuration into a
runtime-usable trading context.

On its own:

- a `pair` says what market can be traded
- a `timeframe` says on what operating horizon analysis runs
- a `strategy` says what decision logic exists
- a `risk_profile` says what reusable risk envelope should apply

`analysis-settings` connects those pieces into one operator-managed configuration record.

## Why This Lives In Control-plane

The new architecture treats configuration authoring as a control-plane responsibility.
`analysis-settings` does not belong on the hot trading path:

- it is written by operators or automation
- it changes relatively rarely compared to market events
- it is consumed by runtime services
- it benefits from strong relational validation

That makes PostgreSQL-backed control-plane CRUD the right first implementation.

## Legacy Mapping

The legacy system had a separate `analysis-settings` service with a coarse record:

- `pairCode`
- `timeframeCode`
- `technicalAnalysisSettings`
- embedded `riskSettings`

The new design keeps the same intent but changes the modeling:

- `pairCode` stays as a business reference
- `timeframeCode` stays as a business reference
- strategy selection becomes explicit via `strategyName`
- embedded `riskSettings` becomes a reference to reusable `riskProfileName`

This is an intentional normalization step, not a one-to-one copy.

## Current Data Model

Current API shape:

- `pairCode`
- `timeframeCode`
- `strategyName`
- `riskProfileName`
- `tradingDefaultsName`
- `technicalAnalysisSettings`
- `enabled`

Persistence shape:

- `id`
- the fields above
- `createdAt`
- `updatedAt`

## Reference Strategy

The resource uses natural business keys rather than opaque foreign-key ids:

- `pairs.code`
- `timeframes.code`
- `strategies.name`
- `risk_profiles.name`
- `trading_defaults.name`

Reasons:

- the control-plane is operator-facing
- the referenced fields are already unique and meaningful
- payloads stay readable in docs, JSON, and operational workflows
- PostgreSQL can still enforce referential integrity

PostgreSQL foreign keys use `ON UPDATE CASCADE` so a rename in the source reference data can
flow into `analysis_settings` without manual repair.

## Uniqueness Rule

The current uniqueness rule is:

- one `analysis-settings` record per `pairCode + timeframeCode + strategyName`

Implication:

- a strategy can have different configurations per pair/timeframe
- a pair/timeframe can host multiple strategies
- the same strategy cannot have two competing bindings for the same pair/timeframe in the
  current slice

This is the simplest rule that preserves a clear operator mental model and avoids duplicate
config rows for the same execution context.

## Risk-profile And Trading-defaults References

`risk_profile` and `trading_defaults` are referenced instead of copied into every
`analysis-settings` row.

Benefits:

- reuse one risk envelope across multiple bindings
- reuse one trading-defaults profile across multiple bindings
- change risk behavior centrally
- change execution defaults centrally
- avoid inconsistent duplicated stop-loss and RRR values
- avoid duplicating default position-sizing configuration
- make future risk-profile versioning possible

Tradeoff:

- runtime consumers need a projection or resolved view if they want one fully materialized
  payload per binding

That is now partially implemented through the first runtime projection endpoint.

## Technical-analysis Settings

`technicalAnalysisSettings` remains a JSON object in this slice.

That is deliberate:

- strategy families will likely need different parameter sets
- the schema is still evolving during migration from legacy logic
- a rigid relational decomposition now would slow migration without improving runtime behavior

The control-plane still validates that the field is an object, but strategy-specific validation
can be added later once the new strategy-engine contracts are clearer.

## Enablement Model

The binding includes `enabled`.

This is separate from `strategy.activated`:

- `strategy.activated` is a coarse global flag for the strategy definition
- `analysis-settings.enabled` is a per-binding switch for a specific pair/timeframe/strategy

That separation allows future rollout patterns such as:

- keep a strategy globally available
- enable it only for selected pairs
- disable one timeframe binding without deleting the record

## Current Responsibilities

Implemented now:

- persisted CRUD in control-plane
- referential integrity against pairs, timeframes, strategies, risk profiles, and trading defaults
- uniqueness enforcement for one binding per pair/timeframe/strategy
- OpenAPI exposure through the control-plane docs
- direct config-change event publication
- resolved runtime projection for active and operable bindings

Not implemented yet:

- additional resolved read models for runtime consumers
- strategy-specific validation of `technicalAnalysisSettings`
- runtime consumers in `strategy-engine` or `research/backtesting`
- versioned configuration history

## Expected Next Steps

After this slice, the likely follow-on work is:

1. extend consumer-facing projection shapes for additional runtime consumers
2. add strategy-aware validation for `technicalAnalysisSettings`
3. connect the future strategy-engine and replay/backtesting flows to this control-plane source
4. add versioned change-history and rollout semantics if operators need audited config promotion
