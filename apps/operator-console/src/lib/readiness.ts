import type { DataReadinessResponse } from "@/src/lib/api";

type DataReadinessItem = DataReadinessResponse["items"][number];

const clampPercent = (value: number): number =>
  Math.min(100, Math.max(0, value));

const rawCoveragePercent = (
  value: DataReadinessItem["kline"] | DataReadinessItem["trades"],
): number => clampPercent(Number(value?.coveragePercent ?? 0));

export const displayedKlineCoveragePercent = (
  item: DataReadinessItem,
  _timeframePeriodMs?: number,
): number => rawCoveragePercent(item.kline);

export const displayedTradesCoveragePercent = (
  item: DataReadinessItem,
): number => rawCoveragePercent(item.trades);

export const displayedReadinessPercent = (
  item: DataReadinessItem,
  timeframePeriodMs?: number,
): number =>
  Math.min(
    displayedKlineCoveragePercent(item, timeframePeriodMs),
    displayedTradesCoveragePercent(item),
  );
