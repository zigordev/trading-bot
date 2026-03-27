import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { AppConfig } from "../config.js";
import {
  listResolvedAnalysisSettings as defaultListResolvedAnalysisSettings,
  type ResolvedAnalysisSettingsRecord,
} from "../features/config-resources.js";
import {
  listBacktestBatches,
  listDataReadinessProjections,
  listBacktestRunProjections,
  listBacktestJobs,
  type BacktestBatchRecord,
  type BacktestJobRecord,
  type BacktestRunProjectionRecord,
  type DataReadinessProjectionRecord,
} from "../features/ops.js";

type ServiceCheckStatus = "up" | "down" | "unknown";

type ServiceSnapshot = {
  name: string;
  status: ServiceCheckStatus;
  details: string | null;
};

type FetchJson = (
  url: string,
  init?: RequestInit,
) => Promise<unknown>;

type OpsSocket = {
  readonly OPEN: number;
  readonly readyState: number;
  send(payload: string): void;
  close(): void;
  on(event: "close", listener: () => void): void;
};

const defaultFetchJson = (config: AppConfig): FetchJson => async (url, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.upstreamRequestTimeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const readStatus = (payload: unknown): ServiceCheckStatus => {
  if (typeof payload !== "object" || payload === null || !("status" in payload)) {
    return "unknown";
  }

  const status = (payload as { status?: unknown }).status;
  if (status === "ok" || status === "up") {
    return "up";
  }
  if (status === "degraded" || status === "down") {
    return "down";
  }

  return "unknown";
};

const buildServiceChecks = (config: AppConfig) => [
  {
    name: "market-data",
    url: `${config.marketDataBaseUrl}/health/readiness`,
  },
  {
    name: "research-backtesting",
    url: `${config.researchBacktestingBaseUrl}/health/readiness`,
  },
] as const;

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveSlowPeriod = (analysis: ResolvedAnalysisSettingsRecord): number => {
  const strategyParameters = asObject(analysis.strategy.parameters);
  const technicalAnalysisSettings = asObject(analysis.technicalAnalysisSettings);

  return (
    asNumber(technicalAnalysisSettings?.slowPeriod) ??
    asNumber(strategyParameters?.slowPeriod) ??
    21
  );
};

const deriveRequiredHistory = (
  analysis: ResolvedAnalysisSettingsRecord,
  config: AppConfig,
) => {
  const configuredDurationMs =
    config.backtestTimerangeMsByTimeframe[analysis.timeframeCode] ??
    config.backtestTimerangeMsByTimeframe["1m"] ??
    600_000_000;
  const slowPeriod = resolveSlowPeriod(analysis);
  const warmupMs =
    slowPeriod * config.backtestWarmupMultiplier * analysis.timeframe.periodMs;
  const now = Date.now();
  const requestedEndTime = now;
  const requestedStartTime = now - configuredDurationMs;

  return {
    requestedStartTime,
    requestedEndTime,
    requiredHistoryMs: configuredDurationMs + warmupMs,
  };
};

const broadcastPayload = (
  sockets: Set<OpsSocket>,
  payload: Record<string, unknown>,
): void => {
  const message = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
};

export const registerOpsRoutes = (
  app: FastifyInstance,
  config: AppConfig,
  pool: Pool,
  options?: {
    fetchJson?: FetchJson;
    listResolvedAnalysisSettingsFn?: (
      pool: Pool,
    ) => Promise<ResolvedAnalysisSettingsRecord[]>;
    listBacktestJobsFn?: (pool: Pool, limit: number) => Promise<BacktestJobRecord[]>;
    listBacktestBatchesFn?: (pool: Pool, limit: number) => Promise<BacktestBatchRecord[]>;
    listBacktestRunProjectionsFn?: (
      pool: Pool,
      limit: number,
    ) => Promise<BacktestRunProjectionRecord[]>;
    listDataReadinessProjectionsFn?: (
      pool: Pool,
    ) => Promise<DataReadinessProjectionRecord[]>;
  },
): void => {
  const fetchJson = options?.fetchJson ?? defaultFetchJson(config);
  const listResolvedAnalysisSettingsFn =
    options?.listResolvedAnalysisSettingsFn ?? defaultListResolvedAnalysisSettings;
  const listBacktestJobsFn = options?.listBacktestJobsFn ?? listBacktestJobs;
  const listBacktestBatchesFn = options?.listBacktestBatchesFn ?? listBacktestBatches;
  const listBacktestRunProjectionsFn =
    options?.listBacktestRunProjectionsFn ?? listBacktestRunProjections;
  const listDataReadinessProjectionsFn =
    options?.listDataReadinessProjectionsFn ?? listDataReadinessProjections;
  const sockets = new Set<OpsSocket>();

  const broadcastInvalidate = (reason: string): void => {
    broadcastPayload(sockets, {
      eventId: randomUUID(),
      type: "ops.invalidate",
      occurredAt: new Date().toISOString(),
      payload: {
        reason,
        queries: ["ops-overview", "ops-backtests-summary", "ops-data-readiness"],
      },
    });
  };

  const buildOverview = async () => {
    const [services, analyses, jobs] = await Promise.all([
      Promise.all(
        buildServiceChecks(config).map(async ({ name, url }): Promise<ServiceSnapshot> => {
          try {
            const payload = await fetchJson(url);
            return {
              name,
              status: readStatus(payload),
              details: null,
            };
          } catch (error) {
            return {
              name,
              status: "down",
              details: error instanceof Error ? error.message : "unknown upstream error",
            };
          }
        }),
      ),
      listResolvedAnalysisSettingsFn(pool),
      listBacktestJobsFn(pool, 100),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      activeAnalysisCount: analyses.length,
      queuedBacktests: jobs.filter((job) => job.status === "queued").length,
      runningBacktests: jobs.filter((job) => job.status === "running").length,
      services: [
        {
          name: "control-plane",
          status: "up" as const,
          details: null,
        },
        ...services,
      ],
    };
  };

  const buildBacktestsSummary = async () => {
    const [batches, recentRuns] = await Promise.all([
      listBacktestBatchesFn(pool, 100),
      listBacktestRunProjectionsFn(pool, 100),
    ]);

    const latestRunByKey = new Map<string, BacktestRunProjectionRecord>();
    for (const run of recentRuns) {
      const key = [
        run.symbol,
        run.timeframeCode,
        run.analysisSettingId,
        run.riskProfileName,
        run.strategyName,
      ].join(":");
      if (!latestRunByKey.has(key)) {
        latestRunByKey.set(key, run);
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      batches,
      recentRuns,
      latestRuns: [...latestRunByKey.values()],
    };
  };

  const buildDataReadiness = async () => {
    return {
      generatedAt: new Date().toISOString(),
      items: await listDataReadinessProjectionsFn(pool),
    };
  };

  const interval = setInterval(() => {
    broadcastInvalidate("periodic-refresh");
  }, config.opsStreamIntervalMs);

  app.addHook("onClose", async () => {
    clearInterval(interval);
    for (const socket of sockets) {
      socket.close();
    }
    sockets.clear();
  });

  app.get("/v1/ops/overview", {
    schema: {
      tags: ["ops"],
      summary: "Aggregate operator overview across runtime services",
    },
    handler: buildOverview,
  });

  app.get("/v1/ops/backtests/summary", {
    schema: {
      tags: ["ops"],
      summary: "Backtest jobs and recent completed run summaries",
    },
    handler: buildBacktestsSummary,
  });

  app.get("/v1/ops/data-readiness", {
    schema: {
      tags: ["ops"],
      summary: "Per symbol/timeframe readiness for replay and backtesting inputs",
    },
    handler: buildDataReadiness,
  });

  app.get(
    "/ws/ops",
    { websocket: true },
    (socket) => {
      const client = socket as unknown as OpsSocket;
      sockets.add(client);
      client.send(
        JSON.stringify({
          eventId: randomUUID(),
          type: "ops.connected",
          occurredAt: new Date().toISOString(),
          payload: {
            queries: ["ops-overview", "ops-backtests-summary", "ops-data-readiness"],
          },
        }),
      );
      client.on("close", () => {
        sockets.delete(client);
      });
    },
  );
};
