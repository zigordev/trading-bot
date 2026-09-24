import assert from 'node:assert/strict';

import { Pool } from 'pg';
import { afterAll, beforeAll, test } from 'vitest';

import {
  ensureOpsSchema,
  upsertBacktestBatchFromProgressEvent,
  upsertBacktestJobFromProgressEvent,
  updateBacktestJobProgress,
} from '../../src/features/ops.js';

const pool = new Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 15442),
  user: process.env.DB_USER ?? 'trading_bot_admin',
  password: process.env.DB_PASSWORD ?? 'secret',
  database: process.env.DB_NAME ?? 'trading_bot',
  max: 2,
});

const suffix = Date.now();
const jobId = `job:fractional-progress:${suffix}`;
const batchId = `ETHUSD1:3m:fractional-progress:${suffix}`;

const fractionalPercent = 24.958333333333336;

beforeAll(async () => {
  await ensureOpsSchema(pool);
});

afterAll(async () => {
  await pool.query('DELETE FROM ops_backtest_jobs WHERE id = $1', [jobId]);
  await pool.query('DELETE FROM ops_backtest_batches WHERE batch_id = $1', [batchId]);
  await pool.end();
});

test('a fractional job progress percent survives the round trip instead of failing the projection', async () => {
  const inserted = await upsertBacktestJobFromProgressEvent(pool, {
    jobId,
    analysisSettingId: 'analysis-fractional',
    riskProfileName: 'default',
    pairCode: 'ETHUSD1',
    timeframeCode: '3m',
    strategyName: 'strategy1',
    stage: 'retrieving-data',
    progressPercent: fractionalPercent,
  });

  assert.equal(inserted.progressPercent, fractionalPercent);

  const updated = await updateBacktestJobProgress(pool, {
    jobId,
    stage: 'replaying',
    progressPercent: 63.5,
  });

  assert.ok(updated);
  assert.equal(updated.progressPercent, 63.5);
});

test('a fractional batch progress percent survives the round trip', async () => {
  const projected = await upsertBacktestBatchFromProgressEvent(pool, {
    batchId,
    pairCode: 'ETHUSD1',
    timeframeCode: '3m',
    requestedStartTime: 1_788_357_600_000,
    requestedEndTime: 1_790_157_600_000,
    stage: 'retrieving-data',
    progressPercent: fractionalPercent,
    totalCount: 24,
    completedCount: 5,
    runningCount: 1,
  });

  assert.equal(projected.progressPercent, fractionalPercent);
});

test('an out-of-range percent is still clamped and a non-finite one collapses to zero', async () => {
  const overshoot = await upsertBacktestBatchFromProgressEvent(pool, {
    batchId,
    pairCode: 'ETHUSD1',
    timeframeCode: '3m',
    requestedStartTime: 1_788_357_600_000,
    requestedEndTime: 1_790_157_600_000,
    stage: 'replaying',
    progressPercent: 180.25,
    totalCount: 24,
    completedCount: 24,
    runningCount: 0,
  });

  assert.equal(overshoot.progressPercent, 100);

  const notANumber = await upsertBacktestBatchFromProgressEvent(pool, {
    batchId,
    pairCode: 'ETHUSD1',
    timeframeCode: '3m',
    requestedStartTime: 1_788_357_600_000,
    requestedEndTime: 1_790_157_600_000,
    stage: 'replaying',
    progressPercent: Number.NaN,
    totalCount: 24,
    completedCount: 24,
    runningCount: 0,
  });

  assert.equal(notANumber.progressPercent, 0);
});
