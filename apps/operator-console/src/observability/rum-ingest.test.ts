import assert from 'node:assert/strict';

import { test } from 'vitest';

import { clientKeyFrom, ingestRumBatch } from './rum-ingest';

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

const errorEvent = { type: 'error', name: 'unhandled', page: '/pools' };

test('the client key trusts only the first forwarded hop, so a caller cannot mint identities', () => {
  assert.equal(
    clientKeyFrom(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.7' })),
    '203.0.113.9'
  );
  assert.equal(
    clientKeyFrom(headers({ 'x-forwarded-for': ' , 10.0.0.7', 'x-real-ip': '198.51.100.4' })),
    '198.51.100.4'
  );
  assert.equal(clientKeyFrom(headers({})), 'unknown');
  assert.equal(clientKeyFrom(headers({ 'x-forwarded-for': 'x'.repeat(200) })).length, 64);
});

test('the sixty-first batch inside a minute is refused', () => {
  for (let i = 0; i < 60; i += 1) {
    assert.deepEqual(ingestRumBatch({ events: [] }, 'client-under-limit'), {
      ok: true,
      accepted: 0,
      rejected: 0,
      details: [],
    });
  }
  assert.deepEqual(ingestRumBatch({ events: [] }, 'client-under-limit'), {
    ok: false,
    status: 429,
    reason: 'rate limited',
  });
});

test('a body that is not an events batch is refused with 400', () => {
  assert.equal(ingestRumBatch(null, 'client-null').ok, false);
  assert.equal(ingestRumBatch('[]', 'client-string').ok, false);
  const outcome = ingestRumBatch({ events: 'not-an-array' }, 'client-shape');
  assert.deepEqual(outcome, { ok: false, status: 400, reason: 'expected an events array' });
});

test('an oversize batch keeps the first fifty and counts the rest as rejected', () => {
  const events = Array.from({ length: 55 }, () => errorEvent);
  assert.deepEqual(ingestRumBatch({ events }, 'client-oversize'), {
    ok: true,
    accepted: 50,
    rejected: 5,
    details: [],
  });
});

test('an unknown type or an overlong name drops that event and keeps the others', () => {
  const events = [
    errorEvent,
    { type: 'telemetry', name: 'x' },
    { type: 'error', name: 'n'.repeat(65) },
    42,
  ];
  assert.deepEqual(ingestRumBatch({ events }, 'client-mixed'), {
    ok: true,
    accepted: 1,
    rejected: 3,
    details: [],
  });
});
