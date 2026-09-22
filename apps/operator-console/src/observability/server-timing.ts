import { trace } from '@opentelemetry/api';

export function traceServerTiming(): string | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext?.traceId || (spanContext.traceFlags & 1) !== 1) return undefined;

  return `traceparent;desc="00-${spanContext.traceId}-${spanContext.spanId}-01"`;
}

export function withServerTiming(response: Response, timing = traceServerTiming()): Response {
  if (!timing) return response;

  try {
    response.headers.append('Server-Timing', timing);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.append('Server-Timing', timing);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
