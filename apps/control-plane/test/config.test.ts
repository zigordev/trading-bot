import assert from 'node:assert/strict';
import { test } from 'vitest';

import { loadConfig } from '../src/config.js';
import { withEnv } from './helpers.js';

test('loadConfig returns defaults for optional config', async () => {
  await withEnv(
    {
      POSTGRES_PASSWORD: 'secret',
      APP_ENV: undefined,
      SERVICE_NAME: undefined,
      PORT: undefined,
      DB_HOST: undefined,
      DB_PORT: undefined,
      DB_USER: undefined,
      DB_NAME: undefined,
      KAFKA_BOOTSTRAP_SERVERS: undefined,
      CONFIG_CHANGE_EVENTS_TOPIC: undefined,
      RESEARCH_BACKTESTING_BASE_URL: undefined,
      UPSTREAM_REQUEST_TIMEOUT_MS: undefined,
      BACKTEST_TIMERANGE_MS_BY_TIMEFRAME: undefined,
    },
    () => {
      const config = loadConfig();

      assert.equal(config.appEnv, 'local');
      assert.equal(config.serviceName, 'trading-bot-control-plane');
      assert.equal(config.port, 8080);
      assert.equal(config.dbHost, 'trading-bot-postgres');
      assert.equal(config.dbPort, 5432);
      assert.equal(config.dbUser, 'trading_bot_admin');
      assert.equal(config.dbName, 'trading_bot');
      assert.equal(config.kafkaBootstrapServers, 'platform-redpanda:9092');
      assert.equal(config.configChangeEventsTopic, 'trading-bot.control-plane.config-changes.v1');
      assert.equal(
        config.backtestCompletedEventsTopic,
        'trading-bot.research-backtesting.backtest-completed.v1'
      );
      assert.equal(
        config.backtestCompletedEventsConsumerGroupId,
        'trading-bot-control-plane-backtest-projection-v1'
      );
      assert.equal(
        config.dataReadinessEventsTopic,
        'trading-bot.market-data.data-readiness-snapshot.v1'
      );
      assert.equal(
        config.dataReadinessEventsConsumerGroupId,
        'trading-bot-control-plane-data-readiness-projection-v1'
      );
      assert.equal(
        config.researchBacktestingBaseUrl,
        'http://trading-bot-research-backtesting:8110'
      );
      assert.equal(config.upstreamRequestTimeoutMs, 30_000);
      assert.deepEqual(config.backtestTimerangeMsByTimeframe, {
        '1m': 600_000_000,
        '3m': 1_800_000_000,
        '5m': 3_000_000_000,
      });
    }
  );
});

test('loadConfig treats blank values as unset', async () => {
  await withEnv(
    {
      POSTGRES_PASSWORD: 'secret',
      PORT: '   ',
      DB_HOST: '',
      BACKTEST_TIMERANGE_MS_BY_TIMEFRAME: ' ',
    },
    () => {
      const config = loadConfig();

      assert.equal(config.port, 8080);
      assert.equal(config.dbHost, 'trading-bot-postgres');
      assert.equal(config.backtestTimerangeMsByTimeframe['1m'], 600_000_000);
    }
  );
});

test('loadConfig parses an explicit timerange map', async () => {
  await withEnv(
    {
      POSTGRES_PASSWORD: 'secret',
      BACKTEST_TIMERANGE_MS_BY_TIMEFRAME: '1m=86400000, 5m=604800000',
    },
    () => {
      assert.deepEqual(loadConfig().backtestTimerangeMsByTimeframe, {
        '1m': 86_400_000,
        '5m': 604_800_000,
      });
    }
  );
});

test('loadConfig rejects values that cannot be parsed instead of falling back', async () => {
  await withEnv(
    {
      POSTGRES_PASSWORD: 'secret',
      UPSTREAM_REQUEST_TIMEOUT_MS: 'soon',
    },
    () => {
      assert.throws(() => loadConfig(), /UPSTREAM_REQUEST_TIMEOUT_MS must be a positive integer/);
    }
  );

  await withEnv(
    {
      POSTGRES_PASSWORD: 'secret',
      PORT: '0',
    },
    () => {
      assert.throws(() => loadConfig(), /PORT must be a positive integer/);
    }
  );

  await withEnv(
    {
      POSTGRES_PASSWORD: 'secret',
      BACKTEST_TIMERANGE_MS_BY_TIMEFRAME: '1m=86400000,5m',
    },
    () => {
      assert.throws(() => loadConfig(), /BACKTEST_TIMERANGE_MS_BY_TIMEFRAME entry "5m"/);
    }
  );
});

test('loadConfig throws when POSTGRES_PASSWORD is missing', async () => {
  await withEnv(
    {
      POSTGRES_PASSWORD: undefined,
    },
    () => {
      assert.throws(() => loadConfig(), /POSTGRES_PASSWORD is required/);
    }
  );
});
