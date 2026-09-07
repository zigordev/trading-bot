import assert from 'node:assert/strict';

import fastifyWebsocket from '@fastify/websocket';
import { Pool } from 'pg';
import { afterAll, beforeAll, test } from 'vitest';

import type { ExecutionTradeInput, PaginatedExecutionTrades } from '../../src/features/ops.js';
import { ensureOpsSchema } from '../../src/features/ops.js';
import { registerOpsRoutes } from '../../src/routes/ops.js';
import { createAppWithErrorHandler, testConfig } from '../helpers.js';

const pool = new Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 15432),
  user: process.env.DB_USER ?? 'trading_bot_admin',
  password: process.env.DB_PASSWORD ?? 'secret',
  database: process.env.DB_NAME ?? 'trading_bot',
  max: 2,
});

const app = createAppWithErrorHandler();

const tradeId = `paper:integration:${Date.now()}`;

const openedTrade: ExecutionTradeInput = {
  tradeId,
  externalOrderId: null,
  positionId: `position:${tradeId}`,
  sourceBacktestId: null,
  analysisSettingId: 'analysis-integration',
  executionSettingsName: 'paper-default',
  symbolCode: 'BTCUSDT',
  timeframeCode: '1m',
  strategyName: 'strategy1',
  riskProfileName: 'default-risk',
  mode: 'paper',
  side: 'long',
  status: 'open',
  closeReason: null,
  openedAt: '2026-09-07T10:00:00.000Z',
  closedAt: null,
  durationMs: null,
  entryPrice: 50_000,
  exitPrice: null,
  quantity: 0.002,
  notionalUsd: 100,
  stopLossPrice: 49_000,
  takeProfitPrice: 52_000,
  realizedPnlPercent: null,
  realizedPnlUsd: null,
  feesUsd: 0,
  sourceEventId: null,
  sourceOccurredAt: null,
};

const closedTrade: ExecutionTradeInput = {
  ...openedTrade,
  status: 'closed',
  closeReason: 'takeProfit',
  closedAt: '2026-09-07T10:30:00.000Z',
  durationMs: 1_800_000,
  exitPrice: 52_000,
  realizedPnlPercent: 4,
  realizedPnlUsd: 4,
};

const listTrades = async (): Promise<PaginatedExecutionTrades> => {
  const response = await app.inject({
    method: 'GET',
    url: '/v1/ops/execution/trades',
    query: { search: tradeId, pageSize: '10' },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as PaginatedExecutionTrades;
};

beforeAll(async () => {
  await ensureOpsSchema(pool);
  await app.register(fastifyWebsocket);
  registerOpsRoutes(app, testConfig, pool);
  await app.ready();
});

afterAll(async () => {
  await pool.query('DELETE FROM ops_execution_trades WHERE trade_id = $1', [tradeId]);
  await app.close();
  await pool.end();
});

test('a trade posted by the execution runtime is read back by the console with its risk brackets intact', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/ops/execution/trades',
    payload: openedTrade,
  });
  assert.equal(response.statusCode, 200, response.body);

  const page = await listTrades();
  assert.equal(page.totalCount, 1);
  const [trade] = page.items;
  assert.equal(trade.tradeId, tradeId);
  assert.equal(trade.status, 'open');
  assert.equal(trade.quantity, 0.002);
  assert.equal(trade.stopLossPrice, 49_000);
  assert.equal(trade.takeProfitPrice, 52_000);
  assert.equal(new Date(trade.openedAt).toISOString(), openedTrade.openedAt);
});

test('closing the same trade updates the one row rather than adding a second', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/ops/execution/trades',
    payload: closedTrade,
  });
  assert.equal(response.statusCode, 200, response.body);

  const page = await listTrades();
  assert.equal(page.totalCount, 1);
  const [trade] = page.items;
  assert.equal(trade.status, 'closed');
  assert.equal(trade.closeReason, 'takeProfit');
  assert.equal(trade.exitPrice, 52_000);
  assert.equal(trade.realizedPnlUsd, 4);
  assert.equal(page.realizedPnlUsd, 4);
});

test('a trade outside the allowed modes is refused by the schema, not stored', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/ops/execution/trades',
    payload: { ...openedTrade, tradeId: `${tradeId}:bad-mode`, mode: 'shadow' },
  });
  assert.ok(response.statusCode >= 400, response.body);

  const page = await listTrades();
  assert.equal(page.totalCount, 1);
});
