import type { FastifyInstance } from "fastify";
import type { Registry } from "prom-client";
import type { AppConfig } from "../config.js";

export const registerInfoRoutes = (
  app: FastifyInstance,
  metricsRegistry: Registry,
  config: AppConfig,
): void => {
  app.get(
    "/metrics",
    {
      schema: {
        hide: true,
      },
    },
    async (_request, reply) => {
      reply.header("content-type", metricsRegistry.contentType);
      return metricsRegistry.metrics();
    },
  );

  app.get(
    "/v1/info",
    {
      schema: {
        summary: "Runtime scaffold info",
        response: {
          200: {
            type: "object",
            properties: {
              service: { type: "string" },
              environment: { type: "string" },
              dependencies: {
                type: "object",
                properties: {
                  postgres: { type: "string" },
                  redpanda: { type: "string" },
                  openbao: { type: "string" },
                },
              },
              runtime: {
                type: "object",
                properties: {
                  implemented: {
                    type: "array",
                    items: { type: "string" },
                  },
                  pending: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => ({
      service: config.serviceName,
      environment: config.appEnv,
      dependencies: {
        postgres: `${config.dbHost}:${config.dbPort}/${config.dbName}`,
        redpanda: config.kafkaBootstrapServers,
        openbao: "platform-ops OpenBao",
      },
      runtime: {
        implemented: [
          "HTTP server",
          "health endpoints",
          "metrics endpoint",
          "OpenAPI docs",
          "PostgreSQL readiness check",
          "pairs CRUD",
          "timeframes CRUD",
          "strategies CRUD",
          "risk profiles CRUD",
          "trading defaults CRUD",
          "analysis settings CRUD",
          "config-change event publication",
          "resolved analysis settings runtime projection",
          "market-data service",
          "strategy-engine service",
          "research-backtesting service",
        ],
        pending: [
          "additional consumer-facing configuration projections",
          "execution service",
          "fill-accurate execution backtesting",
        ],
      },
    }),
  );
};
