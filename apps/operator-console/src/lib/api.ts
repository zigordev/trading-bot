export const API_BASE =
  process.env.EXPO_PUBLIC_CONTROL_PLANE_BASE_URL ?? "http://localhost:3020";

export const OPS_WS_URL = `${API_BASE.replace(/^http/, "ws")}/ws/ops`;

export type OverviewResponse = {
  generatedAt: string;
  activeAnalysisCount: number;
  queuedBacktests: number;
  runningBacktests: number;
  services: {
    name: string;
    status: "up" | "down" | "unknown";
    details: string | null;
  }[];
};

export type BacktestJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
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

export type BacktestBatch = {
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

export type RecentBacktestRun = {
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
};

export type BacktestsSummaryResponse = {
  generatedAt: string;
  jobs: BacktestJob[];
  batches: BacktestBatch[];
  recentRuns: RecentBacktestRun[];
  latestRuns: RecentBacktestRun[];
};

export type RuntimeAnalysis = {
  id: string;
  symbolCode: string;
  timeframeCode: string;
  strategyName: string;
  riskProfileName: string;
  technicalAnalysisSettings: Record<string, unknown>;
};

export type DataReadinessResponse = {
  generatedAt: string;
  items: {
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
  }[];
};

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {}

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
};

export const getOverview = (): Promise<OverviewResponse> =>
  fetchJson("/v1/ops/overview");

export const getBacktestsSummary = (): Promise<BacktestsSummaryResponse> =>
  fetchJson("/v1/ops/backtests/summary");

export const getRuntimeAnalyses = (): Promise<RuntimeAnalysis[]> =>
  fetchJson("/v1/runtime-config/analysis-settings");

export const createBacktestJob = (
  payload: Record<string, unknown>,
): Promise<BacktestJob> =>
  fetchJson("/v1/ops/backtest-jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const getDataReadiness = (): Promise<DataReadinessResponse> =>
  fetchJson("/v1/ops/data-readiness");

export const getConfigResourceRecords = (
  resource: string,
): Promise<Record<string, unknown>[]> => fetchJson(`/v1/${resource}`);

export const saveConfigResource = (
  resource: string,
  payload: Record<string, unknown>,
  id?: string | null,
): Promise<Record<string, unknown>> =>
  fetchJson(`/v1/${resource}${id ? `/${id}` : ""}`, {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });

export const deleteConfigResource = async (
  resource: string,
  id: string,
): Promise<void> => {
  await fetchJson(`/v1/${resource}/${id}`, {
    method: "DELETE",
  });
};
