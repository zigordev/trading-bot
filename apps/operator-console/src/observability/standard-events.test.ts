import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

const lines = { stdout: [] as string[], stderr: [] as string[] };

beforeEach(() => {
  lines.stdout.length = 0;
  lines.stderr.length = 0;
  process.env.OTEL_SERVICE_NAME = 'gpool-api';
  process.env.APP_RELEASE = 'v1.2.3';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    lines.stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    lines.stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.OTEL_SERVICE_NAME;
  delete process.env.APP_RELEASE;
});

const parsed = (output: string[]): Record<string, unknown>[] =>
  output.map((line) => JSON.parse(line) as Record<string, unknown>);

test('a start names the release and the runtime, plus what the service adds', async () => {
  const { logServiceStarted } = await import('./standard-events');

  logServiceStarted({ port: 3000 });

  assert.deepEqual(
    parsed(lines.stdout).map(({ timestamp: _timestamp, ...rest }) => rest),
    [
      {
        level: 'info',
        service: 'gpool-api',
        release: 'v1.2.3',
        event: 'service.started',
        runtime: `node ${process.version}`,
        port: 3000,
      },
    ]
  );
});

test('a stop names the signal', async () => {
  const { logServiceStopping } = await import('./standard-events');

  logServiceStopping('SIGTERM');

  assert.equal(parsed(lines.stdout)[0]?.event, 'service.stopping');
  assert.equal(parsed(lines.stdout)[0]?.signal, 'SIGTERM');
});

test('a failed request is an error with its route, status and stack', async () => {
  const { logRequestFailed } = await import('./standard-events');

  logRequestFailed({
    method: 'POST',
    route: '/pools/:id',
    status: 500,
    error: new TypeError('boom'),
  });
  logRequestFailed({ method: 'GET', route: '/pools', status: 502, error: 'upstream gone' });

  const [first, second] = parsed(lines.stderr);
  assert.equal(first?.event, 'request.failed');
  assert.equal(first?.route, '/pools/:id');
  assert.equal(first?.status, 500);
  assert.deepEqual(first?.error, { name: 'TypeError', message: 'boom' });
  assert.match(String(first?.stack), /TypeError: boom/);
  assert.deepEqual(second?.error, { name: 'NonError', message: 'upstream gone' });
  assert.equal(second?.stack, undefined);
});

test('a crash is logged without changing how the process dies', async () => {
  const { observeProcessFailures } = await import('./standard-events');
  const before = process.listenerCount('unhandledRejection');

  observeProcessFailures();
  observeProcessFailures();

  assert.equal(process.listenerCount('unhandledRejection'), before);
  const monitors = process.listeners('uncaughtExceptionMonitor');
  const monitor = monitors[monitors.length - 1] as (error: unknown, origin: string) => void;
  monitor(new RangeError('bad index'), 'uncaughtException');
  monitor('rejected with a string', 'unhandledRejection');
  process.removeListener('uncaughtExceptionMonitor', monitor);

  const [crash, rejection] = parsed(lines.stderr);
  assert.equal(crash?.event, 'process.uncaught_exception');
  assert.deepEqual(crash?.error, { name: 'RangeError', message: 'bad index' });
  assert.equal(rejection?.event, 'process.unhandled_rejection');
  assert.deepEqual(rejection?.error, { name: 'NonError', message: 'rejected with a string' });
});

test('a host that keeps running after a rejection can have it logged as a warning', async () => {
  const { observeProcessFailures } = await import('./standard-events');
  const before = process.listenerCount('unhandledRejection');

  observeProcessFailures({ rejections: 'observe' });

  const added = process.listeners('unhandledRejection').slice(before);
  assert.equal(added.length, 1);
  (added[0] as (reason: unknown) => void)(new Error('late'));
  for (const listener of added) process.removeListener('unhandledRejection', listener);
  const monitors = process.listeners('uncaughtExceptionMonitor');
  process.removeListener('uncaughtExceptionMonitor', monitors[monitors.length - 1] as never);

  const [warning] = parsed(lines.stdout);
  assert.equal(warning?.level, 'warn');
  assert.equal(warning?.event, 'process.unhandled_rejection');
});
