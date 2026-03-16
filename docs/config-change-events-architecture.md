# Config-change Events Architecture

## Purpose

Config-change events are the fanout contract between the control-plane and future runtime
consumers.

They exist so that:

- the control-plane remains the authoring source of truth
- runtime services do not need to poll PostgreSQL continuously
- future services can react to configuration mutations in near real time

## Current Topic

Default topic:

- `trading-bot.control-plane.config-changes.v1`

The topic name is configurable through `CONFIG_CHANGE_EVENTS_TOPIC`.
The control-plane now provisions this topic on startup before it begins serving writes.

## Event Shape

Each message uses one envelope shape:

- `eventId`
- `eventType`
- `source`
- `occurredAt`
- `resourceType`
- `operation`
- `resourceId`
- `data`

Current `eventType`:

- `trading-bot.control-plane.config-changed.v1`

Current `operation` values:

- `created`
- `updated`
- `deleted`

`data` contains the resource record as it existed after the mutation, except for `deleted`
events where it contains the deleted record returned from PostgreSQL just before removal.

## Published Resources

The control-plane currently publishes config-change events for all authored configuration
resources:

- `pairs`
- `timeframes`
- `strategies`
- `risk_profiles`
- `trading_defaults`
- `research_settings`
- `analysis_settings`

No secret material is published. Binance credentials remain in OpenBao and are not modeled as
event payloads.

## Delivery Semantics

The current design publishes directly to Kafka after the PostgreSQL transaction commits.

Flow:

1. a CRUD mutation is executed in PostgreSQL
2. the transaction commits
3. the control-plane publishes the config-change event to Redpanda

The Redpanda delivery guarantee is at-least-once when publication succeeds.

That means consumers should:

- treat `eventId` as the deduplication key
- tolerate duplicate delivery
- avoid assuming exactly-once processing

## Why Direct Publish Now

The long-term platform direction is Kafka-first fanout, so the control-plane no longer keeps a
PostgreSQL outbox table. The current implementation chooses direct publish after commit as the
intermediate model.

That keeps the event path simple and close to the intended end-state, but it also means the
control-plane no longer has durable retry state for publication failures.

## Failure Model

If Redpanda is unavailable:

- the CRUD mutation may still commit in PostgreSQL
- the direct publish may fail
- runtime consumers may miss that mutation until another refresh path catches up

So the current model is simpler, but weaker, than the old outbox-backed handoff. That is an
intentional tradeoff while the platform moves toward Kafka-first coordination.

## Configuration

Current runtime config knobs:

- `KAFKA_BOOTSTRAP_SERVERS`
- `CONFIG_CHANGE_EVENTS_TOPIC`

## Expected Next Steps

1. add consumer-side contracts for the first runtime services
2. decide whether some consumers should receive narrower per-resource topics or keep the single
   fanout topic
3. add stronger observability around direct publish failures and consumer refresh behavior
