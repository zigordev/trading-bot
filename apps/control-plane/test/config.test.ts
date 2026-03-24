import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { withEnv } from "./helpers.ts";

test("loadConfig returns defaults for optional config", async () => {
  await withEnv(
    {
      POSTGRES_PASSWORD: "secret",
      APP_ENV: undefined,
      SERVICE_NAME: undefined,
      PORT: undefined,
      DB_HOST: undefined,
      DB_PORT: undefined,
      DB_USER: undefined,
      DB_NAME: undefined,
      KAFKA_BOOTSTRAP_SERVERS: undefined,
      CONFIG_CHANGE_EVENTS_TOPIC: undefined,
    },
    () => {
      const config = loadConfig();

      assert.equal(config.appEnv, "local");
      assert.equal(config.serviceName, "trading-bot-control-plane");
      assert.equal(config.port, 8080);
      assert.equal(config.dbHost, "trading-bot-postgres");
      assert.equal(config.dbPort, 5432);
      assert.equal(config.dbUser, "trading_bot_admin");
      assert.equal(config.dbName, "trading_bot");
      assert.equal(config.kafkaBootstrapServers, "platform-redpanda:9092");
      assert.equal(
        config.configChangeEventsTopic,
        "trading-bot.control-plane.config-changes.v1",
      );
      assert.equal(
        config.backtestCompletedEventsTopic,
        "trading-bot.research-backtesting.backtest-completed.v1",
      );
      assert.equal(
        config.backtestCompletedEventsConsumerGroupId,
        "trading-bot-control-plane-backtest-projection-v1",
      );
      assert.equal(
        config.dataReadinessEventsTopic,
        "trading-bot.market-data.data-readiness-snapshot.v1",
      );
      assert.equal(
        config.dataReadinessEventsConsumerGroupId,
        "trading-bot-control-plane-data-readiness-projection-v1",
      );
    },
  );
});

test("loadConfig throws when POSTGRES_PASSWORD is missing", async () => {
  await withEnv(
    {
      POSTGRES_PASSWORD: undefined,
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /POSTGRES_PASSWORD is required/,
      );
    },
  );
});
