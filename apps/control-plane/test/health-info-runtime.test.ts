import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';
import { Gauge } from 'prom-client';

import type { ResolvedAnalysisSettingsRecord } from '../src/features/config-resources.js';
import { registerHealthRoutes } from '../src/routes/health.js';
import { registerOpsRoutes } from '../src/routes/ops.js';
import { registerRuntimeConfigRoutes } from '../src/routes/runtime-config.js';
import { testConfig } from './helpers.ts';

const createGauge = (): Gauge<string> =>
  new Gauge({
    name: `trading_bot_control_plane_database_ready_test_${Date.now()}_${Math.floor(
      Math.random() * 1_000_000
    )}`,
    help: 'test gauge',
    registers: [],
  });

test('GET /health/readiness returns ok when the database is reachable', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());

  registerHealthRoutes(
    app,
    {
      query: async () => ({ rows: [], rowCount: 1 }),
    } as never,
    createGauge(),
    testConfig
  );

  const response = await app.inject({
    method: 'GET',
    url: '/health/readiness',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: testConfig.serviceName,
    components: {
      db: { status: 'up' },
    },
  });
});

test('GET /health/readiness returns error when the database is down', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());

  registerHealthRoutes(
    app,
    {
      query: async () => {
        throw new Error('db down');
      },
    } as never,
    createGauge(),
    testConfig
  );

  const response = await app.inject({
    method: 'GET',
    url: '/health/readiness',
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    status: 'error',
    service: testConfig.serviceName,
    components: {
      db: { status: 'down' },
    },
  });
});

test('GET /v1/runtime-config/analysis-settings returns the injected projection', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());

  const projection: ResolvedAnalysisSettingsRecord[] = [
    {
      id: 'analysis-1',
      name: 'ema-cross-20',
      symbolCode: 'BTCUSDT',
      timeframeCode: '1m',
      strategyName: 'ema',
      riskProfileName: 'default-risk',
      technicalAnalysisSettings: { period: 20 },
      enabled: true,
      createdAt: '2026-03-12T16:00:00.000Z',
      updatedAt: '2026-03-12T16:00:00.000Z',
      symbol: {
        id: 'symbol-1',
        code: 'BTCUSDT',
        active: true,
        baseAsset: 'BTC',
        destinationAsset: 'USDT',
        createdAt: '2026-03-12T16:00:00.000Z',
        updatedAt: '2026-03-12T16:00:00.000Z',
      },
      timeframe: {
        id: 'timeframe-1',
        code: '1m',
        longerTimeframeCode: '5m',
        longerTimeframeMultiplier: 5,
        periodMs: 60_000,
        active: true,
        createdAt: '2026-03-12T16:00:00.000Z',
        updatedAt: '2026-03-12T16:00:00.000Z',
      },
      strategy: {
        id: 'strategy-1',
        name: 'ema',
        description: 'ema crossover',
        activated: true,
        parameters: { fast: 9, slow: 21 },
        createdAt: '2026-03-12T16:00:00.000Z',
        updatedAt: '2026-03-12T16:00:00.000Z',
      },
      riskProfile: {
        id: 'risk-1',
        name: 'default-risk',
        description: 'default risk',
        maximumStopLoss: 2,
        minimumStopLoss: 1,
        swingGap: 0.5,
        rrr: 2,
        enabled: true,
        createdAt: '2026-03-12T16:00:00.000Z',
        updatedAt: '2026-03-12T16:00:00.000Z',
      },
    },
  ];

  registerRuntimeConfigRoutes(app, {} as never, async () => projection);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/runtime-config/analysis-settings',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), projection);
});

test('GET /v1/ops/execution endpoints return injected execution projections', async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());

  registerOpsRoutes(app, testConfig, {} as never, {
    listBacktestJobsFn: async () => [],
    listBacktestBatchesFn: async () => [],
    listBacktestRunProjectionsFn: async () => [],
    listDataReadinessProjectionsFn: async () => [],
    getActiveExecutionPromotionFn: async () => ({
      promotionId: 'promo-1',
      executionSettingsName: 'paper-default',
      analysisSettingId: 'analysis-1',
      sourceBacktestId: 'backtest-1',
      symbolCode: 'BTCUSDT',
      timeframeCode: '1m',
      strategyName: 'ema-cross',
      riskProfileName: 'default-risk',
      mode: 'paper',
      selectionValue: 12.4,
      status: 'active',
      promotedAt: '2026-03-28T10:00:00.000Z',
      sourceEventId: 'event-1',
      sourceOccurredAt: '2026-03-28T10:00:00.000Z',
      createdAt: '2026-03-28T10:00:00.000Z',
      updatedAt: '2026-03-28T10:00:00.000Z',
    }),
    listActiveExecutionPromotionsFn: async () => [
      {
        promotionId: 'promo-1',
        executionSettingsName: 'paper-default',
        analysisSettingId: 'analysis-1',
        sourceBacktestId: 'backtest-1',
        symbolCode: 'BTCUSDT',
        timeframeCode: '1m',
        strategyName: 'ema-cross',
        riskProfileName: 'default-risk',
        mode: 'paper',
        selectionMetric: 'score',
        selectionValue: 12.4,
        status: 'active',
        promotedAt: '2026-03-28T10:00:00.000Z',
        sourceEventId: 'event-1',
        sourceOccurredAt: '2026-03-28T10:00:00.000Z',
        createdAt: '2026-03-28T10:00:00.000Z',
        updatedAt: '2026-03-28T10:00:00.000Z',
      },
    ],
    listExecutionTradesFn: async () => ({
      items: [
        {
          tradeId: 'trade-1',
          externalOrderId: 'order-1',
          positionId: 'position-1',
          sourceBacktestId: 'backtest-1',
          analysisSettingId: 'analysis-1',
          executionSettingsName: 'paper-default',
          symbolCode: 'BTCUSDT',
          timeframeCode: '1m',
          strategyName: 'ema-cross',
          riskProfileName: 'default-risk',
          mode: 'paper',
          side: 'long',
          status: 'closed',
          openedAt: '2026-03-28T10:00:00.000Z',
          closedAt: '2026-03-28T10:05:00.000Z',
          durationMs: 300_000,
          entryPrice: 100,
          exitPrice: 102,
          quantity: 1,
          notionalUsd: 100,
          stopLossPrice: 98,
          takeProfitPrice: 104,
          realizedPnlPercent: 2,
          realizedPnlUsd: 2,
          feesUsd: 0.1,
          sourceEventId: 'event-2',
          sourceOccurredAt: '2026-03-28T10:05:00.000Z',
          createdAt: '2026-03-28T10:00:00.000Z',
          updatedAt: '2026-03-28T10:05:00.000Z',
        },
      ],
      totalCount: 1,
      realizedPnlUsd: 2,
      page: 1,
      pageSize: 20,
    }),
  });

  const summaryResponse = await app.inject({
    method: 'GET',
    url: '/v1/ops/execution/summary',
  });
  const tradesResponse = await app.inject({
    method: 'GET',
    url: '/v1/ops/execution/trades?page=1&pageSize=20&sortBy=openedAt&sortDirection=desc',
  });

  assert.equal(summaryResponse.statusCode, 200);
  assert.equal(summaryResponse.json().activePromotion.symbolCode, 'BTCUSDT');
  assert.equal(summaryResponse.json().recentTrades.length, 1);

  assert.equal(tradesResponse.statusCode, 200);
  assert.equal(tradesResponse.json().totalCount, 1);
  assert.equal(tradesResponse.json().realizedPnlUsd, 2);
  assert.equal(tradesResponse.json().items[0].tradeId, 'trade-1');
});
