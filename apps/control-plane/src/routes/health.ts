import type { FastifyInstance } from 'fastify';
import type { Gauge } from 'prom-client';
import type { Pool } from 'pg';

import type { AppConfig } from '../config.js';
import { checkDatabaseReadiness } from '../infrastructure/database.js';
import { recordHealth } from '../observability/index.js';

export const registerHealthRoutes = (
  app: FastifyInstance,
  pool: Pool,
  databaseReadinessGauge: Gauge<string>,
  config: AppConfig
): void => {
  app.get(
    '/health',
    {
      schema: {
        summary: 'Health check',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              components: {
                type: 'object',
                properties: {
                  db: {
                    type: 'object',
                    properties: { status: { type: 'string' } },
                  },
                },
              },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              components: {
                type: 'object',
                properties: {
                  db: {
                    type: 'object',
                    properties: { status: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        await checkDatabaseReadiness(pool);
        databaseReadinessGauge.set(1);

        const components = { db: { status: 'up' as const } };
        // The same judgement the response carries, as a metric — otherwise no
        // rule can read the health contract.
        recordHealth('ok', components);

        return { status: 'ok', service: config.serviceName, components };
      } catch (error) {
        databaseReadinessGauge.set(0);
        app.log.error(error, 'Database readiness check failed');
        reply.code(503);

        const components = { db: { status: 'down' as const } };
        recordHealth('error', components);

        return { status: 'error', service: config.serviceName, components };
      }
    }
  );
};
