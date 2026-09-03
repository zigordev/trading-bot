// DO NOT EDIT. Vendored from platform-ops/packages/observability.
// Change it there and run: bash platform-ops/scripts/sync-observability.sh

/**
 * The observability kit — Fastify flavour.
 *
 * `tracing` is deliberately NOT re-exported: it must be imported first, before
 * any instrumented module loads, so services import it directly as a side
 * effect (`import './observability/tracing';`) on the first line of `main.ts`.
 * Re-exporting it here would let it load late and instrument nothing.
 */
export { kafkaLogCreator, writeLogRecord } from './json-logger.js';
export type { LogLevel } from './json-logger.js';
export { registry } from './metrics.registry.js';
export { fastifyLoggerOptions, registerHttpMetrics } from './fastify.js';
export { allFlags, isEnabled, registerFlags } from './feature-flags.js';
export type { FlagDefinition, ResolvedFlag } from './feature-flags.js';
export { recordHealth } from './health-metrics.js';
