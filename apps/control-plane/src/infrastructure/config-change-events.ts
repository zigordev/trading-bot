import { randomUUID } from "node:crypto";

import type { FastifyBaseLogger } from "fastify";
import { Kafka, logLevel, type Producer } from "kafkajs";

import type { AppConfig } from "../config.js";

export type ConfigChangeOperation = "created" | "updated" | "deleted";

export type ConfigChangeEventEnvelope = {
  eventId: string;
  eventType: "trading-bot.control-plane.config-changed.v1";
  source: string;
  occurredAt: string;
  resourceType: string;
  operation: ConfigChangeOperation;
  resourceId: string;
  data: unknown;
};

type PublishConfigChangeEventParams = {
  resourceType: string;
  operation: ConfigChangeOperation;
  resourceId: string;
  data: unknown;
};

export type ConfigChangeEventPublisher = {
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(params: PublishConfigChangeEventParams): Promise<void>;
};

type ConfigChangeEventProducer = Pick<Producer, "connect" | "disconnect" | "send">;
type ConfigChangeEventAdmin = Pick<
  ReturnType<Kafka["admin"]>,
  "connect" | "disconnect" | "createTopics"
>;

type PublisherDependencies = {
  producer?: ConfigChangeEventProducer;
  admin?: ConfigChangeEventAdmin;
};

const configChangeEventType = "trading-bot.control-plane.config-changed.v1";

const buildConfigChangeEventEnvelope = (
  config: AppConfig,
  params: PublishConfigChangeEventParams,
  timestamp = new Date(),
): ConfigChangeEventEnvelope => ({
  eventId: randomUUID(),
  eventType: configChangeEventType,
  source: config.serviceName,
  occurredAt: timestamp.toISOString(),
  resourceType: params.resourceType,
  operation: params.operation,
  resourceId: params.resourceId,
  data: params.data,
});

export const createConfigChangeEventPublisher = (
  config: AppConfig,
  logger: FastifyBaseLogger,
  dependencies: PublisherDependencies = {},
): ConfigChangeEventPublisher => {
  const kafka = new Kafka({
    clientId: `${config.serviceName}-config-change-publisher`,
    brokers: config.kafkaBootstrapServers
      .split(",")
      .map((broker) => broker.trim())
      .filter(Boolean),
    logLevel: logLevel.NOTHING,
  });
  const producer: ConfigChangeEventProducer =
    dependencies.producer ?? kafka.producer();
  const admin: ConfigChangeEventAdmin = dependencies.admin ?? kafka.admin();
  let producerConnected = false;
  let started = false;
  let stopped = false;

  const disconnectProducer = async (): Promise<void> => {
    if (!producerConnected) {
      return;
    }

    try {
      await producer.disconnect();
    } catch (error) {
      logger.warn({ err: error }, "Failed to disconnect config-change producer cleanly");
    } finally {
      producerConnected = false;
    }
  };

  const ensureProducerConnected = async (): Promise<void> => {
    if (producerConnected) {
      return;
    }

    await producer.connect();
    producerConnected = true;
    logger.info(
      {
        brokers: config.kafkaBootstrapServers,
        topic: config.configChangeEventsTopic,
      },
      "Config-change producer connected",
    );
  };

  const ensureTopicExists = async (): Promise<void> => {
    await admin.connect();

    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: [
          {
            topic: config.configChangeEventsTopic,
            numPartitions: 1,
            replicationFactor: 1,
          },
        ],
      });
    } finally {
      await admin.disconnect();
    }
  };

  const ensureStarted = async (): Promise<void> => {
    if (started && !stopped) {
      return;
    }

    stopped = false;
    await ensureTopicExists();
    await ensureProducerConnected();
    started = true;
  };

  return {
    start: async () => {
      await ensureStarted();
    },
    stop: async () => {
      if (!started || stopped) {
        return;
      }

      stopped = true;
      await disconnectProducer();
    },
    publish: async (params) => {
      if (stopped) {
        logger.warn(
          {
            resourceType: params.resourceType,
            operation: params.operation,
            resourceId: params.resourceId,
          },
          "Skipping config-change publish because the publisher is stopping",
        );
        return;
      }

      const envelope = buildConfigChangeEventEnvelope(config, params);

      try {
        await ensureStarted();
        await producer.send({
          topic: config.configChangeEventsTopic,
          messages: [
            {
              key: `${envelope.resourceType}:${envelope.resourceId}`,
              value: JSON.stringify(envelope),
            },
          ],
        });
      } catch (error) {
        logger.error(
          {
            err: error,
            eventId: envelope.eventId,
            resourceType: envelope.resourceType,
            operation: envelope.operation,
            resourceId: envelope.resourceId,
          },
          "Failed to publish config-change event directly to Kafka",
        );
        await disconnectProducer();
      }
    },
  };
};
