import assert from 'node:assert/strict';

import { trace } from '@opentelemetry/api';
import { afterEach, test, vi } from 'vitest';

import { kafkaLogCreator, writeLogRecord } from './json-logger';

const captured = { stdout: [] as string[], stderr: [] as string[] };

const capture = () => {
  captured.stdout.length = 0;
  captured.stderr.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    captured.stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    captured.stderr.push(String(chunk));
    return true;
  });
};

const onlyRecord = (lines: string[]): Record<string, unknown> => {
  assert.equal(lines.length, 1, `expected exactly one line, got ${lines.length}`);
  return JSON.parse(lines[0] ?? '') as Record<string, unknown>;
};

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OTEL_SERVICE_NAME;
  delete process.env.LOG_LEVEL;
  delete process.env.APP_RELEASE;
  delete process.env.OTEL_SERVICE_VERSION;
});

test('errors go to stderr, everything else to stdout, as one JSON line named after the service', () => {
  process.env.OTEL_SERVICE_NAME = 'gpool-api';
  capture();

  writeLogRecord(
    'error',
    new Error('broker gone'),
    'KafkaConsumer',
    'Error: broker gone\n    at x'
  );
  writeLogRecord('info', 'listening', 'Bootstrap');

  const error = onlyRecord(captured.stderr);
  assert.equal(error.level, 'error');
  assert.equal(error.service, 'gpool-api');
  assert.equal(error.message, 'broker gone');
  assert.equal(error.context, 'KafkaConsumer');
  assert.match(String(error.stack), /^Error: broker gone/);

  const info = onlyRecord(captured.stdout);
  assert.equal(info.level, 'info');
  assert.equal(info.message, 'listening');
  assert.equal('traceId' in info, false);
});

test('a line emitted inside an active span carries that span, so Loki can find the trace', () => {
  const traceId = 'a'.repeat(32);
  const spanId = 'b'.repeat(16);
  vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
  } as never);
  capture();

  writeLogRecord('warn', 'slow query');

  const record = onlyRecord(captured.stdout);
  assert.equal(record.traceId, traceId);
  assert.equal(record.spanId, spanId);
});

test('a line inside a span that was not sampled names no trace, because none was stored', () => {
  vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
    spanContext: () => ({ traceId: 'c'.repeat(32), spanId: 'd'.repeat(16), traceFlags: 0 }),
  } as never);
  capture();

  writeLogRecord('info', 'health probe');

  const record = onlyRecord(captured.stdout);
  assert.equal('traceId' in record, false);
  assert.equal('spanId' in record, false);
});

test('kafkajs lines take the shared shape, keeping their namespace and extra fields', () => {
  process.env.OTEL_SERVICE_NAME = 'notifications-api';
  capture();

  const log = kafkaLogCreator()(1);
  log({
    namespace: 'Connection',
    level: 1,
    label: 'ERROR',
    log: {
      message: 'Connection error: ECONNREFUSED',
      timestamp: '2026-09-07T10:00:00.000Z',
      logger: 'kafkajs',
      broker: 'platform-redpanda:9092',
    },
  });

  const record = onlyRecord(captured.stderr);
  assert.equal(record.level, 'error');
  assert.equal(record.service, 'notifications-api');
  assert.equal(record.context, 'kafkajs:Connection');
  assert.equal(record.message, 'Connection error: ECONNREFUSED');
  assert.equal(record.broker, 'platform-redpanda:9092');
});

test('a crash kafkajs recovers from is a warning, not an outage', () => {
  capture();

  const log = kafkaLogCreator()(1);
  log({
    namespace: 'Consumer',
    level: 1,
    label: 'ERROR',
    log: {
      message: 'Crash: KafkaJSNumberOfRetriesExceeded',
      logger: 'kafkajs',
      groupId: 'notifications',
      restarting: true,
    },
  });

  assert.equal(captured.stderr.length, 0);
  const record = onlyRecord(captured.stdout);
  assert.equal(record.level, 'warn');
  assert.equal(record.restarting, true);
});

test('fields passed as the message land at the top level, where LogQL reads them', () => {
  capture();

  writeLogRecord('info', {
    event: 'notification.sent',
    templateId: 'contact-message',
    attempt: 1,
  });

  const record = onlyRecord(captured.stdout);
  assert.equal(record.event, 'notification.sent');
  assert.equal(record.templateId, 'contact-message');
  assert.equal(record.attempt, 1);
  assert.equal('message' in record, false);
});

test('an error passed as the message keeps its stack; one described in fields does not', () => {
  capture();

  writeLogRecord('error', new Error('broker gone'));
  writeLogRecord('warn', { event: 'contact.publish_failed', error: new Error('no brokers') });

  const unexpected = onlyRecord(captured.stderr);
  assert.deepEqual(Object.keys(unexpected.error as object).sort(), ['message', 'name', 'stack']);
  assert.equal((unexpected.error as Record<string, unknown>).message, 'broker gone');

  const handled = onlyRecord(captured.stdout);
  assert.deepEqual(handled.error, { name: 'Error', message: 'no brokers' });
});

test('LOG_LEVEL drops everything below it', () => {
  process.env.LOG_LEVEL = 'warn';
  capture();

  writeLogRecord('debug', 'noisy');
  writeLogRecord('info', 'routine');
  writeLogRecord('warn', 'worth reading');

  assert.equal(captured.stdout.length, 1);
  assert.equal(onlyRecord(captured.stdout).message, 'worth reading');
});

test('an unreadable LOG_LEVEL keeps the default rather than silencing the service', () => {
  process.env.LOG_LEVEL = 'quiet';
  capture();

  writeLogRecord('info', 'routine');
  writeLogRecord('debug', 'noisy');

  assert.equal(captured.stdout.length, 1);
});

test('every record names the release it came from, when the service knows it', () => {
  process.env.APP_RELEASE = '1.22.1';
  capture();

  writeLogRecord('info', 'listening');

  assert.equal(onlyRecord(captured.stdout).release, '1.22.1');
});
