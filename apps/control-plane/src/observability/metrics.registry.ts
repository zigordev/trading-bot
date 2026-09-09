import * as client from 'prom-client';

/**
 * The one registry. Everything that registers a metric registers it here, so
 * `/metrics` is a single scrape returning both app and runtime numbers.
 */
export const registry = new client.Registry();

// Process and event-loop defaults in the same registry as app metrics.
client.collectDefaultMetrics({ register: registry });
