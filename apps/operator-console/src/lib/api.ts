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
};

export type BacktestsSummaryResponse = {
  generatedAt: string;
  batches: BacktestBatch[];
  recentRuns: RecentBacktestRun[];
  latestRuns: RecentBacktestRun[];
};

export type ExecutionSettingsRecord = {
  id: string;
  name: string;
  enabled: boolean;
  mode: "paper" | "live";
  autoPromote: boolean;
  maxPromotions: number;
  minTradeCount: number;
  replaceOpenPositionPolicy: "keep" | "flatten";
  createdAt: string;
  updatedAt: string;
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
    details: string | null;
    kline: Record<string, unknown> | null;
    trades: Record<string, unknown> | null;
  }[];
};

export type ExecutionPromotion = {
  promotionId: string;
  executionSettingsName: string;
  analysisSettingId: string;
  sourceBacktestId: string | null;
  symbolCode: string;
  timeframeCode: string;
  strategyName: string;
  riskProfileName: string;
  mode: "paper" | "live";
  selectionValue: number;
  status: "active" | "superseded";
  promotedAt: string;
};

export type ExecutionTrade = {
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
};

export type ExecutionSummaryResponse = {
  generatedAt: string;
  activePromotion: ExecutionPromotion | null;
  activePromotions: ExecutionPromotion[];
  totals: {
    openTradeCount: number;
    recentTradeCount: number;
    closedTradeCount: number;
    realizedPnlUsd: number;
  };
  recentTrades: ExecutionTrade[];
};

export type ExecutionTradesResponse = {
  items: ExecutionTrade[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export type ExecutionTradesQuery = {
  page?: number;
  pageSize?: number;
  sortBy?: "openedAt" | "closedAt" | "realizedPnlPercent" | "symbolCode" | "notionalUsd";
  sortDirection?: "asc" | "desc";
  search?: string;
  symbolCode?: string;
  timeframeCode?: string;
  strategyName?: string;
  side?: "long" | "short";
  status?: "open" | "closed" | "cancelled" | "rejected";
  mode?: "paper" | "live";
};

export type BinanceSymbolReference = {
  symbol: string;
  baseAsset: string;
  destinationAsset: string;
};

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
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

export const getDataReadiness = (): Promise<DataReadinessResponse> =>
  fetchJson("/v1/ops/data-readiness");

export const getExecutionSummary = (): Promise<ExecutionSummaryResponse> =>
  fetchJson("/v1/ops/execution/summary");

export const getExecutionTrades = (
  query: ExecutionTradesQuery = {},
): Promise<ExecutionTradesResponse> => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetchJson(`/v1/ops/execution/trades${suffix}`);
};

export const getConfigResourceRecords = (
  resource: string,
): Promise<Record<string, unknown>[]> => fetchJson(`/v1/${resource}`);

export const getBinanceSymbolReferences = (
  query: string,
): Promise<BinanceSymbolReference[]> =>
  fetchJson(`/v1/reference/binance-symbols${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`);

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
