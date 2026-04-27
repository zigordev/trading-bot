import type { FastifyBaseLogger } from "fastify";
import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
import type { Pool } from "pg";

import type { AppConfig } from "../config.js";
import {
  completeBacktestJobFromProjectionEvent,
  promoteBacktestRunIfEligible,
  type BacktestRunProjectionInput,
  upsertBacktestRunProjection,
} from "../features/ops.js";
import { publishOpsEvent } from "./ops-events.js";

export type BacktestCompletedEventEnvelope = {
  eventId: string;
  eventType: "trading-bot.research-backtesting.backtest-completed.v1";
  source: string;
  occurredAt: string;
  data: Omit<BacktestRunProjectionInput, "sourceEventId" | "sourceOccurredAt"> & {
    controlPlaneJobId?: string;
  };
};

type KafkaAdmin = Pick<
  ReturnType<Kafka["admin"]>,
  "connect" | "disconnect" | "createTopics"
>;

type ConsumerDependencies = {
  consumer?: Pick<Consumer, "connect" | "disconnect" | "subscribe" | "run" | "stop">;
  admin?: KafkaAdmin;
};

export type BacktestRunProjectionConsumer = {
  start(): Promise<void>;
  stop(): Promise<void>;
  hydrate(): Promise<void>;
};

type FetchJson = (url: string, init?: RequestInit) => Promise<unknown>;

const eventType = "trading-bot.research-backtesting.backtest-completed.v1";

const parseEnvelope = (value: string): BacktestCompletedEventEnvelope | null => {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (parsed.eventType !== eventType) {
    return null;
  }

  const data =
    typeof parsed.data === "object" && parsed.data !== null && !Array.isArray(parsed.data)
      ? (parsed.data as Record<string, unknown>)
      : null;
  if (!data) {
    return null;
  }

  const requiredStrings = [
    "backtestId",
    "finishedAt",
    "analysisSettingId",
    "riskProfileName",
    "symbol",
    "timeframeCode",
    "strategyName",
  ] as const;

  if (
    typeof parsed.eventId !== "string" ||
    typeof parsed.source !== "string" ||
    typeof parsed.occurredAt !== "string"
  ) {
    return null;
  }

  for (const key of requiredStrings) {
    if (typeof data[key] !== "string") {
      return null;
    }
  }

  return {
    eventId: parsed.eventId,
    eventType,
    source: parsed.source,
    occurredAt: parsed.occurredAt,
    data: {
      controlPlaneJobId:
        typeof data.controlPlaneJobId === "string" ? data.controlPlaneJobId : undefined,
      backtestId: data.backtestId as string,
      finishedAt: data.finishedAt as string,
      backtestDurationMs: Number(data.backtestDurationMs ?? 0),
      dataRetrievalDurationMs: Number(data.dataRetrievalDurationMs ?? 0),
      analysisSettingId: data.analysisSettingId as string,
      riskProfileName: data.riskProfileName as string,
      symbol: data.symbol as string,
      timeframeCode: data.timeframeCode as string,
      strategyName: data.strategyName as string,
      requestedStartTime: Number(data.requestedStartTime ?? 0),
      requestedEndTime: Number(data.requestedEndTime ?? 0),
      replayKlineCount: Number(data.replayKlineCount ?? 0),
      replayTradeCount: Number(data.replayTradeCount ?? 0),
      signalCount: Number(data.signalCount ?? 0),
      tradeCount: Number(data.tradeCount ?? 0),
      stopLossTradeCount: Number(data.stopLossTradeCount ?? 0),
      takeProfitTradeCount: Number(data.takeProfitTradeCount ?? 0),
      reversalTradeCount: Number(data.reversalTradeCount ?? 0),
      windowEndTradeCount: Number(data.windowEndTradeCount ?? 0),
      nonReversalTradeCount: Number(data.nonReversalTradeCount ?? 0),
      totalPnlPercent: Number(data.totalPnlPercent ?? 0),
      equityCurvePnlPercent: Number(data.equityCurvePnlPercent ?? 0),
      maxDrawdownPercent: Number(data.maxDrawdownPercent ?? 0),
      reversalRatio: Number(data.reversalRatio ?? 0),
      score: Number(data.score ?? 0),
    },
  };
};

const createFetchJson = (config: AppConfig): FetchJson => async (url, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.upstreamRequestTimeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const toProjectionInput = (
  envelope: BacktestCompletedEventEnvelope,
): BacktestRunProjectionInput => {
  const { controlPlaneJobId: _controlPlaneJobId, ...data } = envelope.data;
  return {
    ...data,
    sourceEventId: envelope.eventId,
    sourceOccurredAt: envelope.occurredAt,
  };
};

export const createBacktestRunProjectionConsumer = (
  config: AppConfig,
  logger: FastifyBaseLogger,
  pool: Pool,
  dependencies: ConsumerDependencies = {},
): BacktestRunProjectionConsumer => {
  const kafka = new Kafka({
    clientId: `${config.serviceName}-backtest-projection-consumer`,
    brokers: config.kafkaBootstrapServers
      .split(",")
      .map((broker) => broker.trim())
      .filter(Boolean),
    logLevel: logLevel.NOTHING,
  });
  const consumer =
    dependencies.consumer ??
    kafka.consumer({ groupId: config.backtestCompletedEventsConsumerGroupId });
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
            topic: config.backtestCompletedEventsTopic,
            numPartitions: 1,
            replicationFactor: 1,
          },
        ],
      });
    } finally {
      await admin.disconnect();
    }
  };

  const hydrate = async (): Promise<void> => {
    const fetchJson = createFetchJson(config);
    try {
      const payload = await fetchJson(
        `${config.researchBacktestingBaseUrl}/v1/backtests?limit=200`,
      );
      if (!Array.isArray(payload)) {
        return;
      }

      for (const item of payload) {
        if (typeof item !== "object" || item === null) {
          continue;
        }
        const run = item as Record<string, unknown>;
        if (
          typeof run.backtestId !== "string" ||
          typeof run.finishedAt !== "string" ||
          typeof run.analysisSettingId !== "string" ||
          typeof run.riskProfileName !== "string" ||
          typeof run.symbol !== "string" ||
          typeof run.timeframeCode !== "string" ||
          typeof run.strategyName !== "string"
        ) {
          continue;
        }

        await upsertBacktestRunProjection(pool, {
          backtestId: run.backtestId,
          finishedAt: run.finishedAt,
          backtestDurationMs: Number(run.backtestDurationMs ?? 0),
          dataRetrievalDurationMs: Number(run.dataRetrievalDurationMs ?? 0),
          analysisSettingId: run.analysisSettingId,
          riskProfileName: run.riskProfileName,
          symbol: run.symbol,
          timeframeCode: run.timeframeCode,
          strategyName: run.strategyName,
          requestedStartTime: Number(run.requestedStartTime ?? 0),
          requestedEndTime: Number(run.requestedEndTime ?? 0),
          replayKlineCount: Number(run.replayKlineCount ?? 0),
          replayTradeCount: Number(run.replayTradeCount ?? 0),
          signalCount: Number(run.signalCount ?? 0),
          tradeCount: Number(run.tradeCount ?? 0),
          stopLossTradeCount: Number((run as Record<string, unknown>).stopLossTradeCount ?? 0),
          takeProfitTradeCount: Number((run as Record<string, unknown>).takeProfitTradeCount ?? 0),
          reversalTradeCount: Number((run as Record<string, unknown>).reversalTradeCount ?? 0),
          windowEndTradeCount: Number((run as Record<string, unknown>).windowEndTradeCount ?? 0),
          nonReversalTradeCount: Number((run as Record<string, unknown>).nonReversalTradeCount ?? 0),
          totalPnlPercent: Number(run.totalPnlPercent ?? 0),
          equityCurvePnlPercent: Number(run.equityCurvePnlPercent ?? 0),
          maxDrawdownPercent: Number(run.maxDrawdownPercent ?? 0),
          reversalRatio: Number(run.reversalRatio ?? 0),
          score: Number(run.score ?? 0),
          sourceEventId: `bootstrap:${run.backtestId}`,
          sourceOccurredAt: run.finishedAt,
        });
      }

      logger.info(
        { hydratedRuns: payload.length },
        "Backtest projection hydrated from research-backtesting",
      );
    } catch (error) {
      logger.warn(
        { err: error },
        "Failed to hydrate backtest projection from research-backtesting",
      );
    }
  };

  return {
    start: async () => {
      if (started && !stopped) {
        return;
      }

      stopped = false;
      await ensureTopicExists();
      await hydrate();
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        await hydrate();
      })();
      await consumer.connect();
      await consumer.subscribe({
        topic: config.backtestCompletedEventsTopic,
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

            const projectionInput = toProjectionInput(envelope);
            await upsertBacktestRunProjection(pool, projectionInput);
            const promotionResult = await promoteBacktestRunIfEligible(pool, projectionInput);
            if (envelope.data.controlPlaneJobId) {
              await completeBacktestJobFromProjectionEvent(pool, {
                jobId: envelope.data.controlPlaneJobId,
                backtestId: envelope.data.backtestId,
              });
            }
            publishOpsEvent({
              type: "ops.backtests.updated",
              payload: {
                symbols: [envelope.data.symbol],
                timeframeCodes: [envelope.data.timeframeCode],
              },
            });
            if (promotionResult.changed) {
              publishOpsEvent({
                type: "ops.execution.updated",
                payload: {
                  symbols: [envelope.data.symbol],
                  timeframeCodes: [envelope.data.timeframeCode],
                },
              });
            }
          } catch (error) {
            logger.error(
              { err: error, rawValue },
              "Failed to project backtest-completed event",
            );
          }
        },
      });
      started = true;
      logger.info(
        {
          groupId: config.backtestCompletedEventsConsumerGroupId,
          topic: config.backtestCompletedEventsTopic,
        },
        "Backtest projection consumer started",
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
    hydrate,
  };
};
