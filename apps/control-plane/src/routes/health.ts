import type { FastifyInstance } from 'fastify';
import type { Gauge } from 'prom-client';
import type { Pool } from 'pg';

import type { AppConfig } from '../config.js';
import { checkDatabaseReadiness } from '../infrastructure/database.js';

export const registerHealthRoutes = (
  app: FastifyInstance,
  pool: Pool,
  databaseReadinessGauge: Gauge<string>,
  config: AppConfig
): void => {
  app.get(
    '/health/liveness',
    {
      schema: {
        summary: 'Liveness probe',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({
      status: 'ok',
      service: config.serviceName,
    })
  );

  app.get(
    '/health/readiness',
    {
      schema: {
        summary: 'Readiness probe',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              checks: {
                type: 'object',
                properties: {
                  database: { type: 'string' },
                },
              },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              checks: {
                type: 'object',
                properties: {
                  database: { type: 'string' },
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

        return {
          status: 'ok',
          service: config.serviceName,
          checks: {
            database: 'up',
          },
        };
      } catch (error) {
        databaseReadinessGauge.set(0);
        app.log.error(error, 'Database readiness check failed');
        reply.code(503);

        return {
          status: 'degraded',
          service: config.serviceName,
          checks: {
            database: 'down',
          },
        };
      }
    }
  );
};
