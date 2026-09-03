// DO NOT EDIT. Vendored from platform-ops/packages/observability.
// Change it there and run: bash platform-ops/scripts/sync-observability.sh

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * The OpenTelemetry bootstrap.
 *
 * This module must be imported **before anything else** — instrumentation works
 * by patching modules as they load, so anything required ahead of it goes
 * untraced. In practice that means `import './observability/tracing';` on the
 * first line of `main.ts`, above every other import.
 *
 * Auto-instrumentation rather than a hand-picked list: it covers http, express,
 * nest, pg and kafkajs without each service having to remember to add the one
 * it just started using. `fs` is off because it produces a span per file read
 * and drowns everything else.
 */
const tracesEnabled = (process.env.OTEL_TRACES_ENABLED || 'true').toLowerCase() !== 'false';

const telemetrySdk = tracesEnabled ? start() : null;

let shutdownPromise: Promise<void> | undefined;

/**
 * Flush buffered spans and stop the SDK. Safe to call repeatedly and from more
 * than one place — the signal handlers below and a framework shutdown hook will
 * both call it, and OTel's own `shutdown()` rejects on a second call.
 */
export function shutdownTelemetry(): Promise<void> {
  shutdownPromise ??= telemetrySdk?.shutdown().catch(() => undefined) ?? Promise.resolve();
  return shutdownPromise;
}

function start(): NodeSDK {
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || 'unknown-service';

  // The OTel spec defines this as the BASE endpoint, with each signal appending
  // its own path. Trimming a trailing slash keeps `http://collector:4318/` and
  // `http://collector:4318` from producing different URLs.
  const endpoint = (
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || 'http://otel-collector:4318'
  ).replace(/\/+$/, '');

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // A span per file read drowns everything else.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // Pino services get their trace context from the kit's own log
        // config, under the estate's `traceId` name. Leaving this enabled
        // stamps a second copy as `trace_id`/`span_id`/`trace_flags` on every
        // line — same values, different names, and only one of them is what
        // Loki's derived field looks for.
        '@opentelemetry/instrumentation-pino': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Flush buffered spans on the way out. Without this the last spans before a
  // deploy — often the interesting ones — are lost.
  process.once('SIGTERM', () => void shutdownTelemetry());
  process.once('SIGINT', () => void shutdownTelemetry());

  return sdk;
}
