import type { RecentBacktestRun } from "@/lib/api";
import type { MetricGateStatus } from "@/components/shared/metric-gate";

export interface PromotionThresholds {
  minTradeCount?: number;
  minTradesPer1000Candles?: number;
  maxDrawdownPercent?: number;
  maxReversalRatio?: number;
}

export interface ThresholdEvaluation {
  key: keyof PromotionThresholds;
  label: string;
  status: MetricGateStatus;
  actual: string;
  threshold?: string;
  hint?: string;
}

function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function fmtNum(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString();
}

function fmtRatio(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function tradesPer1000Candles(run: RecentBacktestRun): number | null {
  if (!run.replayKlineCount) return null;
  return (run.tradeCount / run.replayKlineCount) * 1_000;
}

export function evaluateThresholds(
  run: RecentBacktestRun | null,
  thresholds: PromotionThresholds | undefined,
): ThresholdEvaluation[] {
  if (!run) return [];
  const entries: ThresholdEvaluation[] = [];

  const minTrades = thresholds?.minTradeCount;
  entries.push({
    key: "minTradeCount",
    label: "Min trade count",
    status:
      minTrades === undefined
        ? "skip"
        : run.tradeCount >= minTrades
          ? "pass"
          : "fail",
    actual: fmtNum(run.tradeCount),
    threshold: minTrades !== undefined ? `≥ ${fmtNum(minTrades)}` : undefined,
  });

  const ratePer1000 = tradesPer1000Candles(run);
  const minRate = thresholds?.minTradesPer1000Candles;
  entries.push({
    key: "minTradesPer1000Candles",
    label: "Trades / 1k candles",
    status:
      minRate === undefined
        ? "skip"
        : ratePer1000 !== null && ratePer1000 >= minRate
          ? "pass"
          : "fail",
    actual: fmtRatio(ratePer1000, 1),
    threshold: minRate !== undefined ? `≥ ${fmtRatio(minRate, 1)}` : undefined,
    hint: `${fmtNum(run.tradeCount)} of ${fmtNum(run.replayKlineCount)} candles`,
  });

  const maxDrawdown = thresholds?.maxDrawdownPercent;
  entries.push({
    key: "maxDrawdownPercent",
    label: "Max drawdown",
    status:
      maxDrawdown === undefined
        ? "skip"
        : run.maxDrawdownPercent <= maxDrawdown
          ? "pass"
          : "fail",
    actual: fmtPct(run.maxDrawdownPercent),
    threshold:
      maxDrawdown !== undefined ? `≤ ${fmtPct(maxDrawdown)}` : undefined,
  });

  const maxReversal = thresholds?.maxReversalRatio;
  entries.push({
    key: "maxReversalRatio",
    label: "Reversal ratio",
    status:
      maxReversal === undefined
        ? "skip"
        : run.reversalRatio <= maxReversal
          ? "pass"
          : "fail",
    actual: fmtRatio(run.reversalRatio),
    threshold:
      maxReversal !== undefined ? `≤ ${fmtRatio(maxReversal)}` : undefined,
  });

  return entries;
}

export function thresholdsFromStrategyRecords(
  records: Record<string, unknown>[] | undefined,
): Map<string, PromotionThresholds> {
  const map = new Map<string, PromotionThresholds>();
  if (!records) return map;
  for (const record of records) {
    const name =
      typeof record.name === "string"
        ? record.name
        : typeof record.strategyName === "string"
          ? record.strategyName
          : undefined;
    if (!name) continue;
    const parameters = (record.parameters ?? null) as Record<string, unknown> | null;
    const thresholds = (parameters?.promotionThresholds ?? null) as
      | Record<string, unknown>
      | null;
    if (!thresholds) continue;
    const parsed: PromotionThresholds = {};
    if (typeof thresholds.minTradeCount === "number") {
      parsed.minTradeCount = thresholds.minTradeCount;
    }
    if (typeof thresholds.minTradesPer1000Candles === "number") {
      parsed.minTradesPer1000Candles = thresholds.minTradesPer1000Candles;
    }
    if (typeof thresholds.maxDrawdownPercent === "number") {
      parsed.maxDrawdownPercent = thresholds.maxDrawdownPercent;
    }
    if (typeof thresholds.maxReversalRatio === "number") {
      parsed.maxReversalRatio = thresholds.maxReversalRatio;
    }
    map.set(name, parsed);
  }
  return map;
}
