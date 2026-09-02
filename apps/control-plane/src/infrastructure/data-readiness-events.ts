import type { FastifyBaseLogger } from 'fastify';
import { Kafka, logLevel, type Consumer } from 'kafkajs';
import type { Pool } from 'pg';

import type { AppConfig } from '../config.js';
import {
  replaceDataReadinessProjections,
  type DataReadinessProjectionInput,
} from '../features/ops.js';
import { publishOpsEvent } from './ops-events.js';

type KafkaAdmin = Pick<ReturnType<Kafka['admin']>, 'connect' | 'disconnect' | 'createTopics'>;

type ConsumerDependencies = {
  consumer?: Pick<Consumer, 'connect' | 'disconnect' | 'subscribe' | 'run' | 'stop'>;
  admin?: KafkaAdmin;
};

export type DataReadinessSnapshotEnvelope = {
  eventId: string;
  eventType: 'trading-bot.market-data.data-readiness-snapshot.v1';
  source: string;
  occurredAt: string;
  data: {
    items: Array<Omit<DataReadinessProjectionInput, 'sourceEventId' | 'sourceOccurredAt'>>;
  };
};

export type DataReadinessProjectionConsumer = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

const eventType = 'trading-bot.market-data.data-readiness-snapshot.v1';

const isProjectionStatus = (value: unknown): value is DataReadinessProjectionInput['status'] =>
  value === 'ready' || value === 'partial' || value === 'missing' || value === 'error';

const parseEnvelope = (value: string): DataReadinessSnapshotEnvelope | null => {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (
    parsed.eventType !== eventType ||
    typeof parsed.eventId !== 'string' ||
    typeof parsed.source !== 'string' ||
    typeof parsed.occurredAt !== 'string'
  ) {
    return null;
  }

  const data =
    typeof parsed.data === 'object' && parsed.data !== null && !Array.isArray(parsed.data)
      ? (parsed.data as Record<string, unknown>)
      : null;
  const items = Array.isArray(data?.items) ? data.items : null;
  if (!items) {
    return null;
  }

  return {
    eventId: parsed.eventId,
    eventType,
    source: parsed.source,
    occurredAt: parsed.occurredAt,
    data: {
      items: items
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
          status: isProjectionStatus(item.status) ? item.status : 'error',
          symbolCode:
            typeof item.symbolCode === 'string'
              ? item.symbolCode
              : typeof item.pairCode === 'string'
                ? item.pairCode
                : '',
          timeframeCode: typeof item.timeframeCode === 'string' ? item.timeframeCode : '',
          strategyName: typeof item.strategyName === 'string' ? item.strategyName : '',
          analysisSettingIds: Array.isArray(item.analysisSettingIds)
            ? item.analysisSettingIds.map((value) => String(value))
            : [],
          requestedStartTime: Number(item.requestedStartTime ?? 0),
          requestedEndTime: Number(item.requestedEndTime ?? 0),
          requiredHistoryMs: Number(item.requiredHistoryMs ?? 0),
          details: typeof item.details === 'string' ? item.details : null,
          kline:
            item.kline && typeof item.kline === 'object' && !Array.isArray(item.kline)
              ? (item.kline as Record<string, unknown>)
              : null,
          klineDimensions: Array.isArray(item.klineDimensions)
            ? item.klineDimensions.filter(
                (value): value is Record<string, unknown> =>
                  typeof value === 'object' && value !== null && !Array.isArray(value)
              )
            : null,
          trades:
            item.trades && typeof item.trades === 'object' && !Array.isArray(item.trades)
              ? (item.trades as Record<string, unknown>)
              : null,
        }))
        .filter((item) => item.symbolCode && item.timeframeCode && item.strategyName),
    },
  };
};

export const createDataReadinessProjectionConsumer = (
  config: AppConfig,
  logger: FastifyBaseLogger,
  pool: Pool,
  dependencies: ConsumerDependencies = {}
): DataReadinessProjectionConsumer => {
  const kafka = new Kafka({
    clientId: `${config.serviceName}-data-readiness-projection-consumer`,
    brokers: config.kafkaBootstrapServers
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean),
    logLevel: logLevel.NOTHING,
  });
  const consumer =
    dependencies.consumer ?? kafka.consumer({ groupId: config.dataReadinessEventsConsumerGroupId });
  const admin = dependencies.admin ?? kafka.admin();

  let started = false;
  let stopped = false;

  const ensureTopicExists = async (): Promise<void> => {
    await admin.connect();

    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: [
          {
            topic: config.dataReadinessEventsTopic,
            numPartitions: 1,
            replicationFactor: 1,
          },
        ],
      });
    } finally {
      await admin.disconnect();
    }
  };

  return {
    start: async () => {
      if (started && !stopped) {
        return;
      }

      stopped = false;
      await ensureTopicExists();
      await consumer.connect();
      await consumer.subscribe({
        topic: config.dataReadinessEventsTopic,
        fromBeginning: true,
      });
      await consumer.run({
        eachMessage: async ({ message }) => {
          const rawValue = message.value?.toString('utf8');
          if (!rawValue) {
            return;
          }

          try {
            const envelope = parseEnvelope(rawValue);
            if (!envelope) {
              return;
            }

            await replaceDataReadinessProjections(
              pool,
              envelope.data.items.map((item) => ({
                ...item,
                sourceEventId: envelope.eventId,
                sourceOccurredAt: envelope.occurredAt,
              }))
            );
            publishOpsEvent({
              type: 'ops.data-readiness.updated',
              payload: {
                symbols: [...new Set(envelope.data.items.map((item) => item.symbolCode))],
                timeframeCodes: [...new Set(envelope.data.items.map((item) => item.timeframeCode))],
                strategyNames: [...new Set(envelope.data.items.map((item) => item.strategyName))],
              },
            });
          } catch (error) {
            logger.error(
              { err: error, rawValue },
              'Failed to project data-readiness snapshot event'
            );
          }
        },
      });
      started = true;
      logger.info(
        {
          groupId: config.dataReadinessEventsConsumerGroupId,
          topic: config.dataReadinessEventsTopic,
        },
        'Data-readiness projection consumer started'
      );
    },
    stop: async () => {
      if (!started || stopped) {
        return;
      }

      stopped = true;
      await consumer.stop();
      await consumer.disconnect();
    },
  };
};
