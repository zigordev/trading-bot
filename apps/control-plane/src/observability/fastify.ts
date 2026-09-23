import { trace, TraceFlags } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import * as client from 'prom-client';
import { isFrameworkChatter } from './framework-logs.js';
import { currentRelease } from './json-logger.js';
import { registry } from './metrics.registry.js';

declare module 'fastify' {
  interface FastifySchema {
    hide?: boolean;
  }
}

/** The Fastify adapter, mirroring `nest.ts`. trading-bot's control-plane and
 *  sity's server use it. */

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

/**
 * Emits the same two metrics, with the same names and labels, as the Express
 * middleware. That sameness is the point: every recording rule and alert in
 * `platform-ops/docker/prometheus/` aggregates `http_requests_total` by `job`,
 * so a service that names its metrics differently is scraped but never alerted
 * on — which is exactly what the control-plane was before this existed.
 *
 * `routeOptions.url` is the route *pattern* (`/v1/pairs/:id`), never the
 * resolved path. An id in a label gives Prometheus one time series per id.
 */
export function registerHttpMetrics(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? 'unmatched';

    const labels = {
      method: request.method,
      route,
      status: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels, 1);
    // Fastify measures this for us, in milliseconds.
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
  });

  app.get(
    '/metrics',
    // `hide` keeps the scrape endpoint out of the Swagger UI. Fastify core
    // ignores the key; @fastify/swagger reads it.
    { schema: { hide: true } },
    async (_request, reply) => {
      reply.header('Content-Type', registry.contentType);
      return registry.metrics();
    }
  );
}

/**
 * Pino options that make Fastify's own logs match `json-logger.ts` — same
 * field names, same level strings, same `service`, and the same `traceId` from
 * the active span.
 *
 * Without this, one service in the estate writes `{"level":30,"msg":...}` while
 * the rest write `{"level":"info","message":...}`, and a Loki query that works
 * for four services silently returns nothing for the fifth.
 */
export const fastifyLoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  messageKey: 'message',
  base: {
    service: process.env.OTEL_SERVICE_NAME?.trim() || 'unknown-service',
    ...(currentRelease() ? { release: currentRelease() } : {}),
  },
  formatters: {
    // pino writes numeric levels by default; the estate uses the label.
    level: (label: string) => ({ level: label }),
    log: (record: Record<string, unknown>) => {
      const { error } = record;
      if (!(error instanceof Error)) return record;
      return {
        ...record,
        error: { name: error.name, message: error.message },
        ...(error.stack ? { stack: error.stack } : {}),
      };
    },
  },
  hooks: {
    logMethod(args: unknown[], method: (...args: never[]) => unknown, level: number): void {
      if (level === 30 && isFrameworkChatter(args[0])) return;
      Reflect.apply(method, this, args);
    },
  },
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  mixin: () => {
    const spanContext = trace.getActiveSpan()?.spanContext();
    return spanContext?.traceId &&
      (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED
      ? { traceId: spanContext.traceId, spanId: spanContext.spanId }
      : {};
  },
};
