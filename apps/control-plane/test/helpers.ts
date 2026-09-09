import assert from 'node:assert/strict';

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import type { AppConfig } from '../src/config.js';
import { registerProblemErrorHandler } from '../src/problem-details.js';

export const testConfig: AppConfig = {
  appEnv: 'test',
  serviceName: 'trading-bot-control-plane-test',
  port: 8080,
  dbHost: 'localhost',
  dbPort: 5432,
  dbUser: 'trading_bot_admin',
  dbName: 'trading_bot',
  dbPassword: 'secret',
  kafkaBootstrapServers: 'platform-redpanda:9092',
  configChangeEventsTopic: 'trading-bot.control-plane.config-changes.v1',
  backtestCompletedEventsTopic: 'trading-bot.research-backtesting.backtest-completed.v1',
  backtestCompletedEventsConsumerGroupId: 'trading-bot-control-plane-backtest-projection-test-v1',
  backtestProgressEventsTopic: 'trading-bot.research-backtesting.backtest-progress.v1',
  backtestProgressEventsConsumerGroupId: 'trading-bot-control-plane-backtest-progress-test-v1',
  dataReadinessEventsTopic: 'trading-bot.market-data.data-readiness-snapshot.v1',
  dataReadinessEventsConsumerGroupId: 'trading-bot-control-plane-data-readiness-projection-test-v1',
  marketDataBaseUrl: 'http://market-data:8090',
  researchBacktestingBaseUrl: 'http://research-backtesting:8110',
  upstreamRequestTimeoutMs: 5_000,
  opsStreamIntervalMs: 5_000,
  backtestWarmupCandles: 200,
  backtestTimerangeMsByTimeframe: {
    '1m': 600_000_000,
    '3m': 1_800_000_000,
    '5m': 3_000_000_000,
  },
};

export const withEnv = async <T>(
  overrides: Record<string, string | undefined>,
  run: () => Promise<T> | T
): Promise<T> => {
  const originalEnv = { ...process.env };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }

    Object.assign(process.env, originalEnv);
  }
};

export const createNoopLogger = (): FastifyBaseLogger =>
  ({
    level: 'silent',
    fatal() {},
    error() {},
    warn() {},
    info() {},
    debug() {},
    trace() {},
    child() {
      return createNoopLogger();
    },
  }) as unknown as FastifyBaseLogger;

export const createAppWithErrorHandler = (): FastifyInstance => {
  const app = Fastify({ logger: false });
  registerProblemErrorHandler(app);
  return app;
};
