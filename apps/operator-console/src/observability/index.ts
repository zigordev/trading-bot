// DO NOT EDIT. Vendored from platform-ops/packages/observability.
// Change it there and run: bash platform-ops/scripts/sync-observability.sh

/**
 * The observability kit — Next.js flavour.
 *
 * Browser bundles get `initRum` only; the ingest and metrics handlers are
 * server-side and pull in prom-client, which must never reach the client
 * bundle. Import them from `./observability/next` inside a route handler.
 */
export { initRum, trackEvent } from './rum-client';
export type { RumOptions } from './rum-client';
export { allFlags, isEnabled, registerFlags } from './feature-flags';
export type { FlagDefinition, ResolvedFlag } from './feature-flags';
