import assert from 'node:assert/strict';

import { test } from 'vitest';

import { isFrameworkChatter } from '../../src/observability/framework-logs.js';

test('Nest bootstrap and route mapping are chatter; service.started already says the service is up', () => {
  for (const context of [
    'InstanceLoader',
    'NestApplication',
    'NestFactory',
    'RouterExplorer',
    'RoutesResolver',
    'WebSocketsController',
  ]) {
    assert.equal(isFrameworkChatter('Mapped {/pools, GET} route', context), true);
  }
});

test('Fastify announcing its address is chatter', () => {
  assert.equal(isFrameworkChatter('Server listening at http://0.0.0.0:8080'), true);
});

test('application lines are not, whatever they say', () => {
  assert.equal(isFrameworkChatter('Server listening at http://0.0.0.0:8080', 'PoolService'), false);
  assert.equal(isFrameworkChatter({ event: 'pool.created' }, 'PoolService'), false);
  assert.equal(isFrameworkChatter('mapped', 'PoolService'), false);
  assert.equal(isFrameworkChatter(undefined), false);
});
