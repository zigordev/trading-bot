export type AppConfig = {
  appEnv: string;
  serviceName: string;
  port: number;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbName: string;
  dbPassword: string;
  kafkaBootstrapServers: string;
  configChangeEventsTopic: string;
  backtestCompletedEventsTopic: string;
  backtestCompletedEventsConsumerGroupId: string;
  backtestProgressEventsTopic: string;
  backtestProgressEventsConsumerGroupId: string;
  dataReadinessEventsTopic: string;
  dataReadinessEventsConsumerGroupId: string;
  marketDataBaseUrl: string;
  researchBacktestingBaseUrl: string;
  upstreamRequestTimeoutMs: number;
  binanceReferenceBaseUrl: string;
  opsStreamIntervalMs: number;
  backtestWarmupCandles: number;
  backtestTimerangeMsByTimeframe: Record<string, number>;
};

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? '');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseTimerangeMap = (value: string | undefined): Record<string, number> => {
  const source = value?.trim();
  if (!source) {
    return {
      '1m': 600_000_000,
      '3m': 1_800_000_000,
      '5m': 3_000_000_000,
    };
  }

  return source.split(',').reduce<Record<string, number>>((accumulator, entry) => {
    const [timeframeCode, durationMs] = entry.split('=');
    if (!timeframeCode || !durationMs) {
      return accumulator;
    }

    const parsed = Number(durationMs.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      accumulator[timeframeCode.trim()] = parsed;
    }

    return accumulator;
  }, {});
};

export const loadConfig = (): AppConfig => {
  const dbPassword = process.env.POSTGRES_PASSWORD ?? '';

  if (!dbPassword.trim()) {
    throw new Error('POSTGRES_PASSWORD is required');
  }

  return {
    appEnv: process.env.APP_ENV ?? 'local',
    // `OTEL_SERVICE_NAME` is the estate-wide name: it is what health
    // reports, what OTel tags spans with, and what every log line carries.
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'trading-bot-control-plane',
    port: Number(process.env.PORT ?? '8080'),
    dbHost: process.env.DB_HOST ?? 'trading-bot-postgres',
    dbPort: Number(process.env.DB_PORT ?? '5432'),
    dbUser: process.env.DB_USER ?? 'trading_bot_admin',
    dbName: process.env.DB_NAME ?? 'trading_bot',
    dbPassword,
    kafkaBootstrapServers: process.env.KAFKA_BOOTSTRAP_SERVERS ?? 'platform-redpanda:9092',
    configChangeEventsTopic:
      process.env.CONFIG_CHANGE_EVENTS_TOPIC ?? 'trading-bot.control-plane.config-changes.v1',
    backtestCompletedEventsTopic:
      process.env.BACKTEST_COMPLETED_EVENTS_TOPIC ??
      'trading-bot.research-backtesting.backtest-completed.v1',
    backtestCompletedEventsConsumerGroupId:
      process.env.BACKTEST_COMPLETED_EVENTS_CONSUMER_GROUP_ID ??
      'trading-bot-control-plane-backtest-projection-v1',
    backtestProgressEventsTopic:
      process.env.BACKTEST_PROGRESS_EVENTS_TOPIC ??
      'trading-bot.research-backtesting.backtest-progress.v1',
    backtestProgressEventsConsumerGroupId:
      process.env.BACKTEST_PROGRESS_EVENTS_CONSUMER_GROUP_ID ??
      'trading-bot-control-plane-backtest-progress-v1',
    dataReadinessEventsTopic:
      process.env.DATA_READINESS_EVENTS_TOPIC ??
      'trading-bot.market-data.data-readiness-snapshot.v1',
    dataReadinessEventsConsumerGroupId:
      process.env.DATA_READINESS_EVENTS_CONSUMER_GROUP_ID ??
      'trading-bot-control-plane-data-readiness-projection-v1',
    marketDataBaseUrl: process.env.MARKET_DATA_BASE_URL ?? 'http://trading-bot-market-data:8090',
    researchBacktestingBaseUrl:
      process.env.RESEARCH_BACKTESTING_BASE_URL ?? 'http://research-backtesting:8110',
    upstreamRequestTimeoutMs: parsePositiveInteger(process.env.UPSTREAM_REQUEST_TIMEOUT_MS, 5000),
    binanceReferenceBaseUrl: process.env.BINANCE_REFERENCE_BASE_URL ?? 'https://api.binance.com',
    opsStreamIntervalMs: parsePositiveInteger(process.env.OPS_STREAM_INTERVAL_MS, 5000),
    backtestWarmupCandles: parsePositiveInteger(process.env.BACKTEST_WARMUP_CANDLES, 200),
    backtestTimerangeMsByTimeframe: parseTimerangeMap(
      process.env.BACKTEST_TIMERANGE_MS_BY_TIMEFRAME
    ),
  };
};
