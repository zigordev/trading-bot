import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { Pool } from 'pg';

import {
  normalizeProgressPercent,
  upsertBacktestBatchFromProgressEvent,
  upsertBacktestJobFromProgressEvent,
  updateBacktestJobProgress,
} from '../src/features/ops.js';

type CapturedQuery = { text: string; values: unknown[] };

const createCapturingPool = (row: Record<string, unknown>) => {
  const captured: CapturedQuery[] = [];
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      captured.push({ text, values });
      return { rows: [row], rowCount: 1 };
    },
  } as unknown as Pool;

  return { pool, captured };
};

const jobRow = {
  id: 'job-1',
  status: 'running',
  analysis_setting_id: 'analysis-1',
  risk_profile_name: 'default',
  pair_code: 'ETHUSD1',
  timeframe_code: '3m',
  strategy_name: 'strategy1',
  start_time: null,
  end_time: null,
  warmup_candles: null,
  backtest_id: null,
  error_message: null,
  stage: 'retrieving-data',
  progress_percent: 24.958333333333336,
  result_json: null,
  created_at: '2026-09-23T11:57:45.078Z',
  updated_at: '2026-09-23T11:57:45.078Z',
  started_at: '2026-09-23T11:57:45.078Z',
  finished_at: null,
};

const batchRow = {
  batch_id: 'batch-1',
  pair_code: 'ETHUSD1',
  timeframe_code: '3m',
  requested_start_time: 1_788_357_600_000,
  requested_end_time: 1_790_157_600_000,
  stage: 'retrieving-data',
  progress_percent: 24.958333333333336,
  total_count: 24,
  completed_count: 5,
  running_count: 1,
  created_at: '2026-09-23T11:57:45.078Z',
  updated_at: '2026-09-23T11:57:45.078Z',
};

const progressPlaceholder = /LEAST\(100, GREATEST\(0, (\$\d+)(::[a-z ]+)?\)\)/;

const progressClamp = (text: string): { placeholder: string; cast: string | undefined } => {
  const match = progressPlaceholder.exec(text);
  assert.ok(match, 'the statement should clamp the progress percent');
  return { placeholder: match[1], cast: match[2] };
};

test('normalizeProgressPercent keeps fractions, clamps the range and drops non-finite values', () => {
  assert.equal(normalizeProgressPercent(24.958333333333336), 24.958333333333336);
  assert.equal(normalizeProgressPercent(-3.5), 0);
  assert.equal(normalizeProgressPercent(180.25), 100);
  assert.equal(normalizeProgressPercent(Number.NaN), 0);
  assert.equal(normalizeProgressPercent(Number.POSITIVE_INFINITY), 0);
});

test('the job progress update pins the bound parameter to double precision', async () => {
  const { pool, captured } = createCapturingPool(jobRow);

  await updateBacktestJobProgress(pool, {
    jobId: 'job-1',
    stage: 'replaying',
    progressPercent: 24.958333333333336,
  });

  const [{ text, values }] = captured;
  const { placeholder, cast } = progressClamp(text);
  assert.equal(cast, '::double precision');
  assert.equal(values[Number(placeholder.slice(1)) - 1], 24.958333333333336);
});

test('the job progress upsert pins the bound parameter to double precision', async () => {
  const { pool, captured } = createCapturingPool(jobRow);

  await upsertBacktestJobFromProgressEvent(pool, {
    jobId: 'job-1',
    analysisSettingId: 'analysis-1',
    riskProfileName: 'default',
    pairCode: 'ETHUSD1',
    timeframeCode: '3m',
    strategyName: 'strategy1',
    stage: 'retrieving-data',
    progressPercent: 24.958333333333336,
  });

  const [{ text, values }] = captured;
  const { placeholder, cast } = progressClamp(text);
  assert.equal(cast, '::double precision');
  assert.equal(values[Number(placeholder.slice(1)) - 1], 24.958333333333336);
});

test('the batch progress upsert pins the bound parameter to double precision', async () => {
  const { pool, captured } = createCapturingPool(batchRow);

  await upsertBacktestBatchFromProgressEvent(pool, {
    batchId: 'batch-1',
    pairCode: 'ETHUSD1',
    timeframeCode: '3m',
    requestedStartTime: 1_788_357_600_000,
    requestedEndTime: 1_790_157_600_000,
    stage: 'retrieving-data',
    progressPercent: 24.958333333333336,
    totalCount: 24,
    completedCount: 5,
    runningCount: 1,
  });

  const [{ text, values }] = captured;
  const { placeholder, cast } = progressClamp(text);
  assert.equal(cast, '::double precision');
  assert.equal(values[Number(placeholder.slice(1)) - 1], 24.958333333333336);
});
