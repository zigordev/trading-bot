import { randomUUID } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

export type BacktestJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type BacktestJobInput = {
  analysisSettingId: string;
  riskProfileName?: string;
  symbolCode?: string;
  timeframeCode?: string;
  strategyName?: string;
  startTime?: number;
  endTime?: number;
  warmupCandles?: number;
};

export type BacktestJobRecord = {
  id: string;
  status: BacktestJobStatus;
  analysisSettingId: string;
  riskProfileName: string | null;
  symbolCode: string | null;
  timeframeCode: string | null;
  strategyName: string | null;
  startTime: number | null;
  endTime: number | null;
  warmupCandles: number | null;
  backtestId: string | null;
  errorMessage: string | null;
  stage: string | null;
  progressPercent: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown> | null;
};

export type BacktestRunProjectionRecord = {
  backtestId: string;
  finishedAt: string;
  backtestDurationMs: number;
  dataRetrievalDurationMs: number;
  analysisSettingId: string;
  riskProfileName: string;
  symbol: string;
  timeframeCode: string;
  strategyName: string;
  requestedStartTime: number;
  requestedEndTime: number;
  replayKlineCount: number;
  replayTradeCount: number;
  signalCount: number;
  tradeCount: number;
  totalPnlPercent: number;
  sourceEventId: string;
  sourceOccurredAt: string;
  createdAt: string;
  updatedAt: string;
};

export type BacktestRunProjectionInput = Omit<
  BacktestRunProjectionRecord,
  "createdAt" | "updatedAt"
>;

export type BacktestBatchRecord = {
  batchId: string;
  symbolCode: string;
  timeframeCode: string;
  requestedStartTime: number;
  requestedEndTime: number;
  stage: string;
  progressPercent: number;
  totalCount: number;
  completedCount: number;
  runningCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DataReadinessProjectionRecord = {
  status: "ready" | "partial" | "missing" | "error";
  symbolCode: string;
  timeframeCode: string;
  analysisSettingIds: string[];
  requestedStartTime: number;
  requestedEndTime: number;
  requiredHistoryMs: number;
  completenessPercent: number;
  details: string | null;
  kline: Record<string, unknown> | null;
  trades: Record<string, unknown> | null;
  sourceEventId: string;
  sourceOccurredAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DataReadinessProjectionInput = Omit<
  DataReadinessProjectionRecord,
  "createdAt" | "updatedAt"
>;

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  }

  return null;
};

const toIsoString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
};

const mapBacktestJobRow = (row: QueryResultRow): BacktestJobRecord => ({
  id: String(row.id),
  status: String(row.status) as BacktestJobStatus,
  analysisSettingId: String(row.analysis_setting_id),
  riskProfileName:
    row.risk_profile_name === null ? null : String(row.risk_profile_name),
  symbolCode: row.symbol_code === null ? null : String(row.symbol_code),
  timeframeCode: row.timeframe_code === null ? null : String(row.timeframe_code),
  strategyName: row.strategy_name === null ? null : String(row.strategy_name),
  startTime: row.start_time === null ? null : Number(row.start_time),
  endTime: row.end_time === null ? null : Number(row.end_time),
  warmupCandles:
    row.warmup_candles === null ? null : Number(row.warmup_candles),
  backtestId: row.backtest_id === null ? null : String(row.backtest_id),
  errorMessage: row.error_message === null ? null : String(row.error_message),
  stage: row.stage === null ? null : String(row.stage),
  progressPercent:
    row.progress_percent === null ? null : Number(row.progress_percent),
  createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
  startedAt: toIsoString(row.started_at),
  finishedAt: toIsoString(row.finished_at),
  result: parseJsonObject(row.result_json),
});

const mapBacktestRunProjectionRow = (
  row: QueryResultRow,
): BacktestRunProjectionRecord => ({
  backtestId: String(row.backtest_id),
  finishedAt: toIsoString(row.finished_at) ?? new Date(0).toISOString(),
  backtestDurationMs: Number(row.backtest_duration_ms),
  dataRetrievalDurationMs: Number(row.data_retrieval_duration_ms),
  analysisSettingId: String(row.analysis_setting_id),
  riskProfileName: String(row.risk_profile_name),
  symbol: String(row.symbol),
  timeframeCode: String(row.timeframe_code),
  strategyName: String(row.strategy_name),
  requestedStartTime: Number(row.requested_start_time),
  requestedEndTime: Number(row.requested_end_time),
  replayKlineCount: Number(row.replay_kline_count),
  replayTradeCount: Number(row.replay_trade_count),
  signalCount: Number(row.signal_count),
  tradeCount: Number(row.trade_count),
  totalPnlPercent: Number(row.total_pnl_percent),
  sourceEventId: String(row.source_event_id),
  sourceOccurredAt:
    toIsoString(row.source_occurred_at) ?? new Date(0).toISOString(),
  createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
});

const mapStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  }

  return [];
};

const mapBacktestBatchRow = (row: QueryResultRow): BacktestBatchRecord => ({
  batchId: String(row.batch_id),
  symbolCode: String(row.symbol_code),
  timeframeCode: String(row.timeframe_code),
  requestedStartTime: Number(row.requested_start_time),
  requestedEndTime: Number(row.requested_end_time),
  stage: String(row.stage),
  progressPercent: Number(row.progress_percent),
  totalCount: Number(row.total_count),
  completedCount: Number(row.completed_count),
  runningCount: Number(row.running_count),
  createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
});

const mapDataReadinessProjectionRow = (
  row: QueryResultRow,
): DataReadinessProjectionRecord => ({
  status:
    row.status === "ready" ||
    row.status === "partial" ||
    row.status === "missing" ||
    row.status === "error"
      ? row.status
      : "error",
  symbolCode: String(row.symbol_code),
  timeframeCode: String(row.timeframe_code),
  analysisSettingIds: mapStringArray(row.analysis_setting_ids_json),
  requestedStartTime: Number(row.requested_start_time),
  requestedEndTime: Number(row.requested_end_time),
  requiredHistoryMs: Number(row.required_history_ms),
  completenessPercent: Number(row.completeness_percent),
  details: row.details === null ? null : String(row.details),
  kline: parseJsonObject(row.kline_json),
  trades: parseJsonObject(row.trades_json),
  sourceEventId: String(row.source_event_id),
  sourceOccurredAt:
    toIsoString(row.source_occurred_at) ?? new Date(0).toISOString(),
  createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
});

export const ensureOpsSchema = async (pool: Pool): Promise<void> => {
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ops_data_readiness' AND column_name = 'pair_code'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ops_data_readiness' AND column_name = 'symbol_code'
      ) THEN
        ALTER TABLE ops_data_readiness RENAME COLUMN pair_code TO symbol_code;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_backtest_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      analysis_setting_id TEXT NOT NULL,
      risk_profile_name TEXT,
      symbol_code TEXT,
      timeframe_code TEXT,
      strategy_name TEXT,
      start_time BIGINT,
      end_time BIGINT,
      warmup_candles INTEGER,
      backtest_id TEXT,
      error_message TEXT,
      stage TEXT,
      progress_percent DOUBLE PRECISION,
      result_json JSONB,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      CONSTRAINT ops_backtest_jobs_status_valid
        CHECK (status IN ('queued', 'running', 'completed', 'failed'))
    );
  `);

  await pool.query(`
    ALTER TABLE ops_backtest_jobs
      ADD COLUMN IF NOT EXISTS symbol_code TEXT,
      ADD COLUMN IF NOT EXISTS timeframe_code TEXT,
      ADD COLUMN IF NOT EXISTS strategy_name TEXT,
      ADD COLUMN IF NOT EXISTS stage TEXT,
      ADD COLUMN IF NOT EXISTS progress_percent DOUBLE PRECISION
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_backtest_runs (
      backtest_id TEXT PRIMARY KEY,
      finished_at TIMESTAMPTZ NOT NULL,
      backtest_duration_ms BIGINT NOT NULL,
      data_retrieval_duration_ms BIGINT NOT NULL,
      analysis_setting_id TEXT NOT NULL,
      risk_profile_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe_code TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      requested_start_time BIGINT NOT NULL,
      requested_end_time BIGINT NOT NULL,
      replay_kline_count INTEGER NOT NULL,
      replay_trade_count INTEGER NOT NULL,
      signal_count INTEGER NOT NULL,
      trade_count INTEGER NOT NULL,
      total_pnl_percent DOUBLE PRECISION NOT NULL,
      source_event_id TEXT NOT NULL,
      source_occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_backtest_batches (
      batch_id TEXT PRIMARY KEY,
      symbol_code TEXT NOT NULL,
      timeframe_code TEXT NOT NULL,
      requested_start_time BIGINT NOT NULL,
      requested_end_time BIGINT NOT NULL,
      stage TEXT NOT NULL,
      progress_percent DOUBLE PRECISION NOT NULL,
      total_count INTEGER NOT NULL,
      completed_count INTEGER NOT NULL,
      running_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_data_readiness (
      symbol_code TEXT NOT NULL,
      timeframe_code TEXT NOT NULL,
      status TEXT NOT NULL,
      analysis_setting_ids_json JSONB NOT NULL,
      requested_start_time BIGINT NOT NULL,
      requested_end_time BIGINT NOT NULL,
      required_history_ms BIGINT NOT NULL,
      completeness_percent DOUBLE PRECISION NOT NULL,
      details TEXT,
      kline_json JSONB,
      trades_json JSONB,
      book_tickers_json JSONB,
      source_event_id TEXT NOT NULL,
      source_occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (symbol_code, timeframe_code),
      CONSTRAINT ops_data_readiness_status_valid
        CHECK (status IN ('ready', 'partial', 'missing', 'error'))
    );
  `);

  await pool.query(`
    UPDATE ops_backtest_jobs
       SET status = 'failed',
           error_message = COALESCE(error_message, 'job interrupted by control-plane restart'),
           finished_at = COALESCE(finished_at, NOW()),
           updated_at = NOW()
     WHERE status IN ('queued', 'running')
  `);
};

export const listBacktestJobs = async (
  pool: Pool,
  limit = 50,
): Promise<BacktestJobRecord[]> => {
  const result = await pool.query(
    `
      SELECT
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        backtest_id,
        error_message,
        stage,
        progress_percent,
        result_json,
        created_at,
        updated_at,
        started_at,
        finished_at
      FROM ops_backtest_jobs
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(limit, 200))],
  );

  return result.rows.map(mapBacktestJobRow);
};

export const listBacktestBatches = async (
  pool: Pool,
  limit = 100,
): Promise<BacktestBatchRecord[]> => {
  const result = await pool.query(
    `
      SELECT
        batch_id,
        symbol_code,
        timeframe_code,
        requested_start_time,
        requested_end_time,
        stage,
        progress_percent,
        total_count,
        completed_count,
        running_count,
        created_at,
        updated_at
      FROM ops_backtest_batches
      ORDER BY updated_at DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(limit, 500))],
  );

  return result.rows.map(mapBacktestBatchRow);
};

export const getBacktestJob = async (
  pool: Pool,
  id: string,
): Promise<BacktestJobRecord | null> => {
  const result = await pool.query(
    `
      SELECT
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        backtest_id,
        error_message,
        stage,
        progress_percent,
        result_json,
        created_at,
        updated_at,
        started_at,
        finished_at
      FROM ops_backtest_jobs
      WHERE id = $1
    `,
    [id],
  );

  return result.rowCount === 0 ? null : mapBacktestJobRow(result.rows[0]);
};

export const createBacktestJob = async (
  pool: Pool,
  input: BacktestJobInput,
): Promise<BacktestJobRecord> => {
  const result = await pool.query(
    `
      INSERT INTO ops_backtest_jobs (
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        stage,
        progress_percent,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        'queued',
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        'queued',
        0,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        backtest_id,
        error_message,
        stage,
        progress_percent,
        result_json,
        created_at,
        updated_at,
        started_at,
        finished_at
    `,
    [
      randomUUID(),
      input.analysisSettingId,
      input.riskProfileName ?? null,
      input.symbolCode ?? null,
      input.timeframeCode ?? null,
      input.strategyName ?? null,
      input.startTime ?? null,
      input.endTime ?? null,
      input.warmupCandles ?? null,
    ],
  );

  return mapBacktestJobRow(result.rows[0]);
};

export const markBacktestJobRunning = async (
  pool: Pool,
  id: string,
): Promise<BacktestJobRecord | null> => {
  const result = await pool.query(
    `
      UPDATE ops_backtest_jobs
         SET status = 'running',
             stage = 'retrieving-data',
             progress_percent = 0,
             started_at = COALESCE(started_at, NOW()),
             updated_at = NOW(),
             error_message = NULL
       WHERE id = $1
         AND status = 'queued'
      RETURNING
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        backtest_id,
        error_message,
        stage,
        progress_percent,
        result_json,
        created_at,
        updated_at,
        started_at,
        finished_at
    `,
    [id],
  );

  return result.rowCount === 0 ? null : mapBacktestJobRow(result.rows[0]);
};

export const markBacktestJobCompleted = async (
  pool: Pool,
  id: string,
  payload: { backtestId: string; result: Record<string, unknown> },
): Promise<BacktestJobRecord | null> => {
  const result = await pool.query(
    `
      UPDATE ops_backtest_jobs
         SET status = 'completed',
             backtest_id = $2,
             result_json = $3::jsonb,
             stage = 'completed',
             progress_percent = 100,
             finished_at = NOW(),
             updated_at = NOW(),
             error_message = NULL
       WHERE id = $1
      RETURNING
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        backtest_id,
        error_message,
        stage,
        progress_percent,
        result_json,
        created_at,
        updated_at,
        started_at,
        finished_at
    `,
    [id, payload.backtestId, JSON.stringify(payload.result)],
  );

  return result.rowCount === 0 ? null : mapBacktestJobRow(result.rows[0]);
};

export const markBacktestJobFailed = async (
  pool: Pool,
  id: string,
  errorMessage: string,
): Promise<BacktestJobRecord | null> => {
  const result = await pool.query(
    `
      UPDATE ops_backtest_jobs
         SET status = 'failed',
             error_message = $2,
             stage = 'failed',
             finished_at = NOW(),
             updated_at = NOW()
       WHERE id = $1
      RETURNING
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        backtest_id,
        error_message,
        stage,
        progress_percent,
        result_json,
        created_at,
        updated_at,
        started_at,
        finished_at
    `,
    [id, errorMessage],
  );

  return result.rowCount === 0 ? null : mapBacktestJobRow(result.rows[0]);
};

export const updateBacktestJobProgress = async (
  pool: Pool,
  payload: {
    jobId: string;
    stage: string;
    progressPercent: number;
  },
): Promise<BacktestJobRecord | null> => {
  const result = await pool.query(
    `
      UPDATE ops_backtest_jobs
         SET stage = $2,
             progress_percent = LEAST(100, GREATEST(0, $3)),
             updated_at = NOW()
       WHERE id = $1
         AND status IN ('queued', 'running')
      RETURNING
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        backtest_id,
        error_message,
        stage,
        progress_percent,
        result_json,
        created_at,
        updated_at,
        started_at,
        finished_at
    `,
    [payload.jobId, payload.stage, payload.progressPercent],
  );

  return result.rowCount === 0 ? null : mapBacktestJobRow(result.rows[0]);
};

export const upsertBacktestJobFromProgressEvent = async (
  pool: Pool,
  payload: {
    jobId: string;
    analysisSettingId: string;
    riskProfileName: string;
    symbolCode: string;
    timeframeCode: string;
    strategyName: string;
    stage: string;
    progressPercent: number;
  },
): Promise<BacktestJobRecord> => {
  const result = await pool.query(
    `
      INSERT INTO ops_backtest_jobs (
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        stage,
        progress_percent,
        created_at,
        updated_at,
        started_at
      )
      VALUES (
        $1,
        'running',
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        LEAST(100, GREATEST(0, $8)),
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
         SET status = CASE
               WHEN ops_backtest_jobs.status = 'completed' THEN ops_backtest_jobs.status
               WHEN ops_backtest_jobs.status = 'failed' THEN ops_backtest_jobs.status
               ELSE 'running'
             END,
             analysis_setting_id = EXCLUDED.analysis_setting_id,
             risk_profile_name = EXCLUDED.risk_profile_name,
             symbol_code = EXCLUDED.symbol_code,
             timeframe_code = EXCLUDED.timeframe_code,
             strategy_name = EXCLUDED.strategy_name,
             stage = EXCLUDED.stage,
             progress_percent = EXCLUDED.progress_percent,
             started_at = COALESCE(ops_backtest_jobs.started_at, NOW()),
             updated_at = NOW()
      RETURNING
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        backtest_id,
        error_message,
        stage,
        progress_percent,
        result_json,
        created_at,
        updated_at,
        started_at,
        finished_at
    `,
    [
      payload.jobId,
      payload.analysisSettingId,
      payload.riskProfileName,
      payload.symbolCode,
      payload.timeframeCode,
      payload.strategyName,
      payload.stage,
      payload.progressPercent,
    ],
  );

  return mapBacktestJobRow(result.rows[0]);
};

export const upsertBacktestBatchFromProgressEvent = async (
  pool: Pool,
  payload: {
    batchId: string;
    symbolCode: string;
    timeframeCode: string;
    requestedStartTime: number;
    requestedEndTime: number;
    stage: string;
    progressPercent: number;
    totalCount: number;
    completedCount: number;
    runningCount: number;
  },
): Promise<BacktestBatchRecord> => {
  const result = await pool.query(
    `
      INSERT INTO ops_backtest_batches (
        batch_id,
        symbol_code,
        timeframe_code,
        requested_start_time,
        requested_end_time,
        stage,
        progress_percent,
        total_count,
        completed_count,
        running_count,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        LEAST(100, GREATEST(0, $7)),
        GREATEST(0, $8),
        GREATEST(0, $9),
        GREATEST(0, $10),
        NOW(),
        NOW()
      )
      ON CONFLICT (batch_id) DO UPDATE
         SET symbol_code = EXCLUDED.symbol_code,
             timeframe_code = EXCLUDED.timeframe_code,
             requested_start_time = EXCLUDED.requested_start_time,
             requested_end_time = EXCLUDED.requested_end_time,
             stage = EXCLUDED.stage,
             progress_percent = EXCLUDED.progress_percent,
             total_count = EXCLUDED.total_count,
             completed_count = EXCLUDED.completed_count,
             running_count = EXCLUDED.running_count,
             updated_at = NOW()
      RETURNING
        batch_id,
        symbol_code,
        timeframe_code,
        requested_start_time,
        requested_end_time,
        stage,
        progress_percent,
        total_count,
        completed_count,
        running_count,
        created_at,
        updated_at
    `,
    [
      payload.batchId,
      payload.symbolCode,
      payload.timeframeCode,
      payload.requestedStartTime,
      payload.requestedEndTime,
      payload.stage,
      payload.progressPercent,
      payload.totalCount,
      payload.completedCount,
      payload.runningCount,
    ],
  );

  return mapBacktestBatchRow(result.rows[0]);
};

export const completeBacktestJobFromProjectionEvent = async (
  pool: Pool,
  payload: {
    jobId: string;
    backtestId: string;
  },
): Promise<BacktestJobRecord | null> => {
  const result = await pool.query(
    `
      UPDATE ops_backtest_jobs
         SET status = 'completed',
             backtest_id = $2,
             stage = 'completed',
             progress_percent = 100,
             finished_at = COALESCE(finished_at, NOW()),
             updated_at = NOW(),
             error_message = NULL
       WHERE id = $1
      RETURNING
        id,
        status,
        analysis_setting_id,
        risk_profile_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        start_time,
        end_time,
        warmup_candles,
        backtest_id,
        error_message,
        stage,
        progress_percent,
        result_json,
        created_at,
        updated_at,
        started_at,
        finished_at
    `,
    [payload.jobId, payload.backtestId],
  );

  return result.rowCount === 0 ? null : mapBacktestJobRow(result.rows[0]);
};

export const upsertBacktestRunProjection = async (
  pool: Pool,
  input: BacktestRunProjectionInput,
): Promise<BacktestRunProjectionRecord> => {
  const result = await pool.query(
    `
      INSERT INTO ops_backtest_runs (
        backtest_id,
        finished_at,
        backtest_duration_ms,
        data_retrieval_duration_ms,
        analysis_setting_id,
        risk_profile_name,
        symbol,
        timeframe_code,
        strategy_name,
        requested_start_time,
        requested_end_time,
        replay_kline_count,
        replay_trade_count,
        signal_count,
        trade_count,
        total_pnl_percent,
        source_event_id,
        source_occurred_at
      )
      VALUES (
        $1,
        $2::timestamptz,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18::timestamptz
      )
      ON CONFLICT (backtest_id)
      DO UPDATE SET
        finished_at = EXCLUDED.finished_at,
        backtest_duration_ms = EXCLUDED.backtest_duration_ms,
        data_retrieval_duration_ms = EXCLUDED.data_retrieval_duration_ms,
        analysis_setting_id = EXCLUDED.analysis_setting_id,
        risk_profile_name = EXCLUDED.risk_profile_name,
        symbol = EXCLUDED.symbol,
        timeframe_code = EXCLUDED.timeframe_code,
        strategy_name = EXCLUDED.strategy_name,
        requested_start_time = EXCLUDED.requested_start_time,
        requested_end_time = EXCLUDED.requested_end_time,
        replay_kline_count = EXCLUDED.replay_kline_count,
        replay_trade_count = EXCLUDED.replay_trade_count,
        signal_count = EXCLUDED.signal_count,
        trade_count = EXCLUDED.trade_count,
        total_pnl_percent = EXCLUDED.total_pnl_percent,
        source_event_id = EXCLUDED.source_event_id,
        source_occurred_at = EXCLUDED.source_occurred_at,
        updated_at = NOW()
      RETURNING
        backtest_id,
        finished_at,
        backtest_duration_ms,
        data_retrieval_duration_ms,
        analysis_setting_id,
        risk_profile_name,
        symbol,
        timeframe_code,
        strategy_name,
        requested_start_time,
        requested_end_time,
        replay_kline_count,
        replay_trade_count,
        signal_count,
        trade_count,
        total_pnl_percent,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
    `,
    [
      input.backtestId,
      input.finishedAt,
      input.backtestDurationMs,
      input.dataRetrievalDurationMs,
      input.analysisSettingId,
      input.riskProfileName,
      input.symbol,
      input.timeframeCode,
      input.strategyName,
      input.requestedStartTime,
      input.requestedEndTime,
      input.replayKlineCount,
      input.replayTradeCount,
      input.signalCount,
      input.tradeCount,
      input.totalPnlPercent,
      input.sourceEventId,
      input.sourceOccurredAt,
    ],
  );

  return mapBacktestRunProjectionRow(result.rows[0]);
};

export const listBacktestRunProjections = async (
  pool: Pool,
  limit = 100,
): Promise<BacktestRunProjectionRecord[]> => {
  const result = await pool.query(
    `
      SELECT
        backtest_id,
        finished_at,
        backtest_duration_ms,
        data_retrieval_duration_ms,
        analysis_setting_id,
        risk_profile_name,
        symbol,
        timeframe_code,
        strategy_name,
        requested_start_time,
        requested_end_time,
        replay_kline_count,
        replay_trade_count,
        signal_count,
        trade_count,
        total_pnl_percent,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
      FROM ops_backtest_runs
      ORDER BY finished_at DESC, backtest_id DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(limit, 500))],
  );

  return result.rows.map(mapBacktestRunProjectionRow);
};

export const replaceDataReadinessProjections = async (
  pool: Pool,
  items: DataReadinessProjectionInput[],
): Promise<void> => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM ops_data_readiness");

    for (const item of items) {
      await client.query(
        `
          INSERT INTO ops_data_readiness (
            symbol_code,
            timeframe_code,
            status,
            analysis_setting_ids_json,
            requested_start_time,
            requested_end_time,
            required_history_ms,
            completeness_percent,
            details,
            kline_json,
            trades_json,
            source_event_id,
            source_occurred_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4::jsonb,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10::jsonb,
            $11::jsonb,
            $12,
            $13::timestamptz
          )
        `,
        [
          item.symbolCode,
          item.timeframeCode,
          item.status,
          JSON.stringify(item.analysisSettingIds),
          item.requestedStartTime,
          item.requestedEndTime,
          item.requiredHistoryMs,
          item.completenessPercent,
          item.details,
          item.kline === null ? null : JSON.stringify(item.kline),
          item.trades === null ? null : JSON.stringify(item.trades),
          item.sourceEventId,
          item.sourceOccurredAt,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const listDataReadinessProjections = async (
  pool: Pool,
): Promise<DataReadinessProjectionRecord[]> => {
  const result = await pool.query(
    `
      SELECT
        symbol_code,
        timeframe_code,
        status,
        analysis_setting_ids_json,
        requested_start_time,
        requested_end_time,
        required_history_ms,
        completeness_percent,
        details,
        kline_json,
        trades_json,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
      FROM ops_data_readiness
      ORDER BY symbol_code ASC, timeframe_code ASC
    `,
  );

  return result.rows.map(mapDataReadinessProjectionRow);
};
