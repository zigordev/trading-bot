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

const DEFAULT_BACKTEST_TIMERANGE_MS_BY_TIMEFRAME: Readonly<Record<string, number>> = {
  '1m': 600_000_000,
  '3m': 1_800_000_000,
  '5m': 3_000_000_000,
};

const stringValue = (name: string, fallback: string): string => {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
};

const positiveInteger = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const timerangeMap = (name: string): Record<string, number> => {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return { ...DEFAULT_BACKTEST_TIMERANGE_MS_BY_TIMEFRAME };
  }

  const map: Record<string, number> = {};
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const [timeframeCode, durationMs, ...rest] = trimmed.split('=');
    const parsed = Number(durationMs?.trim());
    if (!timeframeCode?.trim() || rest.length > 0 || !Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `${name} entry "${trimmed}" must be timeframeCode=durationMs with a positive duration`
      );
    }

    map[timeframeCode.trim()] = parsed;
  }

  return Object.keys(map).length > 0 ? map : { ...DEFAULT_BACKTEST_TIMERANGE_MS_BY_TIMEFRAME };
};

export const loadConfig = (): AppConfig => {
  const dbPassword = process.env.POSTGRES_PASSWORD?.trim() ?? '';

  if (!dbPassword) {
    throw new Error('POSTGRES_PASSWORD is required');
  }

  return {
    appEnv: stringValue('APP_ENV', 'local'),
    serviceName: stringValue('OTEL_SERVICE_NAME', 'trading-bot-control-plane'),
    port: positiveInteger('PORT', 8080),
    dbHost: stringValue('DB_HOST', 'trading-bot-postgres'),
    dbPort: positiveInteger('DB_PORT', 5432),
    dbUser: stringValue('DB_USER', 'trading_bot_admin'),
    dbName: stringValue('DB_NAME', 'trading_bot'),
    dbPassword,
    kafkaBootstrapServers: stringValue('KAFKA_BOOTSTRAP_SERVERS', 'platform-redpanda:9092'),
    configChangeEventsTopic: stringValue(
      'CONFIG_CHANGE_EVENTS_TOPIC',
      'trading-bot.control-plane.config-changes.v1'
    ),
    backtestCompletedEventsTopic: stringValue(
      'BACKTEST_COMPLETED_EVENTS_TOPIC',
      'trading-bot.research-backtesting.backtest-completed.v1'
    ),
    backtestCompletedEventsConsumerGroupId: stringValue(
      'BACKTEST_COMPLETED_EVENTS_CONSUMER_GROUP_ID',
      'trading-bot-control-plane-backtest-projection-v1'
    ),
    backtestProgressEventsTopic: stringValue(
      'BACKTEST_PROGRESS_EVENTS_TOPIC',
      'trading-bot.research-backtesting.backtest-progress.v1'
    ),
    backtestProgressEventsConsumerGroupId: stringValue(
      'BACKTEST_PROGRESS_EVENTS_CONSUMER_GROUP_ID',
      'trading-bot-control-plane-backtest-progress-v1'
    ),
    dataReadinessEventsTopic: stringValue(
      'DATA_READINESS_EVENTS_TOPIC',
      'trading-bot.market-data.data-readiness-snapshot.v1'
    ),
    dataReadinessEventsConsumerGroupId: stringValue(
      'DATA_READINESS_EVENTS_CONSUMER_GROUP_ID',
      'trading-bot-control-plane-data-readiness-projection-v1'
    ),
    marketDataBaseUrl: stringValue('MARKET_DATA_BASE_URL', 'http://trading-bot-market-data:8090'),
    researchBacktestingBaseUrl: stringValue(
      'RESEARCH_BACKTESTING_BASE_URL',
      'http://trading-bot-research-backtesting:8110'
    ),
    upstreamRequestTimeoutMs: positiveInteger('UPSTREAM_REQUEST_TIMEOUT_MS', 30_000),
    binanceReferenceBaseUrl: stringValue('BINANCE_REFERENCE_BASE_URL', 'https://api.binance.com'),
    opsStreamIntervalMs: positiveInteger('OPS_STREAM_INTERVAL_MS', 5000),
    backtestWarmupCandles: positiveInteger('BACKTEST_WARMUP_CANDLES', 200),
    backtestTimerangeMsByTimeframe: timerangeMap('BACKTEST_TIMERANGE_MS_BY_TIMEFRAME'),
  };
};
