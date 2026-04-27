import type { Pool, QueryResultRow } from "pg";
import { listResolvedAnalysisSettings } from "./config-resources.js";

export type BacktestJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

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
  stopLossTradeCount: number;
  takeProfitTradeCount: number;
  reversalTradeCount: number;
  windowEndTradeCount: number;
  nonReversalTradeCount: number;
  totalPnlPercent: number;
  equityCurvePnlPercent: number;
  maxDrawdownPercent: number;
  reversalRatio: number;
  score: number;
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
  strategyName: string;
  analysisSettingIds: string[];
  requestedStartTime: number;
  requestedEndTime: number;
  requiredHistoryMs: number;
  details: string | null;
  kline: Record<string, unknown> | null;
  klineDimensions: Record<string, unknown>[] | null;
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

export type ExecutionPromotionProjectionRecord = {
  promotionId: string;
  executionSettingsName: string;
  analysisSettingId: string;
  sourceBacktestId: string | null;
  symbolCode: string;
  timeframeCode: string;
  strategyName: string;
  riskProfileName: string;
  mode: "paper" | "live";
  selectionMetric: string;
  selectionValue: number;
  status: "active" | "superseded";
  promotedAt: string;
  sourceEventId: string | null;
  sourceOccurredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionPromotionProjectionInput = Omit<
  ExecutionPromotionProjectionRecord,
  "createdAt" | "updatedAt"
>;

export type ExecutionTradeRecord = {
  tradeId: string;
  externalOrderId: string | null;
  positionId: string | null;
  sourceBacktestId: string | null;
  analysisSettingId: string;
  executionSettingsName: string | null;
  symbolCode: string;
  timeframeCode: string;
  strategyName: string;
  riskProfileName: string;
  mode: "paper" | "live";
  side: "long" | "short";
  status: "open" | "closed" | "cancelled" | "rejected";
  closeReason: string | null;
  openedAt: string;
  closedAt: string | null;
  durationMs: number | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  notionalUsd: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  realizedPnlPercent: number | null;
  realizedPnlUsd: number | null;
  feesUsd: number;
  sourceEventId: string | null;
  sourceOccurredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionTradeInput = Omit<ExecutionTradeRecord, "createdAt" | "updatedAt">;

export type ExecutionTradeSortField =
  | "openedAt"
  | "closedAt"
  | "realizedPnlPercent"
  | "symbolCode"
  | "notionalUsd";

export type ExecutionTradeQuery = {
  page: number;
  pageSize: number;
  sortBy: ExecutionTradeSortField;
  sortDirection: "asc" | "desc";
  search?: string;
  symbolCode?: string;
  timeframeCode?: string;
  strategyName?: string;
  openedFrom?: string;
  openedTo?: string;
  side?: "long" | "short";
  status?: "open" | "closed" | "cancelled" | "rejected";
  mode?: "paper" | "live";
};

export type PaginatedExecutionTrades = {
  items: ExecutionTradeRecord[];
  totalCount: number;
  realizedPnlUsd: number;
  page: number;
  pageSize: number;
};

type ExecutionSettingsSelectionRecord = {
  name: string;
  mode: "paper" | "live";
  autoPromote: boolean;
  maxPromotions: number;
  replaceOpenPositionPolicy: "keep" | "flatten";
};

export type PromotionReconciliationResult = {
  promotion: ExecutionPromotionProjectionRecord | null;
  changed: boolean;
};

export type StrategyPromotionThresholds = {
  minTradeCount: number | null;
  minTradesPer1000Candles: number | null;
  maxDrawdownPercent: number | null;
  maxReversalRatio: number | null;
};

const selectionMetricName = "score";

const calculatePromotionSelectionValue = (
  run: Pick<
    BacktestRunProjectionInput,
    "score" | "equityCurvePnlPercent" | "maxDrawdownPercent" | "reversalRatio"
  >,
): number =>
  Number.isFinite(run.score)
    ? run.score
    : run.equityCurvePnlPercent - 0.75 * run.maxDrawdownPercent - 12 * run.reversalRatio;

export const hasPositivePromotionSelectionValue = (
  run: Pick<
    BacktestRunProjectionInput,
    "score" | "equityCurvePnlPercent" | "maxDrawdownPercent" | "reversalRatio"
  >,
): boolean => calculatePromotionSelectionValue(run) > 0;

const toNonNegativeIntegerOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const toNonNegativeNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const strategyPromotionThresholdsFromParameters = (
  parameters: Record<string, unknown> | null | undefined,
): StrategyPromotionThresholds => {
  const thresholdsValue = parameters?.promotionThresholds;
  const thresholds =
    typeof thresholdsValue === "object" &&
    thresholdsValue !== null &&
    !Array.isArray(thresholdsValue)
      ? (thresholdsValue as Record<string, unknown>)
      : {};

  return {
    minTradeCount: toNonNegativeIntegerOrNull(thresholds.minTradeCount),
    minTradesPer1000Candles: toNonNegativeNumberOrNull(thresholds.minTradesPer1000Candles),
    maxDrawdownPercent: toNonNegativeNumberOrNull(thresholds.maxDrawdownPercent),
    maxReversalRatio: toNonNegativeNumberOrNull(thresholds.maxReversalRatio),
  };
};

const tradesPer1000Candles = (
  run: Pick<BacktestRunProjectionInput, "tradeCount" | "replayKlineCount">,
): number =>
  run.replayKlineCount > 0 ? (run.tradeCount * 1_000) / run.replayKlineCount : 0;

export const meetsStrategyPromotionThresholds = (
  run: Pick<
    BacktestRunProjectionInput,
    "tradeCount" | "replayKlineCount" | "maxDrawdownPercent" | "reversalRatio"
  >,
  parameters: Record<string, unknown> | null | undefined,
): boolean => {
  const thresholds = strategyPromotionThresholdsFromParameters(parameters);
  if (
    thresholds.minTradeCount === null ||
    thresholds.minTradesPer1000Candles === null ||
    thresholds.maxDrawdownPercent === null ||
    thresholds.maxReversalRatio === null
  ) {
    return false;
  }

  if (run.tradeCount < thresholds.minTradeCount) {
    return false;
  }

  if (tradesPer1000Candles(run) < thresholds.minTradesPer1000Candles) {
    return false;
  }

  if (run.maxDrawdownPercent > thresholds.maxDrawdownPercent) {
    return false;
  }

  if (run.reversalRatio > thresholds.maxReversalRatio) {
    return false;
  }

  return true;
};

const isZeroReadinessDimension = (
  value: Record<string, unknown> | null,
): boolean => {
  if (value === null) {
    return false;
  }

  return (
    Number(value.rowCount ?? 0) === 0 &&
    Number(value.missingCount ?? 0) === 0 &&
    Number(value.coveragePercent ?? 0) === 0 &&
    value.minTime === null &&
    value.maxTime === null &&
    value.latestTime === null &&
    value.complete === false
  );
};

const isEmptyBootstrapLikeDataReadinessProjection = (
  item: DataReadinessProjectionInput,
): boolean =>
  (item.status === "partial"
    ? item.details === null
    : item.status === "error") &&
  isZeroReadinessDimension(item.kline) &&
  isZeroReadinessDimension(item.trades);

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
  stopLossTradeCount: Number(row.stop_loss_trade_count ?? 0),
  takeProfitTradeCount: Number(row.take_profit_trade_count ?? 0),
  reversalTradeCount: Number(row.reversal_trade_count ?? 0),
  windowEndTradeCount: Number(row.window_end_trade_count ?? 0),
  nonReversalTradeCount: Number(row.non_reversal_trade_count ?? 0),
  totalPnlPercent: Number(row.total_pnl_percent),
  equityCurvePnlPercent: Number(row.equity_curve_pnl_percent ?? 0),
  maxDrawdownPercent: Number(row.max_drawdown_percent ?? 0),
  reversalRatio: Number(row.reversal_ratio ?? 0),
  score: Number(row.score ?? 0),
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
  strategyName: String(row.strategy_name),
  analysisSettingIds: mapStringArray(row.analysis_setting_ids_json),
  requestedStartTime: Number(row.requested_start_time),
  requestedEndTime: Number(row.requested_end_time),
  requiredHistoryMs: Number(row.required_history_ms),
  details: row.details === null ? null : String(row.details),
  kline: parseJsonObject(row.kline_json),
  klineDimensions: Array.isArray(row.kline_dimensions_json)
    ? row.kline_dimensions_json
        .filter((value): value is Record<string, unknown> =>
          typeof value === "object" && value !== null && !Array.isArray(value),
        )
    : null,
  trades: parseJsonObject(row.trades_json),
  sourceEventId: String(row.source_event_id),
  sourceOccurredAt:
    toIsoString(row.source_occurred_at) ?? new Date(0).toISOString(),
  createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
});

const mapExecutionPromotionProjectionRow = (
  row: QueryResultRow,
): ExecutionPromotionProjectionRecord => ({
  promotionId: String(row.promotion_id),
  executionSettingsName: String(row.execution_settings_name),
  analysisSettingId: String(row.analysis_setting_id),
  sourceBacktestId:
    row.source_backtest_id === null ? null : String(row.source_backtest_id),
  symbolCode: String(row.symbol_code),
  timeframeCode: String(row.timeframe_code),
  strategyName: String(row.strategy_name),
  riskProfileName: String(row.risk_profile_name),
  mode: row.mode === "live" ? "live" : "paper",
  selectionMetric: String(row.selection_metric),
  selectionValue: Number(row.selection_value),
  status: row.status === "superseded" ? "superseded" : "active",
  promotedAt: toIsoString(row.promoted_at) ?? new Date(0).toISOString(),
  sourceEventId:
    row.source_event_id === null ? null : String(row.source_event_id),
  sourceOccurredAt: row.source_occurred_at === null ? null : toIsoString(row.source_occurred_at),
  createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
});

const mapExecutionTradeRow = (row: QueryResultRow): ExecutionTradeRecord => ({
  tradeId: String(row.trade_id),
  externalOrderId:
    row.external_order_id === null ? null : String(row.external_order_id),
  positionId: row.position_id === null ? null : String(row.position_id),
  sourceBacktestId:
    row.source_backtest_id === null ? null : String(row.source_backtest_id),
  analysisSettingId: String(row.analysis_setting_id),
  executionSettingsName:
    row.execution_settings_name === null ? null : String(row.execution_settings_name),
  symbolCode: String(row.symbol_code),
  timeframeCode: String(row.timeframe_code),
  strategyName: String(row.strategy_name),
  riskProfileName: String(row.risk_profile_name),
  mode: row.mode === "live" ? "live" : "paper",
  side: row.side === "short" ? "short" : "long",
  status:
    row.status === "closed" ||
    row.status === "cancelled" ||
    row.status === "rejected"
      ? row.status
      : "open",
  closeReason: row.close_reason === null ? null : String(row.close_reason),
  openedAt: toIsoString(row.opened_at) ?? new Date(0).toISOString(),
  closedAt: row.closed_at === null ? null : toIsoString(row.closed_at),
  durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
  entryPrice: Number(row.entry_price),
  exitPrice: row.exit_price === null ? null : Number(row.exit_price),
  quantity: Number(row.quantity),
  notionalUsd: Number(row.notional_usd),
  stopLossPrice:
    row.stop_loss_price === null ? null : Number(row.stop_loss_price),
  takeProfitPrice:
    row.take_profit_price === null ? null : Number(row.take_profit_price),
  realizedPnlPercent:
    row.realized_pnl_percent === null ? null : Number(row.realized_pnl_percent),
  realizedPnlUsd: row.realized_pnl_usd === null ? null : Number(row.realized_pnl_usd),
  feesUsd: Number(row.fees_usd),
  sourceEventId:
    row.source_event_id === null ? null : String(row.source_event_id),
  sourceOccurredAt: row.source_occurred_at === null ? null : toIsoString(row.source_occurred_at),
  createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  updatedAt: toIsoString(row.updated_at) ?? new Date(0).toISOString(),
});

const mapExecutionSettingsSelectionRow = (
  row: QueryResultRow,
): ExecutionSettingsSelectionRecord => ({
  name: String(row.name),
  mode: row.mode === "live" ? "live" : "paper",
  autoPromote: Boolean(row.auto_promote),
  maxPromotions: Number(row.max_promotions),
  replaceOpenPositionPolicy:
    row.replace_open_position_policy === "keep" ? "keep" : "flatten",
});

const hasSamePromotionContext = (
  promotion: Pick<
    ExecutionPromotionProjectionRecord,
    | "executionSettingsName"
    | "analysisSettingId"
    | "symbolCode"
    | "timeframeCode"
    | "strategyName"
    | "riskProfileName"
    | "mode"
  >,
  run: Pick<
    BacktestRunProjectionInput,
    "analysisSettingId" | "symbol" | "timeframeCode" | "strategyName" | "riskProfileName"
  >,
  executionSettingsName: string,
  mode: "paper" | "live",
): boolean =>
  promotion.executionSettingsName === executionSettingsName &&
  promotion.analysisSettingId === run.analysisSettingId &&
  promotion.symbolCode === run.symbol &&
  promotion.timeframeCode === run.timeframeCode &&
  promotion.strategyName === run.strategyName &&
  promotion.riskProfileName === run.riskProfileName &&
  promotion.mode === mode;

const supersedeActivePromotionsForContext = async (
  queryable: Pick<Pool, "query">,
  context: Pick<
    BacktestRunProjectionInput,
    "analysisSettingId" | "symbol" | "timeframeCode" | "strategyName" | "riskProfileName"
  >,
  executionSettingsName: string,
  mode: "paper" | "live",
): Promise<boolean> => {
  const result = await queryable.query(
    `
      UPDATE ops_execution_promotions
         SET status = 'superseded',
             updated_at = NOW()
       WHERE status = 'active'
         AND execution_settings_name = $1
         AND analysis_setting_id = $2
         AND symbol_code = $3
         AND timeframe_code = $4
         AND strategy_name = $5
         AND risk_profile_name = $6
         AND mode = $7
    `,
    [
      executionSettingsName,
      context.analysisSettingId,
      context.symbol,
      context.timeframeCode,
      context.strategyName,
      context.riskProfileName,
      mode,
    ],
  );

  return Number(result.rowCount ?? 0) > 0;
};

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
      stop_loss_trade_count INTEGER NOT NULL DEFAULT 0,
      take_profit_trade_count INTEGER NOT NULL DEFAULT 0,
      reversal_trade_count INTEGER NOT NULL DEFAULT 0,
      window_end_trade_count INTEGER NOT NULL DEFAULT 0,
      non_reversal_trade_count INTEGER NOT NULL DEFAULT 0,
      total_pnl_percent DOUBLE PRECISION NOT NULL,
      equity_curve_pnl_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
      max_drawdown_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
      reversal_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
      score DOUBLE PRECISION NOT NULL DEFAULT 0,
      source_event_id TEXT NOT NULL,
      source_occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE ops_backtest_runs
      ADD COLUMN IF NOT EXISTS stop_loss_trade_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS take_profit_trade_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reversal_trade_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS window_end_trade_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS non_reversal_trade_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS equity_curve_pnl_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS max_drawdown_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS reversal_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS score DOUBLE PRECISION NOT NULL DEFAULT 0
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
      strategy_name TEXT NOT NULL,
      status TEXT NOT NULL,
      analysis_setting_ids_json JSONB NOT NULL,
      requested_start_time BIGINT NOT NULL,
      requested_end_time BIGINT NOT NULL,
      required_history_ms BIGINT NOT NULL,
      details TEXT,
      kline_json JSONB,
      kline_dimensions_json JSONB,
      trades_json JSONB,
      source_event_id TEXT NOT NULL,
      source_occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (symbol_code, timeframe_code, strategy_name),
      CONSTRAINT ops_data_readiness_status_valid
        CHECK (status IN ('ready', 'partial', 'missing', 'error'))
    );
  `);

  await pool.query(`
    ALTER TABLE ops_data_readiness
      ADD COLUMN IF NOT EXISTS strategy_name TEXT
  `);

  await pool.query(`
    ALTER TABLE ops_data_readiness
      ADD COLUMN IF NOT EXISTS kline_dimensions_json JSONB
  `);

  await pool.query(`
    DELETE FROM ops_data_readiness
     WHERE strategy_name IS NULL OR strategy_name = ''
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ops_data_readiness_pkey'
          AND conrelid = 'ops_data_readiness'::regclass
      ) THEN
        ALTER TABLE ops_data_readiness DROP CONSTRAINT ops_data_readiness_pkey;
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE ops_data_readiness
      ADD PRIMARY KEY (symbol_code, timeframe_code, strategy_name)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_execution_promotions (
      promotion_id TEXT PRIMARY KEY,
      execution_settings_name TEXT NOT NULL,
      analysis_setting_id TEXT NOT NULL,
      source_backtest_id TEXT,
      symbol_code TEXT NOT NULL,
      timeframe_code TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      risk_profile_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      selection_metric TEXT NOT NULL,
      selection_value DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      promoted_at TIMESTAMPTZ NOT NULL,
      source_event_id TEXT,
      source_occurred_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ops_execution_promotions_mode_valid
        CHECK (mode IN ('paper', 'live')),
      CONSTRAINT ops_execution_promotions_status_valid
        CHECK (status IN ('active', 'superseded'))
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops_execution_trades (
      trade_id TEXT PRIMARY KEY,
      external_order_id TEXT,
      position_id TEXT,
      source_backtest_id TEXT,
      analysis_setting_id TEXT NOT NULL,
      execution_settings_name TEXT,
      symbol_code TEXT NOT NULL,
      timeframe_code TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      risk_profile_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      side TEXT NOT NULL,
      status TEXT NOT NULL,
      close_reason TEXT,
      opened_at TIMESTAMPTZ NOT NULL,
      closed_at TIMESTAMPTZ,
      duration_ms BIGINT,
      entry_price DOUBLE PRECISION NOT NULL,
      exit_price DOUBLE PRECISION,
      quantity DOUBLE PRECISION NOT NULL,
      notional_usd DOUBLE PRECISION NOT NULL,
      stop_loss_price DOUBLE PRECISION,
      take_profit_price DOUBLE PRECISION,
      realized_pnl_percent DOUBLE PRECISION,
      realized_pnl_usd DOUBLE PRECISION,
      fees_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      source_event_id TEXT,
      source_occurred_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ops_execution_trades_mode_valid
        CHECK (mode IN ('paper', 'live')),
      CONSTRAINT ops_execution_trades_side_valid
        CHECK (side IN ('long', 'short')),
      CONSTRAINT ops_execution_trades_status_valid
        CHECK (status IN ('open', 'closed', 'cancelled', 'rejected'))
    );
  `);

  await pool.query(`
    ALTER TABLE ops_execution_trades
      ADD COLUMN IF NOT EXISTS close_reason TEXT
  `);

  await pool.query(`
    ALTER TABLE ops_data_readiness
      DROP COLUMN IF EXISTS completeness_percent
  `);

  await pool.query(`
    ALTER TABLE ops_data_readiness
      DROP COLUMN IF EXISTS book_tickers_json
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
  const normalizedProgressPercent = Number.isFinite(payload.progressPercent)
    ? Math.min(100, Math.max(0, payload.progressPercent))
    : 0;
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
      normalizedProgressPercent,
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
        stop_loss_trade_count,
        take_profit_trade_count,
        reversal_trade_count,
        window_end_trade_count,
        non_reversal_trade_count,
        total_pnl_percent,
        equity_curve_pnl_percent,
        max_drawdown_percent,
        reversal_ratio,
        score,
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
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24,
        $25,
        $26,
        $27::timestamptz
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
        stop_loss_trade_count = EXCLUDED.stop_loss_trade_count,
        take_profit_trade_count = EXCLUDED.take_profit_trade_count,
        reversal_trade_count = EXCLUDED.reversal_trade_count,
        window_end_trade_count = EXCLUDED.window_end_trade_count,
        non_reversal_trade_count = EXCLUDED.non_reversal_trade_count,
        total_pnl_percent = EXCLUDED.total_pnl_percent,
        equity_curve_pnl_percent = EXCLUDED.equity_curve_pnl_percent,
        max_drawdown_percent = EXCLUDED.max_drawdown_percent,
        reversal_ratio = EXCLUDED.reversal_ratio,
        score = EXCLUDED.score,
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
        stop_loss_trade_count,
        take_profit_trade_count,
        reversal_trade_count,
        window_end_trade_count,
        non_reversal_trade_count,
        total_pnl_percent,
        equity_curve_pnl_percent,
        max_drawdown_percent,
        reversal_ratio,
        score,
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
      input.stopLossTradeCount,
      input.takeProfitTradeCount,
      input.reversalTradeCount,
      input.windowEndTradeCount,
      input.nonReversalTradeCount,
      input.totalPnlPercent,
      input.equityCurvePnlPercent,
      input.maxDrawdownPercent,
      input.reversalRatio,
      input.score,
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
        stop_loss_trade_count,
        take_profit_trade_count,
        reversal_trade_count,
        window_end_trade_count,
        non_reversal_trade_count,
        total_pnl_percent,
        equity_curve_pnl_percent,
        max_drawdown_percent,
        reversal_ratio,
        score,
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

export const listLatestBacktestRunProjections = async (
  pool: Pool,
  limit = 500,
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
        stop_loss_trade_count,
        take_profit_trade_count,
        reversal_trade_count,
        window_end_trade_count,
        non_reversal_trade_count,
        total_pnl_percent,
        equity_curve_pnl_percent,
        max_drawdown_percent,
        reversal_ratio,
        score,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
      FROM (
        SELECT DISTINCT ON (
          symbol,
          timeframe_code,
          analysis_setting_id,
          risk_profile_name,
          strategy_name
        )
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
          stop_loss_trade_count,
          take_profit_trade_count,
          reversal_trade_count,
          window_end_trade_count,
          non_reversal_trade_count,
          total_pnl_percent,
          equity_curve_pnl_percent,
          max_drawdown_percent,
          reversal_ratio,
          score,
          source_event_id,
          source_occurred_at,
          created_at,
          updated_at
        FROM ops_backtest_runs
        ORDER BY
          symbol ASC,
          timeframe_code ASC,
          analysis_setting_id ASC,
          risk_profile_name ASC,
          strategy_name ASC,
          finished_at DESC,
          backtest_id DESC
      ) latest_runs
      ORDER BY finished_at DESC, backtest_id DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(limit, 2_000))],
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

    if (items.length === 0) {
      await client.query("DELETE FROM ops_data_readiness");
      await client.query("COMMIT");
      return;
    }

    for (const item of items) {
      const isPlaceholder = isEmptyBootstrapLikeDataReadinessProjection(item);
      await client.query(
        `
          INSERT INTO ops_data_readiness (
            symbol_code,
            timeframe_code,
            strategy_name,
            status,
            analysis_setting_ids_json,
            requested_start_time,
            requested_end_time,
            required_history_ms,
            details,
            kline_json,
            kline_dimensions_json,
            trades_json,
            source_event_id,
            source_occurred_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5::jsonb,
            $6,
            $7,
            $8,
            $9,
            $10::jsonb,
            $11::jsonb,
            $12::jsonb,
            $13,
            $14::timestamptz
          )
          ON CONFLICT (symbol_code, timeframe_code, strategy_name) DO UPDATE
             SET status = EXCLUDED.status,
                 analysis_setting_ids_json = EXCLUDED.analysis_setting_ids_json,
                 requested_start_time = EXCLUDED.requested_start_time,
                 requested_end_time = EXCLUDED.requested_end_time,
                 required_history_ms = EXCLUDED.required_history_ms,
                 details = EXCLUDED.details,
                 kline_json = EXCLUDED.kline_json,
                 kline_dimensions_json = EXCLUDED.kline_dimensions_json,
                 trades_json = EXCLUDED.trades_json,
                 source_event_id = EXCLUDED.source_event_id,
                 source_occurred_at = EXCLUDED.source_occurred_at,
                 updated_at = NOW()
           WHERE ops_data_readiness.source_occurred_at <= EXCLUDED.source_occurred_at
             AND (
               NOT $15::boolean
               OR (
                 COALESCE((ops_data_readiness.kline_json->>'rowCount')::bigint, 0) = 0
                 AND COALESCE((ops_data_readiness.trades_json->>'rowCount')::bigint, 0) = 0
               )
             )
        `,
        [
          item.symbolCode,
          item.timeframeCode,
          item.strategyName,
          item.status,
          JSON.stringify(item.analysisSettingIds),
          item.requestedStartTime,
          item.requestedEndTime,
          item.requiredHistoryMs,
          item.details,
          item.kline === null ? null : JSON.stringify(item.kline),
          item.klineDimensions === null ? null : JSON.stringify(item.klineDimensions),
          item.trades === null ? null : JSON.stringify(item.trades),
          item.sourceEventId,
          item.sourceOccurredAt,
          isPlaceholder,
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
  filters: {
    strategyName?: string;
  } = {},
): Promise<DataReadinessProjectionRecord[]> => {
  const values: unknown[] = [];
  const whereClauses: string[] = [];

  if (filters.strategyName?.trim()) {
    values.push(filters.strategyName.trim());
    whereClauses.push(`strategy_name = $${values.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        symbol_code,
        timeframe_code,
        strategy_name,
        status,
        analysis_setting_ids_json,
        requested_start_time,
        requested_end_time,
        required_history_ms,
        details,
        kline_json,
        kline_dimensions_json,
        trades_json,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
      FROM ops_data_readiness
      ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY symbol_code ASC, timeframe_code ASC, strategy_name ASC
    `,
    values,
  );

  return result.rows.map(mapDataReadinessProjectionRow);
};

export const upsertExecutionPromotionProjection = async (
  pool: Pool,
  input: ExecutionPromotionProjectionInput,
): Promise<ExecutionPromotionProjectionRecord> => {
  const result = await pool.query(
    `
      INSERT INTO ops_execution_promotions (
        promotion_id,
        execution_settings_name,
        analysis_setting_id,
        source_backtest_id,
        symbol_code,
        timeframe_code,
        strategy_name,
        risk_profile_name,
        mode,
        selection_metric,
        selection_value,
        status,
        promoted_at,
        source_event_id,
        source_occurred_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14, $15::timestamptz
      )
      ON CONFLICT (promotion_id) DO UPDATE
         SET execution_settings_name = EXCLUDED.execution_settings_name,
             analysis_setting_id = EXCLUDED.analysis_setting_id,
             source_backtest_id = EXCLUDED.source_backtest_id,
             symbol_code = EXCLUDED.symbol_code,
             timeframe_code = EXCLUDED.timeframe_code,
             strategy_name = EXCLUDED.strategy_name,
             risk_profile_name = EXCLUDED.risk_profile_name,
             mode = EXCLUDED.mode,
             selection_metric = EXCLUDED.selection_metric,
             selection_value = EXCLUDED.selection_value,
             status = EXCLUDED.status,
             promoted_at = EXCLUDED.promoted_at,
             source_event_id = EXCLUDED.source_event_id,
             source_occurred_at = EXCLUDED.source_occurred_at,
             updated_at = NOW()
      RETURNING
        promotion_id,
        execution_settings_name,
        analysis_setting_id,
        source_backtest_id,
        symbol_code,
        timeframe_code,
        strategy_name,
        risk_profile_name,
        mode,
        selection_metric,
        selection_value,
        status,
        promoted_at,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
    `,
    [
      input.promotionId,
      input.executionSettingsName,
      input.analysisSettingId,
      input.sourceBacktestId,
      input.symbolCode,
      input.timeframeCode,
      input.strategyName,
      input.riskProfileName,
      input.mode,
      input.selectionMetric,
      input.selectionValue,
      input.status,
      input.promotedAt,
      input.sourceEventId,
      input.sourceOccurredAt,
    ],
  );

  return mapExecutionPromotionProjectionRow(result.rows[0]);
};

export const getActiveExecutionPromotion = async (
  pool: Pool,
): Promise<ExecutionPromotionProjectionRecord | null> => {
  const result = await pool.query(
    `
      SELECT
        promotion_id,
        execution_settings_name,
        analysis_setting_id,
        source_backtest_id,
        symbol_code,
        timeframe_code,
        strategy_name,
        risk_profile_name,
        mode,
        selection_metric,
        selection_value,
        status,
        promoted_at,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
      FROM ops_execution_promotions
      WHERE status = 'active'
      ORDER BY promoted_at DESC, promotion_id DESC
      LIMIT 1
    `,
  );

  return result.rowCount === 0 ? null : mapExecutionPromotionProjectionRow(result.rows[0]);
};

export const listActiveExecutionPromotions = async (
  pool: Pool,
  limit = 20,
): Promise<ExecutionPromotionProjectionRecord[]> => {
  const result = await pool.query(
    `
      SELECT
        promotion_id,
        execution_settings_name,
        analysis_setting_id,
        source_backtest_id,
        symbol_code,
        timeframe_code,
        strategy_name,
        risk_profile_name,
        mode,
        selection_metric,
        selection_value,
        status,
        promoted_at,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
      FROM ops_execution_promotions
      WHERE status = 'active'
      ORDER BY selection_value DESC, promoted_at DESC, promotion_id DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(limit, 100))],
  );

  return result.rows.map(mapExecutionPromotionProjectionRow);
};

export const upsertExecutionTradeProjection = async (
  pool: Pool,
  input: ExecutionTradeInput,
): Promise<ExecutionTradeRecord> => {
  const result = await pool.query(
    `
      INSERT INTO ops_execution_trades (
        trade_id,
        external_order_id,
        position_id,
        source_backtest_id,
        analysis_setting_id,
        execution_settings_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        risk_profile_name,
        mode,
        side,
        status,
        close_reason,
        opened_at,
        closed_at,
        duration_ms,
        entry_price,
        exit_price,
        quantity,
        notional_usd,
        stop_loss_price,
        take_profit_price,
        realized_pnl_percent,
        realized_pnl_usd,
        fees_usd,
        source_event_id,
        source_occurred_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15::timestamptz, $16::timestamptz, $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26, $27, $28::timestamptz
      )
      ON CONFLICT (trade_id) DO UPDATE
         SET external_order_id = EXCLUDED.external_order_id,
             position_id = EXCLUDED.position_id,
             source_backtest_id = EXCLUDED.source_backtest_id,
             analysis_setting_id = EXCLUDED.analysis_setting_id,
             execution_settings_name = EXCLUDED.execution_settings_name,
             symbol_code = EXCLUDED.symbol_code,
             timeframe_code = EXCLUDED.timeframe_code,
             strategy_name = EXCLUDED.strategy_name,
             risk_profile_name = EXCLUDED.risk_profile_name,
             mode = EXCLUDED.mode,
             side = EXCLUDED.side,
             status = EXCLUDED.status,
             close_reason = EXCLUDED.close_reason,
             opened_at = EXCLUDED.opened_at,
             closed_at = EXCLUDED.closed_at,
             duration_ms = EXCLUDED.duration_ms,
             entry_price = EXCLUDED.entry_price,
             exit_price = EXCLUDED.exit_price,
             quantity = EXCLUDED.quantity,
             notional_usd = EXCLUDED.notional_usd,
             stop_loss_price = EXCLUDED.stop_loss_price,
             take_profit_price = EXCLUDED.take_profit_price,
             realized_pnl_percent = EXCLUDED.realized_pnl_percent,
             realized_pnl_usd = EXCLUDED.realized_pnl_usd,
             fees_usd = EXCLUDED.fees_usd,
             source_event_id = EXCLUDED.source_event_id,
             source_occurred_at = EXCLUDED.source_occurred_at,
             updated_at = NOW()
      RETURNING
        trade_id,
        external_order_id,
        position_id,
        source_backtest_id,
        analysis_setting_id,
        execution_settings_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        risk_profile_name,
        mode,
        side,
        status,
        close_reason,
        opened_at,
        closed_at,
        duration_ms,
        entry_price,
        exit_price,
        quantity,
        notional_usd,
        stop_loss_price,
        take_profit_price,
        realized_pnl_percent,
        realized_pnl_usd,
        fees_usd,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
    `,
    [
      input.tradeId,
      input.externalOrderId,
      input.positionId,
      input.sourceBacktestId,
      input.analysisSettingId,
      input.executionSettingsName,
      input.symbolCode,
      input.timeframeCode,
      input.strategyName,
      input.riskProfileName,
      input.mode,
      input.side,
      input.status,
      input.closeReason,
      input.openedAt,
      input.closedAt,
      input.durationMs,
      input.entryPrice,
      input.exitPrice,
      input.quantity,
      input.notionalUsd,
      input.stopLossPrice,
      input.takeProfitPrice,
      input.realizedPnlPercent,
      input.realizedPnlUsd,
      input.feesUsd,
      input.sourceEventId,
      input.sourceOccurredAt,
    ],
  );

  return mapExecutionTradeRow(result.rows[0]);
};

export const listExecutionTrades = async (
  pool: Pool,
  query: ExecutionTradeQuery,
): Promise<PaginatedExecutionTrades> => {
  const whereClauses: string[] = [];
  const params: unknown[] = [];
  const pushParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.search?.trim()) {
    const param = pushParam(`%${query.search.trim().toLowerCase()}%`);
    whereClauses.push(
      `(LOWER(trade_id) LIKE ${param}
        OR LOWER(COALESCE(external_order_id, '')) LIKE ${param}
        OR LOWER(COALESCE(source_backtest_id, '')) LIKE ${param}
        OR LOWER(analysis_setting_id) LIKE ${param})`,
    );
  }

  if (query.symbolCode) {
    whereClauses.push(`symbol_code = ${pushParam(query.symbolCode)}`);
  }
  if (query.timeframeCode) {
    whereClauses.push(`timeframe_code = ${pushParam(query.timeframeCode)}`);
  }
  if (query.strategyName) {
    whereClauses.push(`strategy_name = ${pushParam(query.strategyName)}`);
  }
  if (query.openedFrom) {
    whereClauses.push(`opened_at >= ${pushParam(query.openedFrom)}`);
  }
  if (query.openedTo) {
    whereClauses.push(`opened_at <= ${pushParam(query.openedTo)}`);
  }
  if (query.side) {
    whereClauses.push(`side = ${pushParam(query.side)}`);
  }
  if (query.status) {
    whereClauses.push(`status = ${pushParam(query.status)}`);
  }
  if (query.mode) {
    whereClauses.push(`mode = ${pushParam(query.mode)}`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const sortColumnByField: Record<ExecutionTradeSortField, string> = {
    openedAt: "opened_at",
    closedAt: "closed_at",
    realizedPnlPercent: "realized_pnl_percent",
    symbolCode: "symbol_code",
    notionalUsd: "notional_usd",
  };
  const sortColumn = sortColumnByField[query.sortBy] ?? "opened_at";
  const sortDirection = query.sortDirection === "asc" ? "ASC" : "DESC";
  const pageSize = Math.max(1, Math.min(query.pageSize, 100));
  const page = Math.max(1, query.page);
  const offset = (page - 1) * pageSize;

  const aggregateResult = await pool.query(
    `
      SELECT
        COUNT(*)::bigint AS total_count,
        COALESCE(SUM(realized_pnl_usd), 0)::double precision AS realized_pnl_usd
      FROM ops_execution_trades
      ${whereSql}
    `,
    params,
  );

  const rowsResult = await pool.query(
    `
      SELECT
        trade_id,
        external_order_id,
        position_id,
        source_backtest_id,
        analysis_setting_id,
        execution_settings_name,
        symbol_code,
        timeframe_code,
        strategy_name,
        risk_profile_name,
        mode,
        side,
        status,
        close_reason,
        opened_at,
        closed_at,
        duration_ms,
        entry_price,
        exit_price,
        quantity,
        notional_usd,
        stop_loss_price,
        take_profit_price,
        realized_pnl_percent,
        realized_pnl_usd,
        fees_usd,
        source_event_id,
        source_occurred_at,
        created_at,
        updated_at
      FROM ops_execution_trades
      ${whereSql}
      ORDER BY ${sortColumn} ${sortDirection}, trade_id DESC
      LIMIT ${pushParam(pageSize)}
      OFFSET ${pushParam(offset)}
    `,
    params,
  );

  return {
    items: rowsResult.rows.map(mapExecutionTradeRow),
    totalCount: Number(aggregateResult.rows[0]?.total_count ?? 0),
    realizedPnlUsd: Number(aggregateResult.rows[0]?.realized_pnl_usd ?? 0),
    page,
    pageSize,
  };
};

export const getAutoPromoteExecutionSettings = async (
  pool: Pool,
): Promise<ExecutionSettingsSelectionRecord | null> => {
  const result = await pool.query(
    `
      SELECT
        name,
        mode,
        auto_promote,
        max_promotions,
        replace_open_position_policy,
        updated_at
      FROM execution_settings
      WHERE enabled = TRUE
        AND auto_promote = TRUE
      ORDER BY updated_at DESC, name ASC
      LIMIT 1
    `,
  );

  return result.rowCount === 0
    ? null
    : mapExecutionSettingsSelectionRow(result.rows[0]);
};

export const promoteBacktestRunIfEligible = async (
  pool: Pool,
  run: BacktestRunProjectionInput,
): Promise<PromotionReconciliationResult> => {
  const settings = await getAutoPromoteExecutionSettings(pool);
  if (!settings) {
    return {
      promotion: null,
      changed: false,
    };
  }

  const selectionValue = calculatePromotionSelectionValue(run);
  if (!hasPositivePromotionSelectionValue(run)) {
    return {
      promotion: null,
      changed: await supersedeActivePromotionsForContext(
        pool,
        run,
        settings.name,
        settings.mode,
      ),
    };
  }
  const eligibleAnalyses = await listResolvedAnalysisSettings(pool);
  const eligibleAnalysis = eligibleAnalyses.find(
    (analysis) =>
      analysis.id === run.analysisSettingId &&
      analysis.symbolCode === run.symbol &&
      analysis.timeframeCode === run.timeframeCode &&
      analysis.riskProfileName === run.riskProfileName,
  );
  if (!eligibleAnalysis) {
    return {
      promotion: null,
      changed: await supersedeActivePromotionsForContext(
        pool,
        run,
        settings.name,
        settings.mode,
      ),
    };
  }
  if (
    !meetsStrategyPromotionThresholds(
      run,
      eligibleAnalysis.strategy.parameters,
    )
  ) {
    return {
      promotion: null,
      changed: await supersedeActivePromotionsForContext(
        pool,
        run,
        settings.name,
        settings.mode,
      ),
    };
  }

  const activePromotions = await listActiveExecutionPromotions(
    pool,
    settings.maxPromotions + 10,
  );
  if (activePromotions.some((promotion) => promotion.sourceBacktestId === run.backtestId)) {
    return {
      promotion: null,
      changed: false,
    };
  }
  const sameContextPromotions = activePromotions.filter((promotion) =>
    hasSamePromotionContext(promotion, run, settings.name, settings.mode),
  );
  const competingPromotions = activePromotions.filter(
    (promotion) => !hasSamePromotionContext(promotion, run, settings.name, settings.mode),
  );
  const lowestCompetingPromotion =
    competingPromotions[competingPromotions.length - 1] ?? null;
  if (
    sameContextPromotions.length === 0 &&
    competingPromotions.length >= settings.maxPromotions &&
    lowestCompetingPromotion &&
    lowestCompetingPromotion.selectionValue >= selectionValue
  ) {
    return {
      promotion: null,
      changed: false,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
        INSERT INTO ops_execution_promotions (
          promotion_id,
          execution_settings_name,
          analysis_setting_id,
          source_backtest_id,
          symbol_code,
          timeframe_code,
          strategy_name,
          risk_profile_name,
          mode,
          selection_metric,
          selection_value,
          status,
          promoted_at,
          source_event_id,
          source_occurred_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', NOW(), $12, $13::timestamptz
        )
        ON CONFLICT (promotion_id) DO UPDATE
          SET execution_settings_name = EXCLUDED.execution_settings_name,
              analysis_setting_id = EXCLUDED.analysis_setting_id,
              source_backtest_id = EXCLUDED.source_backtest_id,
              symbol_code = EXCLUDED.symbol_code,
              timeframe_code = EXCLUDED.timeframe_code,
              strategy_name = EXCLUDED.strategy_name,
              risk_profile_name = EXCLUDED.risk_profile_name,
              mode = EXCLUDED.mode,
              selection_metric = EXCLUDED.selection_metric,
              selection_value = EXCLUDED.selection_value,
              status = 'active',
              promoted_at = NOW(),
              source_event_id = EXCLUDED.source_event_id,
              source_occurred_at = EXCLUDED.source_occurred_at,
              updated_at = NOW()
        RETURNING
          promotion_id,
          execution_settings_name,
          analysis_setting_id,
          source_backtest_id,
          symbol_code,
          timeframe_code,
          strategy_name,
          risk_profile_name,
          mode,
          selection_metric,
          selection_value,
          status,
          promoted_at,
          source_event_id,
          source_occurred_at,
          created_at,
          updated_at
      `,
      [
        `promotion:${settings.name}:${run.backtestId}`,
        settings.name,
        run.analysisSettingId,
        run.backtestId,
        run.symbol,
        run.timeframeCode,
        run.strategyName,
        run.riskProfileName,
        settings.mode,
        selectionMetricName,
        selectionValue,
        run.sourceEventId,
        run.sourceOccurredAt,
      ],
    );

    await client.query(
      `
        UPDATE ops_execution_promotions
           SET status = 'superseded',
               updated_at = NOW()
         WHERE status = 'active'
           AND promotion_id <> $1
           AND execution_settings_name = $2
           AND analysis_setting_id = $3
           AND symbol_code = $4
           AND timeframe_code = $5
           AND strategy_name = $6
           AND risk_profile_name = $7
           AND mode = $8
      `,
      [
        `promotion:${settings.name}:${run.backtestId}`,
        settings.name,
        run.analysisSettingId,
        run.symbol,
        run.timeframeCode,
        run.strategyName,
        run.riskProfileName,
        settings.mode,
      ],
    );

    await client.query(
      `
        UPDATE ops_execution_promotions
           SET status = 'superseded',
               updated_at = NOW()
         WHERE status = 'active'
           AND promotion_id NOT IN (
             SELECT promotion_id
             FROM ops_execution_promotions
             WHERE status = 'active'
             ORDER BY selection_value DESC, promoted_at DESC, promotion_id DESC
             LIMIT $1
           )
      `,
      [settings.maxPromotions],
    );

    await client.query("COMMIT");
    return {
      promotion: mapExecutionPromotionProjectionRow(result.rows[0]),
      changed: true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
