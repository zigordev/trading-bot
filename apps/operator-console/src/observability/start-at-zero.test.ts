import assert from 'node:assert/strict';

import { Counter, Histogram, Registry } from 'prom-client';
import { test } from 'vitest';

import { startAtZero } from './start-at-zero';

test('counters and histograms exist at zero before their first event', async () => {
  const registry = new Registry();
  const sent = new Counter({
    name: 'x_sent_total',
    help: 'h',
    labelNames: ['template'] as const,
    registers: [registry],
  });
  const took = new Histogram({
    name: 'x_seconds',
    help: 'h',
    labelNames: ['template'] as const,
    buckets: [1],
    registers: [registry],
  });

  startAtZero(sent, [{ template: 'a' }, { template: 'b' }]);
  startAtZero(took, [{ template: 'a' }]);
  sent.inc({ template: 'a' });

  const text = await registry.metrics();
  assert.match(text, /x_sent_total\{template="a"\} 1/);
  assert.match(text, /x_sent_total\{template="b"\} 0/);
  assert.match(text, /x_seconds_bucket\{le="1",template="a"\} 0/);
  assert.match(text, /x_seconds_count\{template="a"\} 0/);
});
