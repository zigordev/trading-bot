import assert from 'node:assert/strict';
import { trace } from '@opentelemetry/api';
import { afterEach, test, vi } from 'vitest';
import { fastifyLoggerOptions } from '../src/observability/fastify.js';
import { writeLogRecord } from '../src/observability/json-logger.js';

const lines: Record<string, unknown>[] = [];

const capture = () => {
  lines.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
    return true;
  });
};

const inSpan = (traceFlags: number) =>
  vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
    spanContext: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags }),
  } as never);

afterEach(() => {
  vi.restoreAllMocks();
});

test('a log line inside a sampled span names its trace', () => {
  inSpan(1);
  capture();

  writeLogRecord('info', 'listening');

  assert.equal(lines[0]?.traceId, 'a'.repeat(32));
  assert.equal(lines[0]?.spanId, 'b'.repeat(16));
});

test('a log line inside a span that was not sampled names no trace', () => {
  inSpan(0);
  capture();

  writeLogRecord('info', 'health probe');

  assert.equal(lines[0] !== undefined && 'traceId' in lines[0], false);
});

test('the Fastify log mixin names a trace only when it was sampled', () => {
  inSpan(1);
  assert.deepEqual(fastifyLoggerOptions.mixin(), {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
  });

  vi.restoreAllMocks();
  inSpan(0);
  assert.deepEqual(fastifyLoggerOptions.mixin(), {});
});
