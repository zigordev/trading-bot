import assert from 'node:assert/strict';

import { trace } from '@opentelemetry/api';
import { afterEach, test, vi } from 'vitest';

import { traceServerTiming, withServerTiming } from './server-timing';

const TRACE_ID = 'a'.repeat(32);
const SPAN_ID = 'b'.repeat(16);

const inSpan = (traceFlags: number) =>
  vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
    spanContext: () => ({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags }),
  } as never);

afterEach(() => {
  vi.restoreAllMocks();
});

test('a sampled span becomes a Server-Timing traceparent', () => {
  inSpan(1);

  assert.equal(traceServerTiming(), `traceparent;desc="00-${TRACE_ID}-${SPAN_ID}-01"`);
});

test('a span that was not sampled, or no span at all, names nothing', () => {
  assert.equal(traceServerTiming(), undefined);
  inSpan(0);
  assert.equal(traceServerTiming(), undefined);
});

test('a response carries the header, and one whose headers cannot change is copied', () => {
  const plain = withServerTiming(new Response(null, { status: 204 }), 'traceparent;desc="x"');
  assert.equal(plain.headers.get('server-timing'), 'traceparent;desc="x"');

  const redirect = Response.redirect('http://app.test/next', 307);
  const copied = withServerTiming(redirect, 'traceparent;desc="x"');

  assert.notEqual(copied, redirect);
  assert.equal(copied.status, 307);
  assert.equal(copied.headers.get('location'), 'http://app.test/next');
  assert.equal(copied.headers.get('server-timing'), 'traceparent;desc="x"');
});

test('without a timing the response is returned untouched', () => {
  const response = new Response(null, { status: 204 });

  assert.equal(withServerTiming(response, undefined), response);
});
