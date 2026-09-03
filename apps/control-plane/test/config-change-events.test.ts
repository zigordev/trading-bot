import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  createConfigChangeEventPublisher,
  type ConfigChangeEventEnvelope,
} from '../src/infrastructure/config-change-events.js';
import { createNoopLogger, testConfig } from './helpers.js';

test('createConfigChangeEventPublisher publishes the expected envelope directly to Kafka', async () => {
  const sentPayloads: unknown[] = [];
  let connectCalls = 0;
  let disconnectCalls = 0;
  let adminConnectCalls = 0;
  let adminDisconnectCalls = 0;
  let createTopicsCalls = 0;

  const publisher = createConfigChangeEventPublisher(testConfig, createNoopLogger(), {
    producer: {
      connect: async () => {
        connectCalls += 1;
      },
      disconnect: async () => {
        disconnectCalls += 1;
      },
      send: async (payload) => {
        sentPayloads.push(payload);
      },
    },
    admin: {
      connect: async () => {
        adminConnectCalls += 1;
      },
      disconnect: async () => {
        adminDisconnectCalls += 1;
      },
      createTopics: async () => {
        createTopicsCalls += 1;
        return true;
      },
    },
  });

  await publisher.start();
  await publisher.publish({
    resourceType: 'analysis_settings',
    operation: 'updated',
    resourceId: 'resource-1',
    data: { id: 'resource-1', enabled: false },
  });
  await publisher.stop();

  assert.equal(connectCalls, 1);
  assert.equal(disconnectCalls, 1);
  assert.equal(adminConnectCalls, 1);
  assert.equal(adminDisconnectCalls, 1);
  assert.equal(createTopicsCalls, 1);
  assert.equal(sentPayloads.length, 1);

  const sent = sentPayloads[0] as {
    topic: string;
    messages: Array<{ key?: string; value?: string }>;
  };
  assert.equal(sent.topic, testConfig.configChangeEventsTopic);
  assert.equal(sent.messages.length, 1);
  assert.equal(sent.messages[0]?.key, 'analysis_settings:resource-1');

  const payload = JSON.parse(String(sent.messages[0]?.value)) as ConfigChangeEventEnvelope;
  assert.equal(payload.eventType, 'trading-bot.control-plane.config-changed.v1');
  assert.equal(payload.resourceType, 'analysis_settings');
  assert.equal(payload.operation, 'updated');
  assert.equal(payload.resourceId, 'resource-1');
  assert.deepEqual(payload.data, { id: 'resource-1', enabled: false });
});
