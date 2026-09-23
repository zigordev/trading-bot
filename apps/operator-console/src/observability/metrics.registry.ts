import * as client from 'prom-client';

/**
 * The one registry. Everything that registers a metric registers it here, so
 * `/metrics` is a single scrape returning both app and runtime numbers.
 */
export const registry = new client.Registry<client.OpenMetricsContentType>();
registry.setContentType(client.openMetricsContentType);

// Process and event-loop defaults in the same registry as app metrics.
client.collectDefaultMetrics({ register: registry });

new client.Gauge({
  name: 'service_build_info',
  help: 'The release this process runs, as a label',
  labelNames: ['version'] as const,
  registers: [registry],
}).set(
  {
    version:
      process.env.OTEL_SERVICE_VERSION?.trim() ||
      process.env.APP_RELEASE?.trim() ||
      process.env.NEXT_PUBLIC_RELEASE?.trim() ||
      'dev',
  },
  1
);
