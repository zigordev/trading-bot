import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { collectDefaultMetrics, Gauge, Registry } from "prom-client";

import { loadConfig } from "./config.js";
import {
  createConfigStores,
  ensureControlPlaneSchema,
} from "./features/config-resources.js";
import { HttpError } from "./http-error.js";
import {
  createConfigChangeEventPublisher,
} from "./infrastructure/config-change-events.js";
import { createPool } from "./infrastructure/database.js";
import { registerConfigurationRoutes } from "./routes/configuration.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInfoRoutes } from "./routes/info.js";
import { registerRuntimeConfigRoutes } from "./routes/runtime-config.js";

const config = loadConfig();

const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: "trading_bot_" });

const databaseReadinessGauge = new Gauge({
  name: "trading_bot_control_plane_database_ready",
  help: "Whether the control-plane can reach PostgreSQL",
  registers: [metricsRegistry],
});

const app = Fastify({
  logger: {
    level: "info",
  },
});
const pool = createPool(config);
await ensureControlPlaneSchema(pool);
const configChangePublisher = createConfigChangeEventPublisher(config, app.log);
const stores = createConfigStores(pool, configChangePublisher);
const hasStatusCode = (error: unknown): error is { statusCode: number } =>
  typeof error === "object" &&
  error !== null &&
  "statusCode" in error &&
  typeof error.statusCode === "number";

await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Trading Bot Control Plane",
      version: "0.1.0",
      description:
        "Control-plane API for trading-bot configuration, health, and runtime metadata.",
    },
    tags: [
      { name: "pairs", description: "Tradable market pairs" },
      {
        name: "timeframes",
        description:
          "Operating and higher-order timeframes with canonical period metadata",
      },
      { name: "strategies", description: "Strategy registry and activation state" },
      { name: "risk-profiles", description: "Risk management profiles" },
      {
        name: "trading-defaults",
        description: "Operator-managed default trading profiles and position sizing",
      },
      {
        name: "research-settings",
        description:
          "Backtesting and optimization configuration profiles authored in the control-plane",
      },
      {
        name: "analysis-settings",
        description:
          "Relational bindings between pair, timeframe, strategy, risk profile, and trading defaults",
      },
      {
        name: "runtime-config",
        description:
          "Resolved runtime projections consumed by future trading services",
      },
    ],
  },
});

await app.register(fastifySwaggerUi, {
  routePrefix: "/docs",
});

registerHealthRoutes(app, pool, databaseReadinessGauge, config);
registerInfoRoutes(app, metricsRegistry, config);
registerConfigurationRoutes(app, stores);
registerRuntimeConfigRoutes(app, pool);
await configChangePublisher.start();

app.setErrorHandler((error, _request, reply) => {
  const statusCode =
    error instanceof HttpError
      ? error.statusCode
      : hasStatusCode(error)
        ? error.statusCode
        : 500;

  if (statusCode >= 500) {
    app.log.error(error, "Unhandled control-plane error");
  } else {
    app.log.warn(
      { err: error, statusCode },
      "Control-plane request failed",
    );
  }

  reply.code(statusCode).send({
    statusCode,
    message:
      error instanceof Error && error.message.trim()
        ? error.message
        : "Internal server error",
  });
});

const close = async () => {
  await configChangePublisher.stop();
  await app.close();
  await pool.end();
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, "Shutting down control-plane");
    await close();
    process.exit(0);
  });
}

await app.listen({
  host: "0.0.0.0",
  port: config.port,
});

app.log.info(
  {
    port: config.port,
    service: config.serviceName,
    environment: config.appEnv,
  },
  "Trading bot control-plane started",
);
