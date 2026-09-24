import type { FastifyInstance } from 'fastify';
import type { Gauge } from 'prom-client';
import type { Pool } from 'pg';

import type { AppConfig } from '../config.js';
import { checkDatabaseReadiness } from '../infrastructure/database.js';
import { currentRelease } from '../observability/json-logger.js';
import { recordHealth } from '../observability/index.js';

const releaseField = (): { release?: string } => {
  const release = currentRelease();
  return release ? { release } : {};
};

export const registerHealthRoutes = (
  app: FastifyInstance,
  pool: Pool,
  databaseReadinessGauge: Gauge<string>,
  config: AppConfig
): void => {
  let databaseUp: boolean | undefined;

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
              release: { type: 'string' },
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
              release: { type: 'string' },
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
        if (databaseUp === false) app.log.info({ event: 'postgres.recovered' });
        databaseUp = true;

        const components = { db: { status: 'up' as const } };
        // The same judgement the response carries, as a metric — otherwise no
        // rule can read the health contract.
        recordHealth('ok', components);

        return { status: 'ok', service: config.serviceName, ...releaseField(), components };
      } catch (error) {
        databaseReadinessGauge.set(0);
        if (databaseUp !== false) app.log.error({ event: 'postgres.unavailable', error });
        databaseUp = false;
        reply.code(503);

        const components = { db: { status: 'down' as const } };
        recordHealth('error', components);

        return { status: 'error', service: config.serviceName, ...releaseField(), components };
      }
    }
  );
};
