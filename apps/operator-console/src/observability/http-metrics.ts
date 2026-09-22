import { trace } from '@opentelemetry/api';
import * as client from 'prom-client';

import { registry } from './metrics.registry';
import { withServerTiming } from './server-timing';

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
  enableExemplars: true,
  registers: [registry],
});

function sampledTraceId(): string | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext?.traceId) return undefined;

  return spanContext.traceFlags === 1 ? spanContext.traceId : undefined;
}

export function withRouteMetrics<T extends unknown[]>(
  route: string,
  handler: (...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    const request = args[0] as Request | undefined;
    const method = request?.method ?? 'POST';
    const started = performance.now();
    let status = 500;

    try {
      const response = await handler(...args);
      status = response.status;
      return withServerTiming(response);
    } finally {
      const labels = { method, route, status: String(status) };
      const seconds = (performance.now() - started) / 1000;
      const traceId = sampledTraceId();

      httpRequestsTotal.inc(labels);

      httpRequestDuration.observe({
        labels,
        value: seconds,
        ...(traceId ? { exemplarLabels: { trace_id: traceId } as never } : {}),
      });
    }
  };
}
