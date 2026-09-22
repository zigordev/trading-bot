import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { afterEach, onTestFinished, test, vi } from 'vitest';
import Fastify from 'fastify';
import { Gauge } from 'prom-client';
import { HttpError } from '../src/http-error.js';
import { registerProblemErrorHandler } from '../src/problem-details.js';
import { registerHealthRoutes } from '../src/routes/health.js';
import { testConfig } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const captured = () => {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      callback();
    },
  });
  return { lines, stream };
};

const gauge = (): Gauge<string> =>
  new Gauge({
    name: `db_ready_events_test_${Math.floor(Math.random() * 1e9)}`,
    help: 'h',
    registers: [],
  });

test('the database check logs a change of state, not every failed probe', async () => {
  const { lines, stream } = captured();
  const app = Fastify({ logger: { level: 'info', stream } });
  onTestFinished(() => app.close());
  let healthy = false;
  registerHealthRoutes(
    app,
    {
      query: async () => {
        if (!healthy) throw new Error('connection refused');
        return { rows: [], rowCount: 1 };
      },
    } as never,
    gauge(),
    testConfig
  );

  await app.inject({ method: 'GET', url: '/health' });
  await app.inject({ method: 'GET', url: '/health' });
  healthy = true;
  await app.inject({ method: 'GET', url: '/health' });
  await app.inject({ method: 'GET', url: '/health' });

  const events = lines.map((line) => line.event).filter(Boolean);
  assert.deepEqual(events, ['postgres.unavailable', 'postgres.recovered']);
});

test('a 5xx is logged as request.failed with its route, and a 4xx is not logged', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const app = Fastify({ logger: false });
  onTestFinished(() => app.close());
  registerProblemErrorHandler(app);
  app.get('/v1/boom/:id', async () => {
    throw new Error('database gone');
  });
  app.get('/v1/missing/:id', async () => {
    throw new HttpError(404, 'not here');
  });

  const failed = await app.inject({ method: 'GET', url: '/v1/boom/7' });
  const missing = await app.inject({ method: 'GET', url: '/v1/missing/7' });

  assert.equal(failed.statusCode, 500);
  assert.equal(missing.statusCode, 404);
  const logged = stderr.mock.calls.map(
    ([line]) => JSON.parse(String(line)) as Record<string, unknown>
  );
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.event, 'request.failed');
  assert.equal(logged[0]?.route, '/v1/boom/:id');
  assert.equal(logged[0]?.status, 500);
  assert.deepEqual(logged[0]?.error, { name: 'Error', message: 'database gone' });
});
