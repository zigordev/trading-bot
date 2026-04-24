import { MaterialIcons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
import {
  DataTableFooter,
  DataTableHeaderCell,
  DataTableHeaderRow,
  DataTableRow,
  DataTableSurface,
  DataTableTextCell,
  ResponsiveDataTable,
} from "@/src/components/data-table";
import { MultiSelectFilter } from "@/src/components/multi-select-filter";
import { SymbolAvatar } from "@/src/components/symbol-avatar";
import { buildAnalysisDetailMap } from "@/src/lib/analysis-details";
import {
  type BacktestJob,
  type DataReadinessResponse,
  getBacktestsSummary,
  getConfigResourceRecords,
  getDataReadiness,
  getRuntimeAnalyses,
  type RecentBacktestRun,
} from "@/src/lib/api";
import { subscribeOpsRealtimeEvent } from "@/src/lib/ops-events";
import {
  displayedKlineCoveragePercent,
  displayedReadinessPercent,
  displayedTradesCoveragePercent,
} from "@/src/lib/readiness";

type DataReadinessItem = DataReadinessResponse["items"][number];

const klineDimensionsForItem = (item: DataReadinessItem) =>
  item.klineDimensions && item.klineDimensions.length > 0
    ? item.klineDimensions
    : [
        {
          timeframeCode: item.timeframeCode,
          ...(item.kline ?? {}),
        },
      ];

type RowBacktestProgress = {
  percent: number;
  completedCount: number;
  totalCount: number;
  runningCount: number;
  queuedCount: number;
  failedCount: number;
  pendingCount: number;
  tone: "running" | "failed" | "idle";
};

type StrategyPromotionThresholds = {
  minTradeCount: number | null;
  minTradesPer1000Candles: number | null;
  maxDrawdownPercent: number | null;
  maxReversalRatio: number | null;
};

type SymbolBacktestingGroup = {
  symbolCode: string;
  readinessItems: Array<
    DataReadinessItem & {
      readinessPercent: number;
      backtestProgress: RowBacktestProgress | null;
    }
  >;
  latestRuns: RecentBacktestRun[];
};

type BacktestingTableLayout = {
  timeframeFlex: number;
  strategyFlex: number;
  klineFlex: number;
  tradesFlex: number;
  progressFlex: number;
  timeframeMin: number;
  strategyMin: number;
  klineMin: number;
  tradesMin: number;
  progressMin: number;
  rowPaddingX: number;
  rowGap: number;
};

const PAGE_SIZE = 10;

const getBacktestingTableLayout = (width: number): BacktestingTableLayout => {
  if (width >= 1600) {
    return {
      timeframeFlex: 0.62,
      strategyFlex: 0.92,
      klineFlex: 1.45,
      tradesFlex: 1.12,
      progressFlex: 1.95,
      timeframeMin: 82,
      strategyMin: 118,
      klineMin: 250,
      tradesMin: 210,
      progressMin: 340,
      rowPaddingX: 14,
      rowGap: 10,
    };
  }

  if (width >= 1280) {
    return {
      timeframeFlex: 0.66,
      strategyFlex: 0.98,
      klineFlex: 1.38,
      tradesFlex: 1.06,
      progressFlex: 1.82,
      timeframeMin: 82,
      strategyMin: 114,
      klineMin: 230,
      tradesMin: 195,
      progressMin: 310,
      rowPaddingX: 14,
      rowGap: 10,
    };
  }

  return {
    timeframeFlex: 0.72,
    strategyFlex: 1.02,
    klineFlex: 1.28,
    tradesFlex: 1.0,
    progressFlex: 1.68,
    timeframeMin: 80,
    strategyMin: 108,
    klineMin: 210,
    tradesMin: 180,
    progressMin: 280,
    rowPaddingX: 12,
    rowGap: 8,
  };
};

const formatDuration = (durationMs: number): string => {
  const safeDurationMs = Math.max(0, durationMs);
  if (safeDurationMs < 1000) {
    return `${safeDurationMs}ms`;
  }

  const totalSeconds = Math.floor(safeDurationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${hours}h ${remainingMinutes}m`;
};

const formatCoverageTimestamp = (value: number | null | undefined): string | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  return new Date(Number(value)).toLocaleString();
};

const formatCoverageBadgeTimestamp = (value: number | null | undefined): string | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  const parsed = new Date(Number(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed
    .toLocaleString([], {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
};

const formatCompactTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return "n/a";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "n/a";
  }

  return parsed
    .toLocaleString([], {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
};

const formatCoverageRange = (
  startTime: number | null | undefined,
  endTime: number | null | undefined,
): string | null => {
  const startLabel = formatCoverageTimestamp(startTime);
  const endLabel = formatCoverageTimestamp(endTime);

  if (startLabel && endLabel) {
    return `${startLabel} -> ${endLabel}`;
  }
  if (startLabel) {
    return `From ${startLabel}`;
  }
  if (endLabel) {
    return `To ${endLabel}`;
  }
  return null;
};

const formatScore = (value: number): string => value.toFixed(2);

const scorePalette = (value: number) => ({
  backgroundColor: value >= 0 ? "#ecfdf3" : "#fef3f2",
  textColor: value >= 0 ? "#157f3b" : "#b42318",
});

const backtestKey = (value: {
  symbolCode: string;
  timeframeCode: string;
  strategyName: string;
}) => `${value.symbolCode}:${value.timeframeCode}:${value.strategyName}`;

const analysisRuntimeKey = (value: {
  analysisSettingId: string;
  riskProfileName: string | null;
}) => `${value.analysisSettingId}:${value.riskProfileName ?? ""}`;

const clampPercent = (value: number | null | undefined): number =>
  Math.min(100, Math.max(0, Number(value ?? 0)));

const toNonNegativeIntegerOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const toNonNegativeNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const strategyPromotionThresholdsFromParameters = (
  parameters: Record<string, unknown> | null | undefined,
): StrategyPromotionThresholds => {
  const thresholdsValue = parameters?.promotionThresholds;
  const thresholds =
    typeof thresholdsValue === "object" &&
    thresholdsValue !== null &&
    !Array.isArray(thresholdsValue)
      ? (thresholdsValue as Record<string, unknown>)
      : {};

  return {
    minTradeCount: toNonNegativeIntegerOrNull(thresholds.minTradeCount),
    minTradesPer1000Candles: toNonNegativeNumberOrNull(thresholds.minTradesPer1000Candles),
    maxDrawdownPercent: toNonNegativeNumberOrNull(thresholds.maxDrawdownPercent),
    maxReversalRatio: toNonNegativeNumberOrNull(thresholds.maxReversalRatio),
  };
};

const tradesPer1000Candles = (
  run: Pick<RecentBacktestRun, "tradeCount" | "replayKlineCount">,
): number => (run.replayKlineCount > 0 ? (run.tradeCount * 1_000) / run.replayKlineCount : 0);

const hasPositivePromotionSelectionValue = (
  run: Pick<
    RecentBacktestRun,
    "score" | "equityCurvePnlPercent" | "maxDrawdownPercent" | "reversalRatio"
  >,
): boolean =>
  Number.isFinite(run.score)
    ? run.score > 0
    : run.equityCurvePnlPercent - 0.75 * run.maxDrawdownPercent - 12 * run.reversalRatio > 0;

const metricAccentForGate = (passed: boolean | null): "default" | "success" | "danger" =>
  passed === null ? "default" : passed ? "success" : "danger";

const isReadinessJob = (job: BacktestJob): boolean => job.id.startsWith("readiness-");

const backtestWindowKey = (
  startTime: number | null | undefined,
  endTime: number | null | undefined,
): string | null =>
  typeof startTime === "number" && typeof endTime === "number" ? `${startTime}:${endTime}` : null;

const matchesBacktestingRow = (job: BacktestJob, item: DataReadinessItem): boolean =>
  isReadinessJob(job) &&
  job.symbolCode === item.symbolCode &&
  job.timeframeCode === item.timeframeCode &&
  job.strategyName === item.strategyName;

const buildRowBacktestProgress = ({
  item,
  jobs,
  runtimeAnalyses,
}: {
  item: DataReadinessItem;
  jobs: BacktestJob[];
  runtimeAnalyses: Array<{
    id: string;
    symbolCode: string;
    timeframeCode: string;
    strategyName: string;
    riskProfileName: string;
  }>;
}): RowBacktestProgress | null => {
  const expectedKeys = new Set(
    runtimeAnalyses
      .filter((analysis) => analysis.symbolCode === item.symbolCode)
      .filter((analysis) => analysis.timeframeCode === item.timeframeCode)
      .filter((analysis) => analysis.strategyName === item.strategyName)
      .filter(
        (analysis) =>
          item.analysisSettingIds.length === 0 || item.analysisSettingIds.includes(analysis.id),
      )
      .map((analysis) =>
        analysisRuntimeKey({
          analysisSettingId: analysis.id,
          riskProfileName: analysis.riskProfileName,
        }),
      ),
  );

  const itemWindowKey = backtestWindowKey(item.requestedStartTime, item.requestedEndTime);
  const rowJobs = jobs.filter((job) => matchesBacktestingRow(job, item));
  const activeWindowActivity = new Map<
    string,
    {
      latestUpdatedAt: number;
      runningCount: number;
    }
  >();

  for (const job of rowJobs) {
    if (job.status !== "queued" && job.status !== "running") {
      continue;
    }

    const windowKey = backtestWindowKey(job.startTime, job.endTime);
    if (!windowKey) {
      continue;
    }

    const current = activeWindowActivity.get(windowKey);
    const updatedAt = Date.parse(job.updatedAt);
    activeWindowActivity.set(windowKey, {
      latestUpdatedAt: Math.max(current?.latestUpdatedAt ?? 0, updatedAt),
      runningCount:
        (current?.runningCount ?? 0) + (job.status === "running" ? 1 : 0),
    });
  }

  let displayWindowKey = itemWindowKey;
  if (!displayWindowKey || !activeWindowActivity.has(displayWindowKey)) {
    const fallbackWindow = [...activeWindowActivity.entries()].sort((left, right) => {
      if (left[1].runningCount !== right[1].runningCount) {
        return right[1].runningCount - left[1].runningCount;
      }
      return right[1].latestUpdatedAt - left[1].latestUpdatedAt;
    })[0];
    if (fallbackWindow) {
      displayWindowKey = fallbackWindow[0];
    }
  }

  const latestJobByAnalysis = new Map<string, BacktestJob>();
  for (const job of rowJobs) {
    if (backtestWindowKey(job.startTime, job.endTime) !== displayWindowKey) {
      continue;
    }

    const key = analysisRuntimeKey({
      analysisSettingId: job.analysisSettingId,
      riskProfileName: job.riskProfileName,
    });

    if (expectedKeys.size > 0 && !expectedKeys.has(key)) {
      continue;
    }

    const current = latestJobByAnalysis.get(key);
    if (!current || Date.parse(job.updatedAt) > Date.parse(current.updatedAt)) {
      latestJobByAnalysis.set(key, job);
    }
  }

  const totalCount = expectedKeys.size > 0 ? expectedKeys.size : latestJobByAnalysis.size;
  if (totalCount === 0) {
    return null;
  }

  let completedCount = 0;
  let runningCount = 0;
  let queuedCount = 0;
  let failedCount = 0;
  let progressUnits = 0;

  const keysToMeasure =
    expectedKeys.size > 0 ? [...expectedKeys] : [...latestJobByAnalysis.keys()];
  for (const key of keysToMeasure) {
    const job = latestJobByAnalysis.get(key);
    if (!job) {
      continue;
    }

    switch (job.status) {
      case "completed":
        completedCount += 1;
        progressUnits += 1;
        break;
      case "running":
        runningCount += 1;
        progressUnits += clampPercent(job.progressPercent) / 100;
        break;
      case "queued":
        queuedCount += 1;
        break;
      case "failed":
        failedCount += 1;
        break;
      default:
        break;
    }
  }

  const pendingCount = Math.max(
    0,
    totalCount - completedCount - runningCount - queuedCount - failedCount,
  );
  const percent =
    completedCount === totalCount
      ? 100
      : Math.min(99.9, (progressUnits / totalCount) * 100);

  if (runningCount > 0) {
    return {
      percent,
      completedCount,
      totalCount,
      runningCount,
      queuedCount,
      failedCount,
      pendingCount,
      tone: "running",
    };
  }

  if (queuedCount > 0) {
    return {
      percent,
      completedCount,
      totalCount,
      runningCount,
      queuedCount,
      failedCount,
      pendingCount,
      tone: "idle",
    };
  }

  if (failedCount > 0 && completedCount + failedCount === totalCount) {
    return {
      percent,
      completedCount,
      totalCount,
      runningCount,
      queuedCount,
      failedCount,
      pendingCount,
      tone: "failed",
    };
  }

  if (completedCount === totalCount) {
    return {
      percent: 100,
      completedCount,
      totalCount,
      runningCount,
      queuedCount,
      failedCount,
      pendingCount,
      tone: "idle",
    };
  }

  if (completedCount > 0 || failedCount > 0) {
    return {
      percent,
      completedCount,
      totalCount,
      runningCount,
      queuedCount,
      failedCount,
      pendingCount,
      tone: "idle",
    };
  }

  return {
    percent: 0,
    completedCount,
    totalCount,
    runningCount,
    queuedCount,
    failedCount,
    pendingCount,
    tone: "idle",
  };
};

export default function BacktestingScreen() {
  const { width: viewportWidth } = useWindowDimensions();
  const queryClient = useQueryClient();
  const [symbolFilter, setSymbolFilter] = useState<string[]>([]);
  const [timeframeFilter, setTimeframeFilter] = useState<string>("");
  const [strategyFilter, setStrategyFilter] = useState<string>("");
  const [expandedSymbols, setExpandedSymbols] = useState<string[]>([]);
  const [readinessPageBySymbol, setReadinessPageBySymbol] = useState<Record<string, number>>({});
  const [selectedLatestRowKey, setSelectedLatestRowKey] = useState<string | null>(null);
  const [selectedLatestPage, setSelectedLatestPage] = useState(1);
  const [selectedBacktestId, setSelectedBacktestId] = useState<string | null>(null);

  const backtestsQuery = useQuery({
    queryKey: ["ops-backtests-summary"],
    queryFn: getBacktestsSummary,
  });
  const readinessQuery = useQuery({
    queryKey: ["ops-data-readiness", strategyFilter],
    queryFn: () =>
      getDataReadiness({
        strategyName: strategyFilter || undefined,
      }),
  });
  const symbolsQuery = useQuery({
    queryKey: ["config-resource", "symbols"],
    queryFn: () => getConfigResourceRecords("symbols"),
  });
  const timeframesQuery = useQuery({
    queryKey: ["config-resource", "timeframes"],
    queryFn: () => getConfigResourceRecords("timeframes"),
  });
  const strategiesQuery = useQuery({
    queryKey: ["config-resource", "strategies"],
    queryFn: () => getConfigResourceRecords("strategies"),
  });
  const runtimeAnalysesQuery = useQuery({
    queryKey: ["runtime-analyses"],
    queryFn: getRuntimeAnalyses,
  });

  useEffect(
    () =>
      subscribeOpsRealtimeEvent((event) => {
        if (event.type === "ops.backtests.updated") {
          void queryClient.invalidateQueries({ queryKey: ["ops-backtests-summary"] });
          return;
        }

        if (event.type === "ops.data-readiness.updated") {
          void queryClient.invalidateQueries({ queryKey: ["ops-data-readiness"] });
          return;
        }

        if (event.type !== "config.resource.updated") {
          return;
        }

        if (event.payload.resource === "symbols") {
          void queryClient.invalidateQueries({ queryKey: ["config-resource", "symbols"] });
          void queryClient.invalidateQueries({ queryKey: ["runtime-analyses"] });
          return;
        }

        if (event.payload.resource === "timeframes") {
          void queryClient.invalidateQueries({ queryKey: ["config-resource", "timeframes"] });
          void queryClient.invalidateQueries({ queryKey: ["runtime-analyses"] });
          return;
        }

        if (
          event.payload.resource === "strategies" ||
          event.payload.resource === "risk-profiles" ||
          event.payload.resource === "analysis-settings"
        ) {
          if (event.payload.resource === "strategies") {
            void queryClient.invalidateQueries({ queryKey: ["config-resource", "strategies"] });
          }
          void queryClient.invalidateQueries({ queryKey: ["runtime-analyses"] });
        }
      }),
    [queryClient],
  );

  const symbolBaseAssets = new Map(
    (symbolsQuery.data ?? []).map((record) => [
      String(record.code ?? ""),
      String(record.baseAsset ?? ""),
    ]),
  );
  const symbolDestinationAssets = new Map(
    (symbolsQuery.data ?? []).map((record) => [
      String(record.code ?? ""),
      String(record.destinationAsset ?? ""),
    ]),
  );
  const analysisDetailById = buildAnalysisDetailMap(runtimeAnalysesQuery.data ?? []);
  const timeframePeriodByCode = new Map(
    (timeframesQuery.data ?? []).map((record) => [
      String(record.code ?? ""),
      Number(record.periodMs ?? 0),
    ]),
  );
  const promotionThresholdsByStrategyName = useMemo(
    () =>
      new Map(
        (strategiesQuery.data ?? [])
          .map((record) => {
            const strategyName = String(record.name ?? "");
            if (!strategyName) {
              return null;
            }

            const parameters =
              typeof record.parameters === "object" &&
              record.parameters !== null &&
              !Array.isArray(record.parameters)
                ? (record.parameters as Record<string, unknown>)
                : null;

            return [strategyName, strategyPromotionThresholdsFromParameters(parameters)] as const;
          })
          .filter((entry): entry is readonly [string, StrategyPromotionThresholds] => entry !== null),
      ),
    [strategiesQuery.data],
  );
  const tableLayout = useMemo(
    () => getBacktestingTableLayout(viewportWidth),
    [viewportWidth],
  );
  const tableMinContentWidth = useMemo(
    () =>
      tableLayout.timeframeMin +
      tableLayout.strategyMin +
      tableLayout.klineMin +
      tableLayout.tradesMin +
      tableLayout.progressMin +
      tableLayout.rowGap * 4 +
      tableLayout.rowPaddingX * 2,
    [tableLayout],
  );

  const symbolOptions = Array.from(
    new Set([
      ...(symbolsQuery.data ?? []).map((record) => String(record.code ?? "")),
      ...symbolFilter,
    ]),
  )
    .filter(Boolean)
    .sort();
  const timeframeOptions = Array.from(
    new Set([
      ...(timeframesQuery.data ?? []).map((record) => String(record.code ?? "")),
      timeframeFilter,
    ]),
  )
    .filter(Boolean)
    .sort();
  const strategyOptions = Array.from(
    new Set([
      ...(strategiesQuery.data ?? []).map((record) => String(record.name ?? "")),
      strategyFilter,
    ]),
  )
    .filter(Boolean)
    .sort();

  const filteredReadinessItems =
    readinessQuery.data?.items.filter((item) => {
      if (symbolFilter.length > 0 && !symbolFilter.includes(item.symbolCode)) {
        return false;
      }
      if (timeframeFilter && item.timeframeCode !== timeframeFilter) {
        return false;
      }
      if (strategyFilter && item.strategyName !== strategyFilter) {
        return false;
      }
      return true;
    }) ?? [];

  const filteredLatestRuns =
    backtestsQuery.data?.latestRuns.filter((run) => {
      if (symbolFilter.length > 0 && !symbolFilter.includes(run.symbol)) {
        return false;
      }
      if (timeframeFilter && run.timeframeCode !== timeframeFilter) {
        return false;
      }
      if (strategyFilter && run.strategyName !== strategyFilter) {
        return false;
      }
      return true;
    }) ?? [];

  const filteredJobs =
    backtestsQuery.data?.jobs.filter((job) => {
      if (!job.symbolCode || !job.timeframeCode || !job.strategyName) {
        return false;
      }
      if (symbolFilter.length > 0 && !symbolFilter.includes(job.symbolCode)) {
        return false;
      }
      if (timeframeFilter && job.timeframeCode !== timeframeFilter) {
        return false;
      }
      if (strategyFilter && job.strategyName !== strategyFilter) {
        return false;
      }
      return true;
    }) ?? [];

  const symbolGroups = useMemo(() => {
    const symbols = new Set<string>();
    for (const item of filteredReadinessItems) {
      symbols.add(item.symbolCode);
    }
    for (const run of filteredLatestRuns) {
      symbols.add(run.symbol);
    }
    for (const job of filteredJobs) {
      if (job.symbolCode) {
        symbols.add(job.symbolCode);
      }
    }

    return [...symbols]
      .map<SymbolBacktestingGroup>((symbolCode) => {
        const readinessItems = filteredReadinessItems
          .filter((item) => item.symbolCode === symbolCode)
          .map((item) => ({
            ...item,
            readinessPercent: displayedReadinessPercent(
              item,
              timeframePeriodByCode.get(item.timeframeCode),
            ),
            backtestProgress: buildRowBacktestProgress({
              item,
              jobs: filteredJobs,
              runtimeAnalyses: runtimeAnalysesQuery.data ?? [],
            }),
          }))
          .sort(
            (left, right) =>
              left.timeframeCode.localeCompare(right.timeframeCode) ||
              left.strategyName.localeCompare(right.strategyName),
          );

        const latestRuns = filteredLatestRuns
          .filter((run) => run.symbol === symbolCode)
          .sort(
            (left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt),
          );

        return {
          symbolCode,
          readinessItems,
          latestRuns,
        };
      })
      .sort((left, right) => left.symbolCode.localeCompare(right.symbolCode));
  }, [
    filteredJobs,
    filteredLatestRuns,
    filteredReadinessItems,
    runtimeAnalysesQuery.data,
  ]);

  const selectedBacktestRun = useMemo(() => {
    if (!selectedBacktestId) {
      return null;
    }

    return backtestsQuery.data?.latestRuns.find((run) => run.backtestId === selectedBacktestId) ?? null;
  }, [backtestsQuery.data?.latestRuns, selectedBacktestId]);

  const selectedLatestContext = useMemo(() => {
    if (!selectedLatestRowKey) {
      return null;
    }

    const [symbolCode, timeframeCode, strategyName] = selectedLatestRowKey.split(":");
    if (!symbolCode || !timeframeCode || !strategyName) {
      return null;
    }

    return { symbolCode, timeframeCode, strategyName };
  }, [selectedLatestRowKey]);

  const selectedLatestRuns = useMemo(() => {
    if (!selectedLatestContext) {
      return [];
    }

    const group = symbolGroups.find(
      (candidate) => candidate.symbolCode === selectedLatestContext.symbolCode,
    );
    if (!group) {
      return [];
    }

    return group.latestRuns.filter(
      (run) =>
        run.timeframeCode === selectedLatestContext.timeframeCode &&
        run.strategyName === selectedLatestContext.strategyName,
    );
  }, [selectedLatestContext, symbolGroups]);

  const selectedLatestTotalPages = Math.max(1, Math.ceil(selectedLatestRuns.length / PAGE_SIZE));
  const currentSelectedLatestPage = Math.min(selectedLatestPage, selectedLatestTotalPages);
  const paginatedSelectedLatestRuns = useMemo(() => {
    const pageStartIndex = (currentSelectedLatestPage - 1) * PAGE_SIZE;
    return selectedLatestRuns.slice(pageStartIndex, pageStartIndex + PAGE_SIZE);
  }, [currentSelectedLatestPage, selectedLatestRuns]);

  useEffect(() => {
    setSelectedLatestPage(1);
  }, [selectedLatestRowKey]);

  const toggleExpandedSymbol = (symbolCode: string) => {
    setExpandedSymbols((current) =>
      current.includes(symbolCode)
        ? current.filter((value) => value !== symbolCode)
        : [...current, symbolCode],
    );
  };

  const setReadinessPage = (symbolCode: string, page: number) => {
    setReadinessPageBySymbol((current) => ({
      ...current,
      [symbolCode]: Math.max(1, page),
    }));
  };

  const isLoading = backtestsQuery.isLoading || readinessQuery.isLoading;

  return (
    <AppShell>
      <View style={{ gap: 16 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <MultiSelectFilter
            label="Symbol"
            value={symbolFilter}
            options={symbolOptions}
            onChange={setSymbolFilter}
            allLabel="All symbols"
            renderOptionAdornment={(option) => (
              <SymbolAvatar
                baseAsset={symbolBaseAssets.get(option)}
                destinationAsset={symbolDestinationAssets.get(option)}
                size={22}
              />
            )}
          />
          <SingleSelectFilter
            label="Timeframe"
            value={timeframeFilter}
            options={timeframeOptions}
            onChange={setTimeframeFilter}
            allLabel="All timeframes"
          />
          <SingleSelectFilter
            label="Strategy"
            value={strategyFilter}
            options={strategyOptions}
            onChange={setStrategyFilter}
            allLabel="All strategies"
          />
        </View>

        {isLoading ? (
          <Text style={{ color: "#475467" }}>Loading backtesting workspace…</Text>
        ) : symbolGroups.length === 0 ? (
          <Text style={{ color: "#475467" }}>No symbols match the current filters.</Text>
        ) : (
          symbolGroups.map((group) => (
            <Card key={group.symbolCode}>
              <View style={{ gap: 18 }}>
                <View
                  style={{ gap: 12 }}
                >
                  <Pressable
                    onPress={() => toggleExpandedSymbol(group.symbolCode)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                      <SymbolAvatar
                        baseAsset={symbolBaseAssets.get(group.symbolCode)}
                        destinationAsset={symbolDestinationAssets.get(group.symbolCode)}
                        size={36}
                      />
                      <Text style={{ fontSize: 22, fontWeight: "700", color: "#101828", flex: 1 }}>
                        {group.symbolCode}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: "#475467", fontWeight: "700" }}>
                        {expandedSymbols.includes(group.symbolCode) ? "Hide details" : "Show details"}
                      </Text>
                      <MaterialIcons
                        name={expandedSymbols.includes(group.symbolCode) ? "expand-less" : "expand-more"}
                        size={20}
                        color="#475467"
                      />
                    </View>
                  </Pressable>
                </View>

                {expandedSymbols.includes(group.symbolCode) ? (
                  <>
                <View style={{ gap: 10 }}>
                  {group.readinessItems.length === 0 ? (
                    <Text style={{ color: "#475467" }}>No readiness rows available.</Text>
                  ) : (
                    (() => {
                      const totalCount = group.readinessItems.length;
                      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
                      const currentPage = Math.min(
                        readinessPageBySymbol[group.symbolCode] ?? 1,
                        totalPages,
                      );
                      const pageStartIndex = (currentPage - 1) * PAGE_SIZE;
                      const paginatedItems = group.readinessItems.slice(
                        pageStartIndex,
                        pageStartIndex + PAGE_SIZE,
                      );

                      return (
                        <View style={{ gap: 10 }}>
                          <ResponsiveDataTable
                            minWidth={tableMinContentWidth}
                            scrollStyle={{ width: "100%" }}
                            showsHorizontalScrollIndicator
                          >
                            <DataTableSurface style={{ borderRadius: 16 }}>
                              <DataTableHeaderRow
                                paddingHorizontal={tableLayout.rowPaddingX}
                                paddingVertical={10}
                                gap={tableLayout.rowGap}
                              >
                                <DataTableHeaderCell
                                  label="Timeframe"
                                  flex={tableLayout.timeframeFlex}
                                  minWidth={tableLayout.timeframeMin}
                                  paddingRight={2}
                                />
                                <DataTableHeaderCell
                                  label="Strategy"
                                  flex={tableLayout.strategyFlex}
                                  minWidth={tableLayout.strategyMin}
                                  paddingRight={2}
                                />
                                <DataTableHeaderCell
                                  label="Kline data"
                                  flex={tableLayout.klineFlex}
                                  minWidth={tableLayout.klineMin}
                                  paddingRight={2}
                                />
                                <DataTableHeaderCell
                                  label="Trades data"
                                  flex={tableLayout.tradesFlex}
                                  minWidth={tableLayout.tradesMin}
                                  paddingRight={2}
                                />
                                <DataTableHeaderCell
                                  label="Progress"
                                  flex={tableLayout.progressFlex}
                                  minWidth={tableLayout.progressMin}
                                  paddingRight={2}
                                />
                              </DataTableHeaderRow>
                              {paginatedItems.map((item, index) => {
                                const rowKey = backtestKey(item);
                                const hasLatest = group.latestRuns.some(
                                  (run) =>
                                    run.timeframeCode === item.timeframeCode &&
                                    run.strategyName === item.strategyName,
                                );

                                return (
                                  <DataTableRow
                                    key={rowKey}
                                    index={index}
                                    paddingHorizontal={tableLayout.rowPaddingX}
                                    paddingVertical={12}
                                    gap={tableLayout.rowGap}
                                    alignItems="flex-start"
                                  >
                                    <DataTableTextCell
                                      label={item.timeframeCode}
                                      flex={tableLayout.timeframeFlex}
                                      minWidth={tableLayout.timeframeMin}
                                      weight="700"
                                      paddingRight={2}
                                    />
                                    <DataTableTextCell
                                      label={item.strategyName}
                                      flex={tableLayout.strategyFlex}
                                      minWidth={tableLayout.strategyMin}
                                      weight="700"
                                      paddingRight={2}
                                    />
                                    <View
                                      style={{
                                        flex: tableLayout.klineFlex,
                                        minWidth: tableLayout.klineMin,
                                        gap: 8,
                                        paddingRight: 2,
                                      }}
                                    >
                                      {klineDimensionsForItem(item).map(
                                        (dimension, dimensionIndex) => (
                                          <ReadinessDataBadge
                                            key={`${rowKey}:kline:${dimension.timeframeCode ?? dimensionIndex}`}
                                            label={`Klines ${dimension.timeframeCode ?? item.timeframeCode}`}
                                            icon="show-chart"
                                            percent={
                                              dimension.timeframeCode === item.timeframeCode
                                                ? displayedKlineCoveragePercent(
                                                    item,
                                                    timeframePeriodByCode.get(item.timeframeCode),
                                                  )
                                                : Number(dimension.coveragePercent ?? 0)
                                            }
                                            count={Number(dimension.rowCount ?? 0)}
                                            startTime={Number(dimension.minTime ?? NaN)}
                                            endTime={Number(dimension.maxTime ?? NaN)}
                                          />
                                        ),
                                      )}
                                    </View>
                                    <View
                                      style={{
                                        flex: tableLayout.tradesFlex,
                                        minWidth: tableLayout.tradesMin,
                                        gap: 8,
                                        paddingRight: 2,
                                      }}
                                    >
                                      <ReadinessDataBadge
                                        label="Trades"
                                        icon="swap-horiz"
                                        percent={displayedTradesCoveragePercent(item)}
                                        count={Number(item.trades?.rowCount ?? 0)}
                                        startTime={Number(item.trades?.minTime ?? NaN)}
                                        endTime={Number(item.trades?.maxTime ?? NaN)}
                                      />
                                    </View>
                                    <View
                                      style={{
                                        flex: tableLayout.progressFlex,
                                        minWidth: tableLayout.progressMin,
                                        paddingRight: 2,
                                      }}
                                    >
                                      <BacktestStatusCell
                                        progress={item.backtestProgress}
                                        canOpenLatest={hasLatest}
                                        onOpenLatest={() => {
                                          setSelectedLatestPage(1);
                                          setSelectedLatestRowKey(rowKey);
                                        }}
                                      />
                                    </View>
                                  </DataTableRow>
                                );
                              })}
                              <DataTableFooter
                                currentPage={currentPage}
                                totalPages={totalPages}
                                totalCount={totalCount}
                                itemLabel="rows"
                                onPrevious={() =>
                                  setReadinessPage(group.symbolCode, currentPage - 1)
                                }
                                onNext={() =>
                                  setReadinessPage(group.symbolCode, currentPage + 1)
                                }
                              />
                            </DataTableSurface>
                          </ResponsiveDataTable>
                        </View>
                      );
                    })()
                  )}
                </View>
                  </>
                ) : null}
              </View>
            </Card>
          ))
        )}
      </View>
      <Modal
        visible={selectedLatestRowKey !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedLatestRowKey(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(16, 24, 40, 0.45)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 920 }}>
            <Card>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <View style={{ gap: 4, flex: 1 }}>
                  <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                    Latest backtests
                  </Text>
                  {selectedLatestContext ? (
                    <Text style={{ color: "#475467" }}>
                      {selectedLatestContext.symbolCode} · {selectedLatestContext.timeframeCode} ·{" "}
                      {selectedLatestContext.strategyName}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setSelectedLatestRowKey(null)}
                  style={{
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#d0d5dd",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                  }}
                >
                  <Text style={{ color: "#344054", fontWeight: "700" }}>Close</Text>
                </Pressable>
              </View>
              <ScrollView
                style={{ marginTop: 12, maxHeight: 560 }}
                contentContainerStyle={{ gap: 10 }}
                showsVerticalScrollIndicator
              >
                {selectedLatestRuns.length === 0 ? (
                  <Text style={{ color: "#475467" }}>
                    No completed latest runs for this timeframe and strategy.
                  </Text>
                ) : (
                  <ResponsiveDataTable minWidth={720} scrollStyle={{ width: "100%" }}>
                    <DataTableSurface style={{ borderRadius: 16 }}>
                      <DataTableHeaderRow paddingHorizontal={14} paddingVertical={10} gap={12}>
                        <DataTableHeaderCell label="Analysis" flex={2.1} />
                        <DataTableHeaderCell label="Risk" flex={1.1} />
                        <DataTableHeaderCell label="Score" flex={0.8} align="right" />
                        <DataTableHeaderCell label="Finished" flex={1.4} align="right" />
                      </DataTableHeaderRow>
                    {paginatedSelectedLatestRuns.map((run, index) => {
                      const thresholds =
                        promotionThresholdsByStrategyName.get(run.strategyName) ?? null;
                      const tradesPass =
                        thresholds?.minTradeCount != null &&
                        thresholds?.minTradesPer1000Candles != null
                          ? run.tradeCount >= thresholds.minTradeCount &&
                            tradesPer1000Candles(run) >= thresholds.minTradesPer1000Candles
                          : null;
                      const maxDrawdownPass =
                        thresholds?.maxDrawdownPercent != null
                          ? run.maxDrawdownPercent <= thresholds.maxDrawdownPercent
                          : null;
                      const scorePass = hasPositivePromotionSelectionValue(run);

                      return (
                        <DataTableRow
                          key={`${run.backtestId}:${run.analysisSettingId}:${run.riskProfileName}`}
                          index={index}
                          direction="column"
                          paddingHorizontal={14}
                          paddingVertical={12}
                          gap={10}
                        >
                          <View style={{ flexDirection: "row", gap: 12 }}>
                            <DataTableTextCell
                              label={
                                analysisDetailById.get(run.analysisSettingId) ??
                                run.analysisSettingId
                              }
                              flex={2.1}
                            />
                            <DataTableTextCell label={run.riskProfileName} flex={1.1} />
                            <View style={{ flex: 0.8, alignItems: "flex-end" }}>
                              <Text
                                onPress={() => setSelectedBacktestId(run.backtestId)}
                                style={{
                                  color: scorePalette(run.score).textColor,
                                  fontWeight: "700",
                                  textDecorationLine: "underline",
                                  textAlign: "right",
                                }}
                              >
                                {formatScore(run.score)}
                              </Text>
                            </View>
                            <View
                              style={{
                                flex: 1.4,
                                alignItems: "flex-end",
                                justifyContent: "center",
                              }}
                            >
                              <ReadinessDetailBadge
                                icon="schedule"
                                label={formatCompactTimestamp(run.finishedAt)}
                                tone="info"
                              />
                            </View>
                          </View>
                          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                            <MetricBadge
                              label="Duration"
                              value={formatDuration(run.backtestDurationMs)}
                            />
                            <MetricBadge
                              label="Trades"
                              value={run.tradeCount.toLocaleString()}
                              accent={metricAccentForGate(tradesPass)}
                            />
                            <MetricBadge
                              label="Equity PnL"
                              value={`${run.equityCurvePnlPercent.toFixed(2)}%`}
                              accent={metricAccentForGate(scorePass)}
                            />
                            <MetricBadge
                              label="Max DD"
                              value={`${run.maxDrawdownPercent.toFixed(2)}%`}
                              accent={metricAccentForGate(maxDrawdownPass)}
                            />
                          </View>
                        </DataTableRow>
                      );
                    })}
                      <DataTableFooter
                        currentPage={currentSelectedLatestPage}
                        totalPages={selectedLatestTotalPages}
                        totalCount={selectedLatestRuns.length}
                        itemLabel="backtests"
                        onPrevious={() =>
                          setSelectedLatestPage((current) => Math.max(1, current - 1))
                        }
                        onNext={() =>
                          setSelectedLatestPage((current) =>
                            Math.min(selectedLatestTotalPages, current + 1),
                          )
                        }
                      />
                    </DataTableSurface>
                  </ResponsiveDataTable>
                )}
              </ScrollView>
            </Card>
          </View>
        </View>
      </Modal>
      <Modal
        visible={selectedBacktestId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedBacktestId(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(16, 24, 40, 0.45)",
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <View style={{ width: "100%", maxWidth: 720 }}>
            <Card>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                  Backtest details
                </Text>
                <Pressable
                  onPress={() => setSelectedBacktestId(null)}
                  style={{
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#d0d5dd",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                  }}
                >
                  <Text style={{ color: "#344054", fontWeight: "700" }}>Close</Text>
                </Pressable>
              </View>
              <View style={{ gap: 10, marginTop: 12 }}>
                <DetailRow label="Backtest id" value={selectedBacktestId ?? "n/a"} />
                {selectedBacktestRun ? (
                  <>
                    <DetailRow label="Symbol" value={selectedBacktestRun.symbol} />
                    <DetailRow label="Timeframe" value={selectedBacktestRun.timeframeCode} />
                    <DetailRow label="Strategy" value={selectedBacktestRun.strategyName} />
                    <DetailRow
                      label="Analysis setting id"
                      value={selectedBacktestRun.analysisSettingId}
                    />
                    <DetailRow
                      label="Risk profile"
                      value={selectedBacktestRun.riskProfileName}
                    />
                    <DetailRow
                      label="Finished"
                      value={new Date(selectedBacktestRun.finishedAt).toLocaleString()}
                    />
                    <DetailRow
                      label="Score"
                      value={selectedBacktestRun.score.toFixed(2)}
                    />
                    <ScoreBreakdownSection run={selectedBacktestRun} />
                    <DetailRow
                      label="Backtest duration"
                      value={formatDuration(selectedBacktestRun.backtestDurationMs)}
                    />
                    <DetailRow
                      label="Strategy counts"
                      value={`${selectedBacktestRun.signalCount} signals · ${selectedBacktestRun.tradeCount} trades`}
                    />
                  </>
                ) : (
                  <Text style={{ color: "#475467" }}>
                    This backtest was not found in the current backtest summary payload.
                  </Text>
                )}
              </View>
            </Card>
          </View>
        </View>
      </Modal>
    </AppShell>
  );
}

function ReadinessDataBadge({
  label,
  percent,
  count,
  startTime,
  endTime,
  icon,
}: {
  label: string;
  percent: number;
  count: number;
  startTime?: number | null;
  endTime?: number | null;
  icon: keyof typeof MaterialIcons.glyphMap;
}) {
  const complete = percent >= 100;
  const displayPercent = complete
    ? "100%"
    : `${Math.floor(Math.max(percent, 0) * 10) / 10}%`;
  const displayCount = Number.isFinite(count)
    ? Math.max(0, Math.floor(count)).toLocaleString()
    : "0";
  const startLabel = formatCoverageBadgeTimestamp(startTime);
  const endLabel = formatCoverageBadgeTimestamp(endTime);
  const coverageLabel =
    startLabel && endLabel ? `${startLabel} - ${endLabel}` : startLabel ?? endLabel ?? null;
  const noCoverageYet = !startLabel && !endLabel && Math.max(count, 0) === 0;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <View
          style={{
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            backgroundColor: complete ? "#ecfdf3" : "#fef3f2",
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <MaterialIcons
            name={icon}
            size={14}
            color={complete ? "#027a48" : "#b42318"}
          />
          <Text
            style={{
              color: complete ? "#027a48" : "#b42318",
              fontWeight: "700",
              fontSize: 12,
            }}
          >
            {label} {displayPercent} · {displayCount} rows
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {coverageLabel ? (
          <ReadinessDetailBadge icon="schedule" label={coverageLabel} tone="info" />
        ) : null}
        {noCoverageYet ? (
          <ReadinessDetailBadge label="No covered period yet" tone="warning" />
        ) : null}
      </View>
    </View>
  );
}

function ReadinessDetailBadge({
  label,
  tone,
  icon,
}: {
  label: string;
  tone: "neutral" | "info" | "warning";
  icon?: keyof typeof MaterialIcons.glyphMap;
}) {
  const palette =
    tone === "info"
      ? { backgroundColor: "#eff8ff", foregroundColor: "#175cd3" }
      : tone === "warning"
        ? { backgroundColor: "#fffaeb", foregroundColor: "#b54708" }
        : { backgroundColor: "#f2f4f7", foregroundColor: "#475467" };

  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        backgroundColor: palette.backgroundColor,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      {icon ? <MaterialIcons name={icon} size={12} color={palette.foregroundColor} /> : null}
      <Text
        numberOfLines={1}
        style={{ color: palette.foregroundColor, fontSize: 12, fontWeight: "700", maxWidth: 220 }}
      >
        {label}
      </Text>
    </View>
  );
}

function BacktestStatusCell({
  progress,
  canOpenLatest,
  onOpenLatest,
}: {
  progress: RowBacktestProgress | null;
  canOpenLatest: boolean;
  onOpenLatest: () => void;
}) {
  const palette =
    progress?.tone === "failed"
      ? {
          backgroundColor: "#fef3f2",
          borderColor: "#fecdca",
          textColor: "#b42318",
          detailColor: "#b42318",
        }
      : progress?.tone === "running"
        ? {
            backgroundColor: "#eff8ff",
            borderColor: "#b2ddff",
            textColor: "#175cd3",
            detailColor: "#1849a9",
          }
        : {
            backgroundColor: "#f2f4f7",
            borderColor: "#d0d5dd",
            textColor: "#667085",
            detailColor: "#667085",
          };
  const currentProgress = progress ?? {
    percent: 0,
    completedCount: 0,
    totalCount: 0,
    runningCount: 0,
    queuedCount: 0,
    failedCount: 0,
    pendingCount: 0,
    tone: "idle" as const,
  };

  const startedCount =
    currentProgress.completedCount +
    currentProgress.runningCount +
    currentProgress.failedCount;
  const counterLabel =
    currentProgress.totalCount > 0
      ? `${startedCount}/${currentProgress.totalCount} backtests`
      : "0 backtests";

  let subtitle = "No backtests running";
  if (currentProgress.runningCount > 0) {
    subtitle = `${currentProgress.runningCount} running`;
    if (currentProgress.queuedCount > 0) {
      subtitle += ` · ${currentProgress.queuedCount} queued`;
    }
  } else if (currentProgress.queuedCount > 0) {
    subtitle = `${currentProgress.queuedCount} queued`;
  } else if (
    currentProgress.failedCount > 0 &&
    currentProgress.completedCount + currentProgress.failedCount === currentProgress.totalCount
  ) {
    subtitle = `${currentProgress.completedCount} completed · ${currentProgress.failedCount} failed`;
  } else if (startedCount > 0) {
    subtitle = `${currentProgress.completedCount} completed`;
    if (currentProgress.failedCount > 0) {
      subtitle += ` · ${currentProgress.failedCount} failed`;
    }
  }

  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: palette.backgroundColor,
        borderWidth: 1,
        borderColor: palette.borderColor,
        gap: 2,
      }}
    >
      <Pressable
        disabled={!canOpenLatest}
        onPress={onOpenLatest}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          opacity: canOpenLatest ? 1 : 0.85,
        }}
      >
        {currentProgress.runningCount > 0 ? (
          <ActivityIndicator size="small" color={palette.textColor} />
        ) : null}
        <Text
          style={{
            color: palette.textColor,
            fontWeight: "700",
            fontSize: 12,
            textDecorationLine: canOpenLatest ? "underline" : "none",
          }}
        >
          {counterLabel}
        </Text>
      </Pressable>
      <Text style={{ color: palette.detailColor, fontSize: 11 }}>
        {subtitle}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={{
        alignSelf: "flex-start",
        borderRadius: 10,
        borderWidth: 1,
        borderColor: disabled ? "#d0d5dd" : "#b2ddff",
        backgroundColor: disabled ? "#f8fafc" : "#eff8ff",
        opacity: disabled ? 0.5 : 1,
        paddingHorizontal: 10,
        paddingVertical: 7,
      }}
    >
      <Text
        style={{
          color: disabled ? "#98a2b3" : "#175cd3",
          fontWeight: "700",
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SingleSelectFilter({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  allLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <MultiSelectFilter
      label={label}
      value={value ? [value] : []}
      options={options}
      allLabel={allLabel}
      onChange={(values) => onChange(values.at(-1) ?? "")}
    />
  );
}

function MetricBadge({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: string | number;
  accent?: "default" | "link" | "success" | "danger";
}) {
  const styles =
    accent === "link"
      ? {
          backgroundColor: "#eff8ff",
          borderColor: "#b2ddff",
          valueColor: "#1d4ed8",
        }
      : accent === "success"
        ? {
            backgroundColor: "#ecfdf3",
            borderColor: "#abefc6",
            valueColor: "#027a48",
          }
        : accent === "danger"
          ? {
              backgroundColor: "#fef3f2",
              borderColor: "#fecdca",
              valueColor: "#b42318",
            }
          : {
              backgroundColor: "#f8fafc",
              borderColor: "#eaecf0",
              valueColor: "#101828",
            };

  return (
    <View
      style={{
        borderRadius: 999,
        backgroundColor: styles.backgroundColor,
        borderWidth: 1,
        borderColor: styles.borderColor,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: "#475467", fontWeight: "700" }}>
        {label}: <Text style={{ color: styles.valueColor }}>{value}</Text>
      </Text>
    </View>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text
        style={{ color: "#475467", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }}
      >
        {label}
      </Text>
      <Text style={{ color: "#101828" }}>{value}</Text>
    </View>
  );
}

function ScoreBreakdownSection({
  run,
}: {
  run: RecentBacktestRun;
}) {
  return (
    <>
      <DetailRow
        label="Score formula"
        value="score = equity PnL - 0.75 × max drawdown - 12 × reversal ratio"
      />
      <DetailRow label="Equity PnL" value={`${run.equityCurvePnlPercent.toFixed(2)}%`} />
      <DetailRow label="Max drawdown" value={`${run.maxDrawdownPercent.toFixed(2)}%`} />
      <DetailRow label="Reversal ratio" value={`${(run.reversalRatio * 100).toFixed(2)}%`} />
      <DetailRow
        label="Close reasons"
        value={`${run.reversalTradeCount.toLocaleString()} reversal · ${run.takeProfitTradeCount.toLocaleString()} TP · ${run.stopLossTradeCount.toLocaleString()} SL · ${run.windowEndTradeCount.toLocaleString()} window`}
      />
      <DetailRow
        label="Non-reversal trades"
        value={run.nonReversalTradeCount.toLocaleString()}
      />
    </>
  );
}
