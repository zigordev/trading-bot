import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';

import { loadConfig } from './config.js';
import { createConfigStores, ensureControlPlaneSchema } from './features/config-resources.js';
import { ensureOpsSchema } from './features/ops.js';
import { HttpError } from './http-error.js';
import { createConfigChangeEventPublisher } from './infrastructure/config-change-events.js';
import { createBacktestRunProjectionConsumer } from './infrastructure/backtest-run-events.js';
import { createBacktestProgressConsumer } from './infrastructure/backtest-progress-events.js';
import { createDataReadinessProjectionConsumer } from './infrastructure/data-readiness-events.js';
import { createPool } from './infrastructure/database.js';
import { closeOpsSockets } from './infrastructure/ops-events.js';
import { registerConfigurationRoutes } from './routes/configuration.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerOpsRoutes } from './routes/ops.js';
import { registerRuntimeConfigRoutes } from './routes/runtime-config.js';

const config = loadConfig();

const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: 'trading_bot_' });

const databaseReadinessGauge = new Gauge({
  name: 'trading_bot_control_plane_database_ready',
  help: 'Whether the control-plane can reach PostgreSQL',
  registers: [metricsRegistry],
});

const app = Fastify({
  logger: {
    level: 'info',
  },
});
const pool = createPool(config);
await ensureControlPlaneSchema(pool);
await ensureOpsSchema(pool);
const configChangePublisher = createConfigChangeEventPublisher(config, app.log);
const backtestRunProjectionConsumer = createBacktestRunProjectionConsumer(config, app.log, pool);
const backtestProgressConsumer = createBacktestProgressConsumer(config, app.log, pool);
const dataReadinessProjectionConsumer = createDataReadinessProjectionConsumer(
  config,
  app.log,
  pool
);
const stores = createConfigStores(pool, configChangePublisher);
const hasStatusCode = (error: unknown): error is { statusCode: number } =>
  typeof error === 'object' &&
  error !== null &&
  'statusCode' in error &&
  typeof error.statusCode === 'number';

// Security headers. CSP is off for the same reason as the Nest APIs: this
// serves JSON and Swagger UI, and a default policy blocks the inline scripts
// Swagger needs. HSTS, nosniff, frame-options and referrer-policy still apply.
await app.register(fastifyHelmet, { contentSecurityPolicy: false });

await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'Trading Bot Control Plane',
      version: '0.1.0',
      description: 'Control-plane API for trading-bot configuration, health, and runtime metadata.',
    },
    tags: [
      { name: 'symbols', description: 'Tradable market symbols' },
      {
        name: 'timeframes',
        description: 'Operating and higher-order timeframes with canonical period metadata',
      },
      { name: 'strategies', description: 'Strategy registry and activation state' },
      { name: 'risk-profiles', description: 'Risk management profiles' },
      {
        name: 'execution-settings',
        description: 'Execution promotion and operating policy for the active trading module',
      },
      {
        name: 'analysis-settings',
        description:
          'Reusable technical-analysis settings expanded across active symbols, timeframes, and risk profiles',
      },
      {
        name: 'runtime-config',
        description: 'Resolved runtime projections consumed by future trading services',
      },
      {
        name: 'ops',
        description: 'Operator-facing aggregated runtime views for the console',
      },
    ],
  },
});

await app.register(fastifySwaggerUi, {
  routePrefix: '/docs',
});

await app.register(fastifyCors, {
  origin: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});
await app.register(fastifyWebsocket);

registerHealthRoutes(app, pool, databaseReadinessGauge, config);
registerConfigurationRoutes(app, config, stores);
registerRuntimeConfigRoutes(app, pool);
registerOpsRoutes(app, config, pool);
await configChangePublisher.start();
await backtestRunProjectionConsumer.start();
await backtestProgressConsumer.start();
await dataReadinessProjectionConsumer.start();

app.get(
  '/metrics',
  {
    schema: {
      hide: true,
    },
  },
  async (_request, reply) => {
    reply.header('content-type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  }
);

app.setErrorHandler((error, _request, reply) => {
  const statusCode =
    error instanceof HttpError ? error.statusCode : hasStatusCode(error) ? error.statusCode : 500;

  if (statusCode >= 500) {
    app.log.error(error, 'Unhandled control-plane error');
  } else {
    app.log.warn({ err: error, statusCode }, 'Control-plane request failed');
  }

  reply.code(statusCode).send({
    statusCode,
    message:
      error instanceof Error && error.message.trim() ? error.message : 'Internal server error',
  });
});

const close = async () => {
  closeOpsSockets();
  await backtestRunProjectionConsumer.stop();
  await backtestProgressConsumer.stop();
  await dataReadinessProjectionConsumer.stop();
  await configChangePublisher.stop();
  await app.close();
  await pool.end();
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'Shutting down control-plane');
    await close();
    process.exit(0);
  });
}

await app.listen({
  host: '0.0.0.0',
  port: config.port,
});

app.log.info(
  {
    port: config.port,
    service: config.serviceName,
    environment: config.appEnv,
  },
  'Trading bot control-plane started'
);
