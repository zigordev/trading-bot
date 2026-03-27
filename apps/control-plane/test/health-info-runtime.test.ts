import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";
import { Gauge } from "prom-client";

import type { ResolvedAnalysisSettingsRecord } from "../src/features/config-resources.js";
import { registerHealthRoutes } from "../src/routes/health.js";
import { registerOpsRoutes } from "../src/routes/ops.js";
import { registerRuntimeConfigRoutes } from "../src/routes/runtime-config.js";
import { testConfig } from "./helpers.ts";

const createGauge = (): Gauge<string> =>
  new Gauge({
    name: `trading_bot_control_plane_database_ready_test_${Date.now()}_${Math.floor(
      Math.random() * 1_000_000,
    )}`,
    help: "test gauge",
    registers: [],
  });

test("GET /health/readiness returns ok when the database is reachable", async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());

  registerHealthRoutes(
    app,
    {
      query: async () => ({ rows: [], rowCount: 1 }),
    } as never,
    createGauge(),
    testConfig,
  );

  const response = await app.inject({
    method: "GET",
    url: "/health/readiness",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: testConfig.serviceName,
    checks: {
      database: "up",
    },
  });
});

test("GET /health/readiness returns degraded when the database is down", async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());

  registerHealthRoutes(
    app,
    {
      query: async () => {
        throw new Error("db down");
      },
    } as never,
    createGauge(),
    testConfig,
  );

  const response = await app.inject({
    method: "GET",
    url: "/health/readiness",
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    status: "degraded",
    service: testConfig.serviceName,
    checks: {
      database: "down",
    },
  });
});

test("GET /v1/ops/overview aggregates service availability", async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());

  let requestCount = 0;
  registerOpsRoutes(app, testConfig, {} as never, {
    fetchJson: async (url) => {
      requestCount += 1;
      if (url.includes("market-data")) {
        return { status: "ok" };
      }

      throw new Error("connection refused");
    },
    listResolvedAnalysisSettingsFn: async () => [],
    listBacktestJobsFn: async () => [],
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/ops/overview",
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json();
  assert.equal(requestCount, 2);
  assert.equal(payload.services.length, 3);
  assert.deepEqual(
    payload.services.map((service: { name: string; status: string }) => ({
      name: service.name,
      status: service.status,
    })),
    [
      { name: "control-plane", status: "up" },
      { name: "market-data", status: "up" },
      { name: "research-backtesting", status: "down" },
    ],
  );
});

test("GET /v1/runtime-config/analysis-settings returns the injected projection", async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());

  const projection: ResolvedAnalysisSettingsRecord[] = [
    {
      id: "analysis-1",
      name: "ema-cross-20",
      symbolCode: "BTCUSDT",
      timeframeCode: "1m",
      strategyName: "ema",
      riskProfileName: "default-risk",
      technicalAnalysisSettings: { period: 20 },
      enabled: true,
      createdAt: "2026-03-12T16:00:00.000Z",
      updatedAt: "2026-03-12T16:00:00.000Z",
      symbol: {
        id: "symbol-1",
        code: "BTCUSDT",
        active: true,
        baseAsset: "BTC",
        destinationAsset: "USDT",
        createdAt: "2026-03-12T16:00:00.000Z",
        updatedAt: "2026-03-12T16:00:00.000Z",
      },
      timeframe: {
        id: "timeframe-1",
        code: "1m",
        longerTimeframeCode: "5m",
        longerTimeframeMultiplier: 5,
        periodMs: 60_000,
        active: true,
        createdAt: "2026-03-12T16:00:00.000Z",
        updatedAt: "2026-03-12T16:00:00.000Z",
      },
      strategy: {
        id: "strategy-1",
        name: "ema",
        description: "ema crossover",
        activated: true,
        parameters: { fast: 9, slow: 21 },
        createdAt: "2026-03-12T16:00:00.000Z",
        updatedAt: "2026-03-12T16:00:00.000Z",
      },
      riskProfile: {
        id: "risk-1",
        name: "default-risk",
        description: "default risk",
        maximumStopLoss: 2,
        minimumStopLoss: 1,
        swingGap: 0.5,
        rrr: 2,
        enabled: true,
        createdAt: "2026-03-12T16:00:00.000Z",
        updatedAt: "2026-03-12T16:00:00.000Z",
      },
    },
  ];

  registerRuntimeConfigRoutes(
    app,
    {} as never,
    async () => projection,
  );

  const response = await app.inject({
    method: "GET",
    url: "/v1/runtime-config/analysis-settings",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), projection);
});
