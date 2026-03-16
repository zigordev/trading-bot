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
};

export const loadConfig = (): AppConfig => {
  const dbPassword = process.env.POSTGRES_PASSWORD ?? "";

  if (!dbPassword.trim()) {
    throw new Error("POSTGRES_PASSWORD is required");
  }

  return {
    appEnv: process.env.APP_ENV ?? "local",
    serviceName: process.env.SERVICE_NAME ?? "trading-bot-control-plane",
    port: Number(process.env.PORT ?? "8080"),
    dbHost: process.env.DB_HOST ?? "trading-bot-postgres",
    dbPort: Number(process.env.DB_PORT ?? "5432"),
    dbUser: process.env.DB_USER ?? "trading_bot_admin",
    dbName: process.env.DB_NAME ?? "trading_bot",
    dbPassword,
    kafkaBootstrapServers:
      process.env.KAFKA_BOOTSTRAP_SERVERS ?? "platform-redpanda:9092",
    configChangeEventsTopic:
      process.env.CONFIG_CHANGE_EVENTS_TOPIC ??
      "trading-bot.control-plane.config-changes.v1",
  };
};
