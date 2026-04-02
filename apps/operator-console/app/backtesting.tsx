import { MaterialIcons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
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

type DataReadinessItem = DataReadinessResponse["items"][number];

type HistoryCombination = {
  key: string;
  analysisLabel: string;
  timeframeCode: string;
  riskProfileName: string;
  strategyName: string;
  bestScore: number;
  latestFinishedAt: string;
  runs: RecentBacktestRun[];
};

type SymbolBacktestingGroup = {
  symbolCode: string;
  readinessItems: Array<
    DataReadinessItem & {
      readinessPercent: number;
      runningJob: BacktestJob | null;
    }
  >;
  runningJobs: BacktestJob[];
  latestRuns: RecentBacktestRun[];
  historyCombinations: HistoryCombination[];
};

const PAGE_SIZE = 10;

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

const formatScore = (value: number): string => value.toFixed(2);

const scorePalette = (value: number) => ({
  backgroundColor: value >= 0 ? "#ecfdf3" : "#fef3f2",
  textColor: value >= 0 ? "#157f3b" : "#b42318",
});

const readinessPercent = (item: DataReadinessItem): number =>
  Math.min(
    Number(item.kline?.coveragePercent ?? 0),
    Number(item.trades?.coveragePercent ?? 0),
  );

const backtestKey = (value: {
  symbolCode: string;
  timeframeCode: string;
  strategyName: string;
}) => `${value.symbolCode}:${value.timeframeCode}:${value.strategyName}`;

export default function BacktestingScreen() {
  const queryClient = useQueryClient();
  const [symbolFilter, setSymbolFilter] = useState<string[]>([]);
  const [timeframeFilter, setTimeframeFilter] = useState<string>("");
  const [strategyFilter, setStrategyFilter] = useState<string>("");
  const [expandedSymbols, setExpandedSymbols] = useState<string[]>([]);
  const [readinessPageBySymbol, setReadinessPageBySymbol] = useState<Record<string, number>>({});
  const [selectedLatestRowKey, setSelectedLatestRowKey] = useState<string | null>(null);
  const [selectedBacktestId, setSelectedBacktestId] = useState<string | null>(null);
  const [selectedHistoryRowKey, setSelectedHistoryRowKey] = useState<string | null>(null);

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

  const symbolOptions = Array.from(
    new Set((symbolsQuery.data ?? []).map((record) => String(record.code ?? ""))),
  )
    .filter(Boolean)
    .sort();
  const timeframeOptions = Array.from(
    new Set((timeframesQuery.data ?? []).map((record) => String(record.code ?? ""))),
  )
    .filter(Boolean)
    .sort();
  const strategyOptions = Array.from(
    new Set([
      ...(runtimeAnalysesQuery.data ?? []).map((analysis) => analysis.strategyName),
      ...((backtestsQuery.data?.recentRuns ?? []).map((run) => run.strategyName) ?? []),
      ...((readinessQuery.data?.items ?? []).map((item) => item.strategyName) ?? []),
      ...((backtestsQuery.data?.jobs ?? []).map((job) => job.strategyName ?? "") ?? []),
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

  const filteredRecentRuns =
    backtestsQuery.data?.recentRuns.filter((run) => {
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

  const filteredRunningJobs =
    backtestsQuery.data?.jobs.filter((job) => {
      if (job.status !== "queued" && job.status !== "running") {
        return false;
      }
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

  const runningJobByKey = new Map<string, BacktestJob>();
  for (const job of filteredRunningJobs) {
    if (!job.symbolCode || !job.timeframeCode || !job.strategyName) {
      continue;
    }
    const key = backtestKey({
      symbolCode: job.symbolCode,
      timeframeCode: job.timeframeCode,
      strategyName: job.strategyName,
    });
    const current = runningJobByKey.get(key);
    if (!current) {
      runningJobByKey.set(key, job);
      continue;
    }
    if (current.status === "queued" && job.status === "running") {
      runningJobByKey.set(key, job);
      continue;
    }
    if (Date.parse(job.updatedAt) > Date.parse(current.updatedAt)) {
      runningJobByKey.set(key, job);
    }
  }

  const symbolGroups = useMemo(() => {
    const symbols = new Set<string>();
    for (const item of filteredReadinessItems) {
      symbols.add(item.symbolCode);
    }
    for (const run of filteredLatestRuns) {
      symbols.add(run.symbol);
    }
    for (const run of filteredRecentRuns) {
      symbols.add(run.symbol);
    }
    for (const job of filteredRunningJobs) {
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
            readinessPercent: readinessPercent(item),
            runningJob: runningJobByKey.get(
              backtestKey({
                symbolCode: item.symbolCode,
                timeframeCode: item.timeframeCode,
                strategyName: item.strategyName,
              }),
            ) ?? null,
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

        const runningJobs = filteredRunningJobs
          .filter((job) => job.symbolCode === symbolCode)
          .sort((left, right) => {
            if (left.status !== right.status) {
              return left.status === "running" ? -1 : 1;
            }
            return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
          });

        const combinations = new Map<string, HistoryCombination>();
        for (const run of filteredRecentRuns.filter((candidate) => candidate.symbol === symbolCode)) {
          const key = [
            run.symbol,
            run.timeframeCode,
            run.analysisSettingId,
            run.riskProfileName,
            run.strategyName,
          ].join(":");
          const current = combinations.get(key) ?? {
            key,
            analysisLabel:
              analysisDetailById.get(run.analysisSettingId) ?? run.analysisSettingId,
            timeframeCode: run.timeframeCode,
            riskProfileName: run.riskProfileName,
            strategyName: run.strategyName,
            bestScore: run.score,
            latestFinishedAt: run.finishedAt,
            runs: [],
          };
          current.bestScore = Math.max(current.bestScore, run.score);
          if (Date.parse(run.finishedAt) > Date.parse(current.latestFinishedAt)) {
            current.latestFinishedAt = run.finishedAt;
          }
          current.runs.push(run);
          combinations.set(key, current);
        }

        const historyCombinations = [...combinations.values()]
          .map((combination) => ({
            ...combination,
            runs: [...combination.runs].sort(
              (left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt),
            ),
          }))
          .sort(
            (left, right) =>
              Date.parse(right.latestFinishedAt) - Date.parse(left.latestFinishedAt),
          );

        return {
          symbolCode,
          readinessItems,
          runningJobs,
          latestRuns,
          historyCombinations,
        };
      })
      .sort((left, right) => left.symbolCode.localeCompare(right.symbolCode));
  }, [
    analysisDetailById,
    filteredLatestRuns,
    filteredReadinessItems,
    filteredRecentRuns,
    filteredRunningJobs,
    runningJobByKey,
  ]);

  const selectedBacktestRun = useMemo(() => {
    if (!selectedBacktestId) {
      return null;
    }

    const runs = [
      ...(backtestsQuery.data?.latestRuns ?? []),
      ...(backtestsQuery.data?.recentRuns ?? []),
    ];

    return runs.find((run) => run.backtestId === selectedBacktestId) ?? null;
  }, [backtestsQuery.data?.latestRuns, backtestsQuery.data?.recentRuns, selectedBacktestId]);

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

  const selectedHistoryContext = useMemo(() => {
    if (!selectedHistoryRowKey) {
      return null;
    }

    const [symbolCode, timeframeCode, strategyName] = selectedHistoryRowKey.split(":");
    if (!symbolCode || !timeframeCode || !strategyName) {
      return null;
    }

    return { symbolCode, timeframeCode, strategyName };
  }, [selectedHistoryRowKey]);

  const selectedHistoryCombinations = useMemo(() => {
    if (!selectedHistoryContext) {
      return [];
    }

    const group = symbolGroups.find(
      (candidate) => candidate.symbolCode === selectedHistoryContext.symbolCode,
    );
    if (!group) {
      return [];
    }

    return group.historyCombinations.filter(
      (combination) =>
        combination.timeframeCode === selectedHistoryContext.timeframeCode &&
        combination.strategyName === selectedHistoryContext.strategyName,
    );
  }, [selectedHistoryContext, symbolGroups]);

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
                          <View
                            style={{
                              borderWidth: 1,
                              borderColor: "#eaecf0",
                              borderRadius: 16,
                              overflow: "hidden",
                            }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                backgroundColor: "#f8fafc",
                                paddingHorizontal: 14,
                                paddingVertical: 10,
                                gap: 12,
                              }}
                            >
                              <TableHeader label="Timeframe" flex={0.8} />
                              <TableHeader label="Strategy" flex={1.1} />
                              <TableHeader label="Data" flex={1.9} />
                              <TableHeader label="Backtest" flex={1.4} />
                              <TableHeader label="Latest backtest" flex={0.9} />
                              <TableHeader label="Score evolution" flex={0.9} />
                            </View>
                            {paginatedItems.map((item, index) => {
                              const rowKey = backtestKey(item);
                              const hasLatest = group.latestRuns.some(
                                (run) =>
                                  run.timeframeCode === item.timeframeCode &&
                                  run.strategyName === item.strategyName,
                              );
                              const hasHistory = group.historyCombinations.some(
                                (combination) =>
                                  combination.timeframeCode === item.timeframeCode &&
                                  combination.strategyName === item.strategyName,
                              );

                              return (
                                <View
                                  key={rowKey}
                                  style={{
                                    flexDirection: "row",
                                    paddingHorizontal: 14,
                                    paddingVertical: 12,
                                    gap: 12,
                                    borderTopWidth: index === 0 ? 0 : 1,
                                    borderTopColor: "#eaecf0",
                                    backgroundColor: index % 2 === 0 ? "#ffffff" : "#fcfcfd",
                                    alignItems: "center",
                                  }}
                                >
                                  <TableCell label={item.timeframeCode} flex={0.8} />
                                  <TableCell label={item.strategyName} flex={1.1} />
                                  <View style={{ flex: 1.9, gap: 8 }}>
                                    <ReadinessDataBadge
                                      label="Klines"
                                      percent={Number(item.kline?.coveragePercent ?? 0)}
                                    />
                                    <ReadinessDataBadge
                                      label="Trades"
                                      percent={Number(item.trades?.coveragePercent ?? 0)}
                                    />
                                  </View>
                                  <View style={{ flex: 1.4 }}>
                                    <BacktestStatusCell job={item.runningJob} />
                                  </View>
                                  <View style={{ flex: 0.9 }}>
                                    <ActionButton
                                      label="View"
                                      disabled={!hasLatest}
                                      onPress={() => setSelectedLatestRowKey(rowKey)}
                                    />
                                  </View>
                                  <View style={{ flex: 0.9 }}>
                                    <ActionButton
                                      label="View"
                                      disabled={!hasHistory}
                                      onPress={() => setSelectedHistoryRowKey(rowKey)}
                                    />
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                              flexWrap: "wrap",
                            }}
                          >
                            <Text style={{ color: "#475467", fontWeight: "600" }}>
                              Page {currentPage} of {totalPages} · {totalCount.toLocaleString()} rows
                            </Text>
                            <View style={{ flexDirection: "row", gap: 8 }}>
                              <PaginationButton
                                label="Previous"
                                disabled={currentPage <= 1}
                                onPress={() =>
                                  setReadinessPage(group.symbolCode, currentPage - 1)
                                }
                              />
                              <PaginationButton
                                label="Next"
                                disabled={currentPage >= totalPages}
                                onPress={() =>
                                  setReadinessPage(group.symbolCode, currentPage + 1)
                                }
                              />
                            </View>
                          </View>
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
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: "#eaecf0",
                      borderRadius: 16,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        backgroundColor: "#f8fafc",
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        gap: 12,
                      }}
                    >
                      <TableHeader label="Analysis" flex={2.1} />
                      <TableHeader label="Risk" flex={1.1} />
                      <TableHeader label="Score" flex={0.8} align="right" />
                      <TableHeader label="Finished" flex={1.4} align="right" />
                    </View>
                    {selectedLatestRuns.map((run, index) => (
                      <View
                        key={`${run.backtestId}:${run.analysisSettingId}:${run.riskProfileName}`}
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 12,
                          borderTopWidth: index === 0 ? 0 : 1,
                          borderTopColor: "#eaecf0",
                          backgroundColor: index % 2 === 0 ? "#ffffff" : "#fcfcfd",
                          gap: 10,
                        }}
                      >
                        <View style={{ flexDirection: "row", gap: 12 }}>
                          <TableCell
                            label={
                              analysisDetailById.get(run.analysisSettingId) ??
                              run.analysisSettingId
                            }
                            flex={2.1}
                          />
                          <TableCell label={run.riskProfileName} flex={1.1} />
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
                          <TableCell
                            label={new Date(run.finishedAt).toLocaleString()}
                            flex={1.4}
                            align="right"
                          />
                        </View>
                        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                          <MetricBadge
                            label="Duration"
                            value={formatDuration(run.backtestDurationMs)}
                          />
                          <MetricBadge
                            label="Equity PnL"
                            value={`${run.equityCurvePnlPercent.toFixed(2)}%`}
                          />
                          <MetricBadge
                            label="Max DD"
                            value={`${run.maxDrawdownPercent.toFixed(2)}%`}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
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
      <Modal
        visible={selectedHistoryRowKey !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedHistoryRowKey(null)}
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
                    Score evolution
                  </Text>
                  {selectedHistoryContext ? (
                    <Text style={{ color: "#475467" }}>
                      {selectedHistoryContext.symbolCode} · {selectedHistoryContext.timeframeCode} ·{" "}
                      {selectedHistoryContext.strategyName}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setSelectedHistoryRowKey(null)}
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
                contentContainerStyle={{ gap: 14 }}
                showsVerticalScrollIndicator
              >
                {selectedHistoryCombinations.length === 0 ? (
                  <Text style={{ color: "#475467" }}>
                    No backtest history for this timeframe and strategy.
                  </Text>
                ) : (
                  selectedHistoryCombinations.map((combination) => (
                    <View
                      key={combination.key}
                      style={{
                        borderWidth: 1,
                        borderColor: "#eaecf0",
                        borderRadius: 16,
                        padding: 14,
                        gap: 12,
                        backgroundColor: "#fcfcfd",
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
                          <Text
                            style={{
                              color: "#101828",
                              fontWeight: "800",
                              fontSize: 15,
                            }}
                          >
                            {combination.analysisLabel}
                          </Text>
                          <Text style={{ color: "#475467" }}>
                            {combination.timeframeCode} · {combination.riskProfileName} ·{" "}
                            {combination.strategyName}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                          <MetricBadge
                            label="Runs"
                            value={combination.runs.length.toLocaleString()}
                          />
                          <Pressable
                            onPress={() =>
                              setSelectedBacktestId(
                                findTopScoringRun(combination.runs)?.backtestId ?? null,
                              )
                            }
                          >
                            <MetricBadge
                              label="Best score"
                              value={formatScore(combination.bestScore)}
                              accent="link"
                            />
                          </Pressable>
                        </View>
                      </View>

                      <PnlHistoryChart runs={combination.runs} />
                    </View>
                  ))
                )}
              </ScrollView>
            </Card>
          </View>
        </View>
      </Modal>
    </AppShell>
  );
}

function formatBacktestStage(stage: string | null): string {
  switch (stage) {
    case "retrieving-data":
      return "Retrieving data";
    case "simulating":
      return "Simulating";
    case "running-backtests":
      return "Running backtests";
    case "queued":
      return "Queued";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Running";
  }
}

function InlineStatePill({
  label,
  tone,
}: {
  label: string;
  tone: "ready" | "running" | "pending";
}) {
  const styles =
    tone === "ready"
      ? { backgroundColor: "#ecfdf3", color: "#027a48" }
      : tone === "running"
        ? { backgroundColor: "#eff8ff", color: "#175cd3" }
        : { backgroundColor: "#fef3f2", color: "#b42318" };

  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        backgroundColor: styles.backgroundColor,
      }}
    >
      <Text style={{ color: styles.color, fontWeight: "700", fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}

function ReadinessDataBadge({
  label,
  percent,
}: {
  label: string;
  percent: number;
}) {
  const complete = percent >= 100;
  const displayPercent = complete
    ? "100%"
    : `${Math.floor(Math.max(percent, 0) * 10) / 10}%`;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        backgroundColor: complete ? "#ecfdf3" : "#fef3f2",
      }}
    >
      <Text
        style={{
          color: complete ? "#027a48" : "#b42318",
          fontWeight: "700",
          fontSize: 12,
        }}
      >
        {label} {displayPercent}
      </Text>
    </View>
  );
}

function BacktestStatusCell({
  job,
}: {
  job: BacktestJob | null;
}) {
  if (!job) {
    return (
      <View
        style={{
          alignSelf: "flex-start",
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 4,
          backgroundColor: "#f2f4f7",
          opacity: 0.6,
        }}
      >
        <Text style={{ color: "#667085", fontWeight: "700", fontSize: 12 }}>
          Not running
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        backgroundColor: "#eff8ff",
      }}
    >
      <Text style={{ color: "#175cd3", fontWeight: "700", fontSize: 12 }}>
        {job.status === "running"
          ? `${Math.round(job.progressPercent ?? 0)}%`
          : "Queued"}
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

function PaginationButton({
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
      onPress={onPress}
      disabled={disabled}
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: disabled ? "#eaecf0" : "#d0d5dd",
        backgroundColor: disabled ? "#f2f4f7" : "#ffffff",
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <Text style={{ color: disabled ? "#98a2b3" : "#344054", fontWeight: "700" }}>{label}</Text>
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
  accent?: "default" | "link";
}) {
  return (
    <View
      style={{
        borderRadius: 999,
        backgroundColor: "#f8fafc",
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: "#475467", fontWeight: "700" }}>
        {label}: <Text style={{ color: accent === "link" ? "#1d4ed8" : "#101828" }}>{value}</Text>
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

function findTopScoringRun(runs: RecentBacktestRun[]) {
  return runs.reduce<RecentBacktestRun | null>(
    (best, run) => (best === null || run.score > best.score ? run : best),
    null,
  );
}

function PnlHistoryChart({
  runs,
}: {
  runs: RecentBacktestRun[];
}) {
  const width = 360;
  const height = 220;
  const paddingLeft = 44;
  const paddingRight = 16;
  const paddingTop = 14;
  const paddingBottom = 42;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const safeRuns = [...runs].sort(
    (left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt),
  );
  const yValues = safeRuns.map((run) => run.score);
  const minY = Math.min(0, ...yValues);
  const maxY = Math.max(0, ...yValues);
  const ySpan = maxY - minY || 1;
  const strokeColor = scorePalette(safeRuns[safeRuns.length - 1]?.score ?? 0).textColor;
  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount }, (_, index) => {
    const ratio = index / (yTickCount - 1);
    const value = maxY - ratio * ySpan;
    const y = paddingTop + ratio * chartHeight;
    return {
      value,
      y,
      label: `${value >= 0 ? "+" : ""}${value.toFixed(1)}`,
    };
  });
  const xLabelIndexes = buildXAxisLabelIndexes(safeRuns.length);

  const points = safeRuns.map((run, index) => {
    const x =
      safeRuns.length === 1
        ? paddingLeft + chartWidth / 2
        : paddingLeft + (index / (safeRuns.length - 1)) * chartWidth;
    const y = paddingTop + ((maxY - run.score) / ySpan) * chartHeight;
    return { x, y };
  });

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  const firstLabel =
    safeRuns[0] === undefined
      ? ""
      : new Date(safeRuns[0].finishedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
  const lastLabel =
    safeRuns[safeRuns.length - 1] === undefined
      ? ""
      : new Date(safeRuns[safeRuns.length - 1].finishedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });

  return (
    <View
      style={{
        borderRadius: 14,
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: "#eaecf0",
        padding: 12,
        gap: 8,
      }}
    >
      {safeRuns.length === 0 ? (
        <Text style={{ color: "#475467" }}>No completed runs available.</Text>
      ) : (
        <>
          <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
            {yTicks.map((tick) => (
              <Line
                key={`line:${tick.label}`}
                x1={paddingLeft}
                x2={width - paddingRight}
                y1={tick.y}
                y2={tick.y}
                stroke={Math.abs(tick.value) < 0.05 ? "#98a2b3" : "#d0d5dd"}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            ))}
            {yTicks.map((tick) => (
              <SvgText
                key={`label:${tick.label}`}
                x={paddingLeft - 8}
                y={tick.y + 4}
                fontSize="10"
                fill="#475467"
                textAnchor="end"
              >
                {tick.label}
              </SvgText>
            ))}
            <Line
              x1={paddingLeft}
              x2={width - paddingRight}
              y1={paddingTop + chartHeight}
              y2={paddingTop + chartHeight}
              stroke="#98a2b3"
              strokeWidth={1}
            />
            <Path d={path} fill="none" stroke={strokeColor} strokeWidth={3} strokeLinecap="round" />
            {points.map((point, index) => (
              <Circle
                key={`${safeRuns[index]?.backtestId ?? index}`}
                cx={point.x}
                cy={point.y}
                r={4}
                fill={strokeColor}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
            {xLabelIndexes.map((index) => {
              const point = points[index];
              const run = safeRuns[index];
              if (!point || !run) {
                return null;
              }

              return (
                <SvgText
                  key={`x:${run.backtestId}`}
                  x={point.x}
                  y={height - 12}
                  fontSize="10"
                  fill="#475467"
                  textAnchor="middle"
                >
                  {formatXAxisDate(run.finishedAt)}
                </SvgText>
              );
            })}
          </Svg>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ color: "#475467", fontSize: 12 }}>{firstLabel}</Text>
            <Text style={{ color: "#475467", fontSize: 12 }}>Backtest date</Text>
            <Text style={{ color: "#475467", fontSize: 12 }}>{lastLabel}</Text>
          </View>
        </>
      )}
    </View>
  );
}

function buildXAxisLabelIndexes(length: number) {
  if (length <= 4) {
    return Array.from({ length }, (_, index) => index);
  }

  const indexes = new Set<number>([0, length - 1]);
  const desiredLabels = 4;
  for (let step = 1; step < desiredLabels - 1; step += 1) {
    indexes.add(Math.round((step / (desiredLabels - 1)) * (length - 1)));
  }

  return [...indexes].sort((left, right) => left - right);
}

function formatXAxisDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function TableHeader({
  label,
  flex,
  align = "left",
}: {
  label: string;
  flex: number;
  align?: "left" | "right";
}) {
  return (
    <View style={{ flex, alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <Text style={{ color: "#475467", fontWeight: "800", fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function TableCell({
  label,
  flex,
  align = "left",
  color = "#101828",
  weight = "500",
}: {
  label: string;
  flex: number;
  align?: "left" | "right";
  color?: string;
  weight?: "500" | "700";
}) {
  return (
    <View style={{ flex, alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <Text
        style={{
          color,
          fontWeight: weight,
          textAlign: align,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
