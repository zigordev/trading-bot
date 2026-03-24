import assert from "node:assert/strict";

import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
} from "fastify";

import type { AppConfig } from "../src/config.js";
import { HttpError } from "../src/http-error.js";

export const testConfig: AppConfig = {
  appEnv: "test",
  serviceName: "trading-bot-control-plane-test",
  port: 8080,
  dbHost: "localhost",
  dbPort: 5432,
  dbUser: "trading_bot_admin",
  dbName: "trading_bot",
  dbPassword: "secret",
  kafkaBootstrapServers: "platform-redpanda:9092",
  configChangeEventsTopic: "trading-bot.control-plane.config-changes.v1",
  backtestCompletedEventsTopic: "trading-bot.research-backtesting.backtest-completed.v1",
  backtestCompletedEventsConsumerGroupId:
    "trading-bot-control-plane-backtest-projection-test-v1",
  dataReadinessEventsTopic: "trading-bot.market-data.data-readiness-snapshot.v1",
  dataReadinessEventsConsumerGroupId:
    "trading-bot-control-plane-data-readiness-projection-test-v1",
  marketDataBaseUrl: "http://market-data:8090",
  strategyEngineBaseUrl: "http://strategy-engine:8100",
  researchBacktestingBaseUrl: "http://research-backtesting:8110",
  upstreamRequestTimeoutMs: 5_000,
  opsStreamIntervalMs: 5_000,
  backtestWarmupMultiplier: 5,
  backtestTimerangeMsByTimeframe: {
    "1m": 600_000_000,
    "3m": 1_800_000_000,
    "5m": 3_000_000_000,
  },
};

export const withEnv = async <T>(
  overrides: Record<string, string | undefined>,
  run: () => Promise<T> | T,
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
    level: "silent",
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
  const hasStatusCode = (error: unknown): error is { statusCode: number } =>
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number";

  app.setErrorHandler((error, _request, reply) => {
    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : hasStatusCode(error)
          ? error.statusCode
          : 500;

    reply.code(statusCode).send({
      statusCode,
      message:
        error instanceof Error && error.message.trim()
          ? error.message
          : "Internal server error",
    });
  });

  return app;
};

export const assertStatus = (
  actual: number,
  expected: number,
  bodyText: string,
): void => {
  assert.equal(actual, expected, bodyText);
};
