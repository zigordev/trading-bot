import type { FastifyBaseLogger } from "fastify";
import { Kafka, logLevel, type Consumer } from "kafkajs";
import type { Pool } from "pg";

import type { AppConfig } from "../config.js";
import {
  upsertBacktestBatchFromProgressEvent,
  upsertBacktestJobFromProgressEvent,
} from "../features/ops.js";
import { publishOpsEvent } from "./ops-events.js";

type KafkaAdmin = Pick<
  ReturnType<Kafka["admin"]>,
  "connect" | "disconnect" | "createTopics"
>;

type ConsumerDependencies = {
  consumer?: Pick<Consumer, "connect" | "disconnect" | "subscribe" | "run" | "stop">;
  admin?: KafkaAdmin;
};

export type BacktestProgressEventEnvelope = {
  eventId: string;
  eventType: "trading-bot.research-backtesting.backtest-progress.v1";
  source: string;
  occurredAt: string;
  data: {
    controlPlaneJobId: string;
    analysisSettingId: string;
    riskProfileName: string;
    symbol: string;
    timeframeCode: string;
    strategyName: string;
    stage: string;
    progressPercent: number;
  };
};

export type BacktestBatchProgressEventEnvelope = {
  eventId: string;
  eventType: "trading-bot.research-backtesting.backtest-batch-progress.v1";
  source: string;
  occurredAt: string;
  data: {
    batchId: string;
    symbol: string;
    timeframeCode: string;
    requestedStartTime: number;
    requestedEndTime: number;
    stage: string;
    progressPercent: number;
    totalCount: number;
    completedCount: number;
    runningCount: number;
  };
};

export type BacktestProgressConsumer = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

const jobEventType = "trading-bot.research-backtesting.backtest-progress.v1";
const batchEventType = "trading-bot.research-backtesting.backtest-batch-progress.v1";

const parseEnvelope = (
  value: string,
): BacktestProgressEventEnvelope | BacktestBatchProgressEventEnvelope | null => {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (
    (parsed.eventType !== jobEventType && parsed.eventType !== batchEventType) ||
    typeof parsed.eventId !== "string" ||
    typeof parsed.source !== "string" ||
    typeof parsed.occurredAt !== "string"
  ) {
    return null;
  }

  const data =
    typeof parsed.data === "object" && parsed.data !== null && !Array.isArray(parsed.data)
      ? (parsed.data as Record<string, unknown>)
      : null;
  if (!data) {
    return null;
  }

  if (parsed.eventType === jobEventType) {
    if (
      typeof data.controlPlaneJobId !== "string" ||
      typeof data.analysisSettingId !== "string" ||
      typeof data.riskProfileName !== "string" ||
      typeof data.symbol !== "string" ||
      typeof data.timeframeCode !== "string" ||
      typeof data.strategyName !== "string" ||
      typeof data.stage !== "string"
    ) {
      return null;
    }

    return {
      eventId: parsed.eventId,
      eventType: jobEventType,
      source: parsed.source,
      occurredAt: parsed.occurredAt,
      data: {
        controlPlaneJobId: data.controlPlaneJobId,
        analysisSettingId: data.analysisSettingId,
        riskProfileName: data.riskProfileName,
        symbol: data.symbol,
        timeframeCode: data.timeframeCode,
        strategyName: data.strategyName,
        stage: data.stage,
        progressPercent: Number(data.progressPercent ?? 0),
      },
    };
  }

  if (
    typeof data.batchId !== "string" ||
    typeof data.symbol !== "string" ||
    typeof data.timeframeCode !== "string" ||
    typeof data.stage !== "string"
  ) {
    return null;
  }

  return {
    eventId: parsed.eventId,
    eventType: batchEventType,
    source: parsed.source,
    occurredAt: parsed.occurredAt,
    data: {
      batchId: data.batchId,
      symbol: data.symbol,
      timeframeCode: data.timeframeCode,
      requestedStartTime: Number(data.requestedStartTime ?? 0),
      requestedEndTime: Number(data.requestedEndTime ?? 0),
      stage: data.stage,
      progressPercent: Number(data.progressPercent ?? 0),
      totalCount: Number(data.totalCount ?? 0),
      completedCount: Number(data.completedCount ?? 0),
      runningCount: Number(data.runningCount ?? 0),
    },
  };
};

export const createBacktestProgressConsumer = (
  config: AppConfig,
  logger: FastifyBaseLogger,
  pool: Pool,
  dependencies: ConsumerDependencies = {},
): BacktestProgressConsumer => {
  const kafka = new Kafka({
    clientId: `${config.serviceName}-backtest-progress-consumer`,
    brokers: config.kafkaBootstrapServers
      .split(",")
      .map((broker) => broker.trim())
      .filter(Boolean),
    logLevel: logLevel.NOTHING,
  });
  const consumer =
    dependencies.consumer ??
    kafka.consumer({ groupId: config.backtestProgressEventsConsumerGroupId });
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
            topic: config.backtestProgressEventsTopic,
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
        topic: config.backtestProgressEventsTopic,
        fromBeginning: true,
      });
      await consumer.run({
        eachMessage: async ({ message }) => {
          const rawValue = message.value?.toString("utf8");
          if (!rawValue) {
            return;
          }

          try {
            const envelope = parseEnvelope(rawValue);
            if (!envelope) {
              return;
            }

            if (envelope.eventType === jobEventType) {
              await upsertBacktestJobFromProgressEvent(pool, {
                jobId: envelope.data.controlPlaneJobId,
                analysisSettingId: envelope.data.analysisSettingId,
                riskProfileName: envelope.data.riskProfileName,
                symbolCode: envelope.data.symbol,
                timeframeCode: envelope.data.timeframeCode,
                strategyName: envelope.data.strategyName,
                stage: envelope.data.stage,
                progressPercent: envelope.data.progressPercent,
              });
              publishOpsEvent({
                type: "ops.backtests.updated",
                payload: {
                  symbols: [envelope.data.symbol],
                  timeframeCodes: [envelope.data.timeframeCode],
                },
              });
            } else {
              await upsertBacktestBatchFromProgressEvent(pool, {
                batchId: envelope.data.batchId,
                symbolCode: envelope.data.symbol,
                timeframeCode: envelope.data.timeframeCode,
                requestedStartTime: envelope.data.requestedStartTime,
                requestedEndTime: envelope.data.requestedEndTime,
                stage: envelope.data.stage,
                progressPercent: envelope.data.progressPercent,
                totalCount: envelope.data.totalCount,
                completedCount: envelope.data.completedCount,
                runningCount: envelope.data.runningCount,
              });
              publishOpsEvent({
                type: "ops.backtests.updated",
                payload: {
                  symbols: [envelope.data.symbol],
                  timeframeCodes: [envelope.data.timeframeCode],
                },
              });
            }
          } catch (error) {
            logger.error(
              { err: error, rawValue },
              "Failed to project backtest-progress event",
            );
          }
        },
      });
      started = true;
      logger.info(
        {
          groupId: config.backtestProgressEventsConsumerGroupId,
          topic: config.backtestProgressEventsTopic,
        },
        "Backtest progress consumer started",
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
