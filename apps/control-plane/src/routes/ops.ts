import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { AppConfig } from "../config.js";
import {
  getActiveExecutionPromotion,
  listActiveExecutionPromotions,
  listBacktestBatches,
  listLatestBacktestRunProjections,
  listDataReadinessProjections,
  listExecutionTrades,
  listBacktestRunProjections,
  listBacktestJobs,
  type BacktestBatchRecord,
  type BacktestJobRecord,
  type BacktestRunProjectionRecord,
  type DataReadinessProjectionRecord,
  type ExecutionPromotionProjectionRecord,
  type ExecutionTradeInput,
  type ExecutionTradeRecord,
  upsertExecutionTradeProjection,
} from "../features/ops.js";
import { addOpsSocket } from "../infrastructure/ops-events.js";

export const registerOpsRoutes = (
  app: FastifyInstance,
  _config: AppConfig,
  pool: Pool,
  options?: {
    listBacktestJobsFn?: (pool: Pool, limit: number) => Promise<BacktestJobRecord[]>;
    listBacktestBatchesFn?: (pool: Pool, limit: number) => Promise<BacktestBatchRecord[]>;
    listBacktestRunProjectionsFn?: (
      pool: Pool,
      limit: number,
    ) => Promise<BacktestRunProjectionRecord[]>;
    listLatestBacktestRunProjectionsFn?: (
      pool: Pool,
      limit: number,
    ) => Promise<BacktestRunProjectionRecord[]>;
    listDataReadinessProjectionsFn?: (
      pool: Pool,
      filters?: {
        strategyName?: string;
      },
    ) => Promise<DataReadinessProjectionRecord[]>;
    getActiveExecutionPromotionFn?: (
      pool: Pool,
    ) => Promise<ExecutionPromotionProjectionRecord | null>;
    listActiveExecutionPromotionsFn?: (
      pool: Pool,
      limit: number,
    ) => Promise<ExecutionPromotionProjectionRecord[]>;
    listExecutionTradesFn?: (
      pool: Pool,
      query: {
        page: number;
        pageSize: number;
        sortBy:
          | "openedAt"
          | "closedAt"
          | "realizedPnlPercent"
          | "symbolCode"
          | "notionalUsd";
        sortDirection: "asc" | "desc";
        search?: string;
        symbolCode?: string;
        timeframeCode?: string;
        strategyName?: string;
        side?: "long" | "short";
        status?: "open" | "closed" | "cancelled" | "rejected";
        mode?: "paper" | "live";
      },
    ) => Promise<{
      items: ExecutionTradeRecord[];
      totalCount: number;
      realizedPnlUsd: number;
      page: number;
      pageSize: number;
    }>;
    upsertExecutionTradeProjectionFn?: (
      pool: Pool,
      input: ExecutionTradeInput,
    ) => Promise<ExecutionTradeRecord>;
  },
): void => {
  const listBacktestJobsFn = options?.listBacktestJobsFn ?? listBacktestJobs;
  const listBacktestBatchesFn = options?.listBacktestBatchesFn ?? listBacktestBatches;
  const listBacktestRunProjectionsFn =
    options?.listBacktestRunProjectionsFn ?? listBacktestRunProjections;
  const listLatestBacktestRunProjectionsFn =
    options?.listLatestBacktestRunProjectionsFn ?? listLatestBacktestRunProjections;
  const listDataReadinessProjectionsFn =
    options?.listDataReadinessProjectionsFn ?? listDataReadinessProjections;
  const getActiveExecutionPromotionFn =
    options?.getActiveExecutionPromotionFn ?? getActiveExecutionPromotion;
  const listActiveExecutionPromotionsFn =
    options?.listActiveExecutionPromotionsFn ?? listActiveExecutionPromotions;
  const listExecutionTradesFn =
    options?.listExecutionTradesFn ?? listExecutionTrades;
  const upsertExecutionTradeProjectionFn =
    options?.upsertExecutionTradeProjectionFn ?? upsertExecutionTradeProjection;

  const buildBacktestsSummary = async () => {
    const [batches, recentRuns, latestRuns, jobs] = await Promise.all([
      listBacktestBatchesFn(pool, 100),
      listBacktestRunProjectionsFn(pool, 300),
      listLatestBacktestRunProjectionsFn(pool, 1000),
      listBacktestJobsFn(pool, 200),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      jobs,
      batches,
      recentRuns,
      latestRuns,
    };
  };

  const buildDataReadiness = async (
    request?: {
      query?: {
        strategyName?: string;
      };
    },
  ) => {
    return {
      generatedAt: new Date().toISOString(),
      items: await listDataReadinessProjectionsFn(pool, {
        strategyName: request?.query?.strategyName,
      }),
    };
  };

  const buildExecutionSummary = async () => {
    const [activePromotion, activePromotions, tradesPage] = await Promise.all([
      getActiveExecutionPromotionFn(pool),
      listActiveExecutionPromotionsFn(pool, 20),
      listExecutionTradesFn(pool, {
        page: 1,
        pageSize: 10,
        sortBy: "openedAt",
        sortDirection: "desc",
      }),
    ]);

    const openTradeCount = tradesPage.items.filter((item) => item.status === "open").length;
    const closedTrades = tradesPage.items.filter((item) => item.status === "closed");
    const realizedPnlUsd = closedTrades.reduce(
      (sum, item) => sum + (item.realizedPnlUsd ?? 0),
      0,
    );

    return {
      generatedAt: new Date().toISOString(),
      activePromotion,
      activePromotions,
      totals: {
        openTradeCount,
        recentTradeCount: tradesPage.items.length,
        closedTradeCount: closedTrades.length,
        realizedPnlUsd,
      },
      recentTrades: tradesPage.items,
    };
  };

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
      summary: "Per symbol/timeframe/strategy readiness for replay and backtesting inputs",
      querystring: {
        type: "object",
        properties: {
          strategyName: { type: "string" },
        },
      },
    },
    handler: async (request) =>
      buildDataReadiness(request as { query?: { strategyName?: string } }),
  });

  app.get("/v1/ops/execution/summary", {
    schema: {
      tags: ["ops"],
      summary: "Execution promotion summary and recent execution trades",
    },
    handler: buildExecutionSummary,
  });

  app.get("/v1/ops/execution/trades", {
    schema: {
      tags: ["ops"],
      summary: "Paginated execution trade history for the operator console",
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1 },
          pageSize: { type: "integer", minimum: 1, maximum: 100 },
          sortBy: {
            type: "string",
            enum: [
              "openedAt",
              "closedAt",
              "realizedPnlPercent",
              "symbolCode",
              "notionalUsd",
            ],
          },
          sortDirection: { type: "string", enum: ["asc", "desc"] },
          search: { type: "string" },
          symbolCode: { type: "string" },
          timeframeCode: { type: "string" },
          strategyName: { type: "string" },
          openedFrom: { type: "string", format: "date-time" },
          openedTo: { type: "string", format: "date-time" },
          side: { type: "string", enum: ["long", "short"] },
          status: {
            type: "string",
            enum: ["open", "closed", "cancelled", "rejected"],
          },
          mode: { type: "string", enum: ["paper", "live"] },
        },
      },
    },
    handler: async (request) => {
      const query = request.query as Record<string, unknown>;

      return listExecutionTradesFn(pool, {
        page: typeof query.page === "number" ? query.page : 1,
        pageSize: typeof query.pageSize === "number" ? query.pageSize : 20,
        sortBy:
          query.sortBy === "closedAt" ||
          query.sortBy === "realizedPnlPercent" ||
          query.sortBy === "symbolCode" ||
          query.sortBy === "notionalUsd"
            ? query.sortBy
            : "openedAt",
        sortDirection: query.sortDirection === "asc" ? "asc" : "desc",
        search: typeof query.search === "string" ? query.search : undefined,
        symbolCode: typeof query.symbolCode === "string" ? query.symbolCode : undefined,
        timeframeCode:
          typeof query.timeframeCode === "string" ? query.timeframeCode : undefined,
        strategyName:
          typeof query.strategyName === "string" ? query.strategyName : undefined,
        openedFrom:
          typeof query.openedFrom === "string" ? query.openedFrom : undefined,
        openedTo:
          typeof query.openedTo === "string" ? query.openedTo : undefined,
        side:
          query.side === "long" || query.side === "short" ? query.side : undefined,
        status:
          query.status === "open" ||
          query.status === "closed" ||
          query.status === "cancelled" ||
          query.status === "rejected"
            ? query.status
            : undefined,
        mode: query.mode === "live" || query.mode === "paper" ? query.mode : undefined,
      });
    },
  });

  app.post("/v1/ops/execution/trades", {
    schema: {
      tags: ["ops"],
      summary: "Internal execution-trade projection upsert used by the execution runtime",
    },
    handler: async (request) =>
      upsertExecutionTradeProjectionFn(pool, request.body as ExecutionTradeInput),
  });

  app.get(
    "/ws/ops",
    { websocket: true },
    (socket) => {
      addOpsSocket(socket as never);
    },
  );
};
