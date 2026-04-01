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
  type BacktestBatch,
  type RecentBacktestRun,
  type DataReadinessResponse,
  getBacktestsSummary,
  getConfigResourceRecords,
  getDataReadiness,
  getRuntimeAnalyses,
} from "@/src/lib/api";
import { subscribeOpsRealtimeEvent } from "@/src/lib/ops-events";

type BacktestingSection = "backtests" | "data-readiness";
type DataReadinessItem = DataReadinessResponse["items"][number];

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

export default function BacktestingScreen() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<BacktestingSection>("data-readiness");
  const [symbolFilter, setSymbolFilter] = useState<string[]>([]);
  const [timeframeFilter, setTimeframeFilter] = useState<string[]>([]);
  const [expandedSymbols, setExpandedSymbols] = useState<string[]>([]);
  const [expandedHistorySymbols, setExpandedHistorySymbols] = useState<string[]>([]);
  const [expandedReadinessSymbols, setExpandedReadinessSymbols] = useState<string[]>([]);
  const [selectedBacktestId, setSelectedBacktestId] = useState<string | null>(null);

  const backtestsQuery = useQuery({
    queryKey: ["ops-backtests-summary"],
    queryFn: getBacktestsSummary,
  });
  const readinessQuery = useQuery({
    queryKey: ["ops-data-readiness"],
    queryFn: getDataReadiness,
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
  const symbolState = new Map(
    (symbolsQuery.data ?? []).map((record) => [String(record.code ?? ""), Boolean(record.active)]),
  );
  const timeframeState = new Map(
    (timeframesQuery.data ?? []).map((record) => [
      String(record.code ?? ""),
      Boolean(record.active),
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

  const filteredRuns =
    backtestsQuery.data?.latestRuns.filter((run) => {
      if (symbolFilter.length > 0 && !symbolFilter.includes(run.symbol)) {
        return false;
      }
      if (timeframeFilter.length > 0 && !timeframeFilter.includes(run.timeframeCode)) {
        return false;
      }
      return true;
    }) ?? [];
  const filteredRecentRuns =
    backtestsQuery.data?.recentRuns.filter((run) => {
      if (symbolFilter.length > 0 && !symbolFilter.includes(run.symbol)) {
        return false;
      }
      if (timeframeFilter.length > 0 && !timeframeFilter.includes(run.timeframeCode)) {
        return false;
      }
      return true;
    }) ?? [];
  const filteredBatches =
    backtestsQuery.data?.batches.filter((batch) => {
      if (symbolFilter.length > 0 && !symbolFilter.includes(batch.symbolCode)) {
        return false;
      }
      if (timeframeFilter.length > 0 && !timeframeFilter.includes(batch.timeframeCode)) {
        return false;
      }
      return true;
    }) ?? [];
  const runningDatasetGroups = groupRunningBatchesBySymbol(filteredBatches);

  const filteredReadinessItems =
    readinessQuery.data?.items.filter((item) => {
      if (symbolFilter.length > 0 && !symbolFilter.includes(item.symbolCode)) {
        return false;
      }
      if (timeframeFilter.length > 0 && !timeframeFilter.includes(item.timeframeCode)) {
        return false;
      }
      return true;
    }) ?? [];
  const latestBacktestGroups = groupLatestBacktestsBySymbol(filteredRuns);
  const backtestHistoryGroups = groupBacktestHistoryBySymbol(
    filteredRecentRuns,
    analysisDetailById,
  );
  const readinessGroups = groupDataReadinessBySymbol(filteredReadinessItems);
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

  const toggleExpandedSymbol = (symbolCode: string) => {
    setExpandedSymbols((current) =>
      current.includes(symbolCode)
        ? current.filter((value) => value !== symbolCode)
        : [...current, symbolCode],
    );
  };

  const toggleExpandedReadinessSymbol = (symbolCode: string) => {
    setExpandedReadinessSymbols((current) =>
      current.includes(symbolCode)
        ? current.filter((value) => value !== symbolCode)
        : [...current, symbolCode],
    );
  };

  const toggleExpandedHistorySymbol = (symbolCode: string) => {
    setExpandedHistorySymbols((current) =>
      current.includes(symbolCode)
        ? current.filter((value) => value !== symbolCode)
        : [...current, symbolCode],
    );
  };

  return (
    <AppShell>
      <View style={{ gap: 16 }}>
        <View
          style={{
            marginHorizontal: -24,
            marginTop: -20,
          }}
        >
          <View
            style={{
              width: "100%",
              backgroundColor: "#dbe2ea",
              paddingHorizontal: 24,
              paddingVertical: 10,
            }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                minWidth: "100%",
                paddingRight: 8,
              }}
            >
              {[
                { key: "data-readiness", label: "Data", icon: "analytics" as const },
                { key: "backtests", label: "Backtests", icon: "history" as const },
              ].map((item) => {
                const active = section === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setSection(item.key as BacktestingSection)}
                    style={{
                      borderRadius: 10,
                      backgroundColor: active ? "#1f3a5f" : "transparent",
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <MaterialIcons
                      name={item.icon}
                      size={18}
                      color={active ? "#ffffff" : "#344054"}
                    />
                    <Text
                      style={{
                        color: active ? "#ffffff" : "#344054",
                        fontWeight: "700",
                      }}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>

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
          <MultiSelectFilter
            label="Timeframe"
            value={timeframeFilter}
            options={timeframeOptions}
            onChange={setTimeframeFilter}
            allLabel="All timeframes"
          />
        </View>

        {section === "backtests" ? (
          <View style={{ gap: 16 }}>
            {backtestsQuery.isLoading ? (
              <Text style={{ color: "#475467" }}>Loading latest backtests…</Text>
            ) : (
              <>
                <View style={{ gap: 12 }}>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: "#101828" }}>
                    Running backtests
                  </Text>
                  {runningDatasetGroups.length === 0 ? (
                    <Text style={{ color: "#475467" }}>No backtests are currently running.</Text>
                  ) : (
                    runningDatasetGroups.map((group) => (
                      <Card key={group.symbolCode}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 16,
                            flexWrap: "wrap",
                          }}
                        >
                          <View style={{ flex: 1, minWidth: 240, gap: 8 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                              <SymbolAvatar
                                baseAsset={symbolBaseAssets.get(group.symbolCode)}
                                destinationAsset={symbolDestinationAssets.get(group.symbolCode)}
                                size={34}
                              />
                              <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                                {group.symbolCode}
                              </Text>
                            </View>
                            <Text style={{ color: "#475467" }}>
                              {formatBacktestStage(group.stage)}
                            </Text>
                            <Text style={{ color: "#475467" }}>
                              {group.timeframeCount} timeframe{group.timeframeCount === 1 ? "" : "s"}
                            </Text>
                            <Text style={{ color: "#475467" }}>
                              {group.completedCount}/{group.totalCount} finished
                            </Text>
                          </View>
                          <View style={{ alignItems: "center", gap: 8 }}>
                            <ProgressRing
                              value={group.progressPercent}
                              color="#1f3a5f"
                              size={64}
                              strokeWidth={7}
                            />
                            <Text style={{ color: "#475467", fontWeight: "700" }}>
                              {group.runningCount} running
                            </Text>
                          </View>
                        </View>
                      </Card>
                    ))
                  )}
                </View>

                <View style={{ gap: 12 }}>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: "#101828" }}>
                    Latest backtests
                  </Text>
                  {latestBacktestGroups.length === 0 ? (
                    <Text style={{ color: "#475467" }}>No latest backtests match the current filters.</Text>
                  ) : (
                    latestBacktestGroups.map((group) => {
                      const expanded = expandedSymbols.includes(group.symbol);
                      return (
                        <Card key={group.symbol}>
                          <Pressable
                            onPress={() => toggleExpandedSymbol(group.symbol)}
                            style={{
                              gap: 14,
                            }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                gap: 16,
                                flexWrap: "wrap",
                              }}
                            >
                              <View style={{ flex: 1, minWidth: 240, gap: 6 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                                  <SymbolAvatar
                                    baseAsset={symbolBaseAssets.get(group.symbol)}
                                    destinationAsset={symbolDestinationAssets.get(group.symbol)}
                                    size={34}
                                  />
                                  <Text
                                    style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}
                                  >
                                    {group.symbol}
                                  </Text>
                                </View>
                                <Text style={{ color: "#475467" }}>
                                  {group.count.toLocaleString()} latest backtest
                                  {group.count === 1 ? "" : "s"} · {group.timeframeCount.toLocaleString()} timeframe
                                  {group.timeframeCount === 1 ? "" : "s"}
                                </Text>
                                <Text style={{ color: "#475467" }}>
                                  Last finished: {new Date(group.latestFinishedAt).toLocaleString()}
                                </Text>
                              </View>

                              <View style={{ alignItems: "flex-end", gap: 10 }}>
                                <Pressable
                                  onPress={(event) => {
                                    event.stopPropagation();
                                    setSelectedBacktestId(findTopScoringRun(group.runs)?.backtestId ?? null);
                                  }}
                                  style={{
                                    borderRadius: 16,
                                    backgroundColor: scorePalette(group.bestScore).backgroundColor,
                                    paddingHorizontal: 14,
                                    paddingVertical: 12,
                                    minWidth: 120,
                                    alignItems: "center",
                                  }}
                                >
                                  <Text
                                    style={{
                                      color: scorePalette(group.bestScore).textColor,
                                      fontSize: 20,
                                      fontWeight: "800",
                                    }}
                                  >
                                    {formatScore(group.bestScore)}
                                  </Text>
                                  <Text
                                    style={{
                                      color: scorePalette(group.bestScore).textColor,
                                      fontWeight: "700",
                                      marginTop: 2,
                                    }}
                                  >
                                    Best score
                                  </Text>
                                </Pressable>
                                <View
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <Text style={{ color: "#475467", fontWeight: "700" }}>
                                    {expanded ? "Hide details" : "Show details"}
                                  </Text>
                                  <MaterialIcons
                                    name={expanded ? "expand-less" : "expand-more"}
                                    size={20}
                                    color="#475467"
                                  />
                                </View>
                              </View>
                            </View>

                          </Pressable>

                          {expanded ? (
                            <View
                              style={{
                                marginTop: 14,
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
                                <TableHeader label="Timeframe" flex={0.9} />
                                <TableHeader label="Analysis" flex={2.2} />
                                <TableHeader label="Risk" flex={1.1} />
                                <TableHeader label="Score" flex={0.8} align="right" />
                                <TableHeader label="Duration" flex={0.9} align="right" />
                                <TableHeader label="Finished" flex={1.3} align="right" />
                              </View>
                              {group.runs.map((run, index) => (
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
                                    <TableCell label={run.timeframeCode} flex={0.9} />
                                    <TableCell
                                      label={
                                        analysisDetailById.get(run.analysisSettingId) ??
                                        run.analysisSettingId
                                      }
                                      flex={2.2}
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
                                      label={formatDuration(run.backtestDurationMs)}
                                      flex={0.9}
                                      align="right"
                                    />
                                    <TableCell
                                      label={new Date(run.finishedAt).toLocaleString()}
                                      flex={1.3}
                                      align="right"
                                    />
                                  </View>
                                  <View
                                    style={{
                                      flexDirection: "row",
                                      gap: 8,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <MetricBadge
                                      label="Equity PnL"
                                      value={`${run.equityCurvePnlPercent.toFixed(2)}%`}
                                    />
                                    <MetricBadge
                                      label="Max DD"
                                      value={`${run.maxDrawdownPercent.toFixed(2)}%`}
                                    />
                                    <MetricBadge
                                      label="Reversal"
                                      value={run.reversalTradeCount.toLocaleString()}
                                    />
                                    <MetricBadge
                                      label="TP"
                                      value={run.takeProfitTradeCount.toLocaleString()}
                                    />
                                    <MetricBadge
                                      label="SL"
                                      value={run.stopLossTradeCount.toLocaleString()}
                                    />
                                    <MetricBadge
                                      label="Window"
                                      value={run.windowEndTradeCount.toLocaleString()}
                                    />
                                  </View>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </Card>
                      );
                    })
                  )}
                </View>

                <View style={{ gap: 12 }}>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: "#101828" }}>
                    Score evolution
                  </Text>
                  {backtestHistoryGroups.length === 0 ? (
                    <Text style={{ color: "#475467" }}>
                      No backtest history matches the current filters.
                    </Text>
                  ) : (
                    backtestHistoryGroups.map((group) => {
                      const expanded = expandedHistorySymbols.includes(group.symbol);
                      return (
                        <Card key={`history:${group.symbol}`}>
                          <Pressable
                            onPress={() => toggleExpandedHistorySymbol(group.symbol)}
                            style={{ gap: 14 }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                gap: 16,
                                flexWrap: "wrap",
                              }}
                            >
                              <View style={{ flex: 1, minWidth: 240, gap: 6 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                                  <SymbolAvatar
                                    baseAsset={symbolBaseAssets.get(group.symbol)}
                                    destinationAsset={symbolDestinationAssets.get(group.symbol)}
                                    size={34}
                                  />
                                  <Text
                                    style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}
                                  >
                                    {group.symbol}
                                  </Text>
                                </View>
                                <Text style={{ color: "#475467" }}>
                                  {group.combinationCount.toLocaleString()} combination
                                  {group.combinationCount === 1 ? "" : "s"} ·{" "}
                                  {group.runCount.toLocaleString()} run
                                  {group.runCount === 1 ? "" : "s"}
                                </Text>
                                <Text style={{ color: "#475467" }}>
                                  Last finished: {new Date(group.latestFinishedAt).toLocaleString()}
                                </Text>
                              </View>

                              <View style={{ alignItems: "flex-end", gap: 10 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                  <Text style={{ color: "#475467", fontWeight: "700" }}>
                                    {expanded ? "Hide charts" : "Show charts"}
                                  </Text>
                                  <MaterialIcons
                                    name={expanded ? "expand-less" : "expand-more"}
                                    size={20}
                                    color="#475467"
                                  />
                                </View>
                              </View>
                            </View>
                          </Pressable>

                          {expanded ? (
                            <View style={{ marginTop: 14, gap: 14 }}>
                              {group.combinations.map((combination) => (
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
                                        onPress={(event) => {
                                          event.stopPropagation();
                                          setSelectedBacktestId(findTopScoringRun(combination.runs)?.backtestId ?? null);
                                        }}
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
                              ))}
                            </View>
                          ) : null}
                        </Card>
                      );
                    })
                  )}
                </View>
              </>
            )}
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {readinessQuery.isLoading ? (
              <Text style={{ color: "#475467" }}>Loading readiness data…</Text>
            ) : readinessGroups.length === 0 ? (
              <Text style={{ color: "#475467" }}>No readiness rows match the current filters.</Text>
            ) : (
              readinessGroups.map((group) => {
                const expanded = expandedReadinessSymbols.includes(group.symbolCode);
                return (
                  <Card key={group.symbolCode}>
                    <Pressable onPress={() => toggleExpandedReadinessSymbol(group.symbolCode)} style={{ gap: 14 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 16,
                          flexWrap: "wrap",
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 240, gap: 8 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                            <SymbolAvatar
                              baseAsset={symbolBaseAssets.get(group.symbolCode)}
                              destinationAsset={symbolDestinationAssets.get(group.symbolCode)}
                              size={34}
                            />
                            <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                              {group.symbolCode}
                            </Text>
                          </View>
                          <Text style={{ color: "#475467" }}>
                            {group.timeframeCount} timeframe{group.timeframeCount === 1 ? "" : "s"} ·{" "}
                            {group.readyCount}/{group.count} ready
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 10 }}>
                          <View
                            style={{
                              borderRadius: 16,
                              backgroundColor:
                                group.readyCount === group.count ? "#ecfdf3" : "#fef3f2",
                              paddingHorizontal: 14,
                              paddingVertical: 12,
                              minWidth: 120,
                              alignItems: "center",
                            }}
                          >
                            <Text
                              style={{
                                color:
                                  group.readyCount === group.count ? "#027a48" : "#b42318",
                                fontWeight: "800",
                              }}
                            >
                              {group.readyCount === group.count ? "Complete" : "Incomplete"}
                            </Text>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ color: "#475467", fontWeight: "700" }}>
                              {expanded ? "Hide details" : "Show details"}
                            </Text>
                            <MaterialIcons
                              name={expanded ? "expand-less" : "expand-more"}
                              size={20}
                              color="#475467"
                            />
                          </View>
                        </View>
                      </View>
                    </Pressable>

                    {expanded ? (
                      <View
                        style={{
                          marginTop: 14,
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
                          <TableHeader label="State" flex={0.8} />
                          <TableHeader label="Klines" flex={1.6} />
                          <TableHeader label="Trades" flex={1.6} />
                        </View>
                        {group.items.map((item, index) => (
                          <View
                            key={`${item.symbolCode}:${item.timeframeCode}`}
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
                            <View style={{ flex: 0.8, alignItems: "flex-start" }}>
                              <StatusBadge
                                label="Active"
                                value={
                                  (symbolState.get(item.symbolCode) ?? false) &&
                                  (timeframeState.get(item.timeframeCode) ?? false)
                                }
                              />
                            </View>
                            <View style={{ flex: 1.6 }}>
                              <DimensionSummary label="Klines" dimension={item.kline} compact />
                            </View>
                            <View style={{ flex: 1.6 }}>
                              <DimensionSummary label="Trades" dimension={item.trades} compact />
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </Card>
                );
              })
            )}
          </View>
        )}
      </View>
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
                  Score details
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
                    <DetailRow label="Analysis setting id" value={selectedBacktestRun.analysisSettingId} />
                    <DetailRow label="Risk profile" value={selectedBacktestRun.riskProfileName} />
                    <DetailRow label="Finished" value={new Date(selectedBacktestRun.finishedAt).toLocaleString()} />
                    <DetailRow label="Score" value={selectedBacktestRun.score.toFixed(2)} />
                    <ScoreBreakdownSection run={selectedBacktestRun} />
                    <DetailRow label="Backtest duration" value={formatDuration(selectedBacktestRun.backtestDurationMs)} />
                    <DetailRow label="Strategy counts" value={`${selectedBacktestRun.signalCount} signals · ${selectedBacktestRun.tradeCount} trades`} />
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

function formatBacktestStage(stage: string | null): string {
  switch (stage) {
    case "retrieving-data":
      return "Retrieving data";
    case "simulating":
      return "Simulating backtest";
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
      <Text style={{ color: "#475467", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }}>
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

function groupRunningBatchesBySymbol(
  batches: BacktestBatch[],
) {
  const groups = new Map<
    string,
    {
      symbolCode: string;
      totalCount: number;
      completedCount: number;
      runningCount: number;
      progressPercent: number;
      stage: string | null;
      timeframeCount: number;
      batchCount: number;
    }
  >();

  for (const batch of batches) {
    if (batch.stage === "completed" && batch.completedCount >= batch.totalCount) {
      continue;
    }

    const current = groups.get(batch.symbolCode) ?? {
      symbolCode: batch.symbolCode,
      totalCount: 0,
      completedCount: 0,
      runningCount: 0,
      progressPercent: 0,
      stage: null,
      timeframeCount: 0,
      batchCount: 0,
    };

    const weightedProgressTotal =
      current.progressPercent * current.totalCount + batch.progressPercent * batch.totalCount;
    current.totalCount += batch.totalCount;
    current.completedCount += batch.completedCount;
    current.runningCount += batch.runningCount;
    current.batchCount += 1;
    current.progressPercent =
      current.totalCount > 0 ? weightedProgressTotal / current.totalCount : 0;
    current.stage =
      batch.stage === "retrieving-data"
        ? batch.stage
        : current.stage === "retrieving-data"
          ? current.stage
          : batch.stage;
    groups.set(batch.symbolCode, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      timeframeCount: new Set(
        batches
          .filter((batch) => batch.symbolCode === group.symbolCode)
          .map((batch) => batch.timeframeCode),
      ).size,
    }))
    .sort((left, right) => left.symbolCode.localeCompare(right.symbolCode));
}

function groupLatestBacktestsBySymbol(runs: RecentBacktestRun[]) {
  const groups = new Map<
    string,
    {
      symbol: string;
      count: number;
      timeframeCount: number;
      bestScore: number;
      latestFinishedAt: string;
      runs: RecentBacktestRun[];
    }
  >();

  for (const run of runs) {
    const current =
      groups.get(run.symbol) ??
      {
        symbol: run.symbol,
        count: 0,
        timeframeCount: 0,
        bestScore: Number.NEGATIVE_INFINITY,
        latestFinishedAt: run.finishedAt,
        runs: [],
      };

    current.count += 1;
    current.bestScore = Math.max(current.bestScore, run.score);
    if (Date.parse(run.finishedAt) > Date.parse(current.latestFinishedAt)) {
      current.latestFinishedAt = run.finishedAt;
    }
    current.runs.push(run);
    groups.set(run.symbol, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      timeframeCount: new Set(group.runs.map((run) => run.timeframeCode)).size,
      runs: [...group.runs].sort(
        (left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt),
      ),
    }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function groupBacktestHistoryBySymbol(
  runs: RecentBacktestRun[],
  analysisDetailById: Map<string, string>,
) {
  const groups = new Map<
    string,
    {
      symbol: string;
      runCount: number;
      combinationCount: number;
      latestFinishedAt: string;
      combinations: {
        key: string;
        analysisLabel: string;
        timeframeCode: string;
        riskProfileName: string;
        strategyName: string;
        bestScore: number;
        latestFinishedAt: string;
        runs: RecentBacktestRun[];
      }[];
    }
  >();

  for (const run of runs) {
    const combinationKey = [
      run.symbol,
      run.timeframeCode,
      run.analysisSettingId,
      run.riskProfileName,
      run.strategyName,
    ].join(":");
    const current =
      groups.get(run.symbol) ??
      {
        symbol: run.symbol,
        runCount: 0,
        combinationCount: 0,
        latestFinishedAt: run.finishedAt,
        combinations: [],
      };

    current.runCount += 1;
    if (Date.parse(run.finishedAt) > Date.parse(current.latestFinishedAt)) {
      current.latestFinishedAt = run.finishedAt;
    }

    const existingCombination = current.combinations.find(
      (combination) => combination.key === combinationKey,
    );

    if (existingCombination) {
      existingCombination.runs.push(run);
      existingCombination.bestScore = Math.max(existingCombination.bestScore, run.score);
      if (Date.parse(run.finishedAt) > Date.parse(existingCombination.latestFinishedAt)) {
        existingCombination.latestFinishedAt = run.finishedAt;
      }
    } else {
      current.combinations.push({
        key: combinationKey,
        analysisLabel:
          analysisDetailById.get(run.analysisSettingId) ?? run.analysisSettingId,
        timeframeCode: run.timeframeCode,
        riskProfileName: run.riskProfileName,
        strategyName: run.strategyName,
        bestScore: run.score,
        latestFinishedAt: run.finishedAt,
        runs: [run],
      });
    }

    groups.set(run.symbol, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      combinationCount: group.combinations.length,
      combinations: group.combinations
        .map((combination) => ({
          ...combination,
          runs: [...combination.runs].sort(
            (left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt),
          ),
        }))
        .sort(
          (left, right) =>
            Date.parse(right.latestFinishedAt) - Date.parse(left.latestFinishedAt),
        ),
    }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function groupDataReadinessBySymbol(items: DataReadinessItem[]) {
  const groups = new Map<
    string,
    {
      symbolCode: string;
      count: number;
      readyCount: number;
      timeframeCount: number;
      klineAverage: number;
      tradeAverage: number;
      totalRows: number;
      items: DataReadinessItem[];
    }
  >();

  for (const item of items) {
    const current =
      groups.get(item.symbolCode) ?? {
        symbolCode: item.symbolCode,
        count: 0,
        readyCount: 0,
        timeframeCount: 0,
        klineAverage: 0,
        tradeAverage: 0,
        totalRows: 0,
        items: [],
      };

    current.count += 1;
    current.readyCount += item.status === "ready" ? 1 : 0;
    current.klineAverage += Number(item.kline?.coveragePercent ?? 0);
    current.tradeAverage += Number(item.trades?.coveragePercent ?? 0);
    current.totalRows +=
      Number(item.kline?.rowCount ?? 0) + Number(item.trades?.rowCount ?? 0);
    current.items.push(item);
    groups.set(item.symbolCode, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      timeframeCount: new Set(group.items.map((item) => item.timeframeCode)).size,
      klineAverage: group.count > 0 ? group.klineAverage / group.count : 0,
      tradeAverage: group.count > 0 ? group.tradeAverage / group.count : 0,
      items: [...group.items].sort((left, right) =>
        left.timeframeCode.localeCompare(right.timeframeCode),
      ),
    }))
    .sort((left, right) => left.symbolCode.localeCompare(right.symbolCode));
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

function ProgressRing({
  value,
  color,
  size = 88,
  strokeWidth = 9,
}: {
  value: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const normalized = Math.max(0, Math.min(100, value));
  const dashOffset = circumference * (1 - normalized / 100);
  const labelValue = normalized >= 100 ? 100 : Math.floor(normalized);

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          origin={`${size / 2}, ${size / 2}`}
          rotation="-90"
        />
      </Svg>
      <Text
        style={{
          fontSize: size <= 64 ? 14 : 19,
          fontWeight: "800",
          color: "#101828",
        }}
      >
        {labelValue}%
      </Text>
    </View>
  );
}

function StatusBadge({
  label,
  value,
}: {
  label: string;
  value: boolean;
}) {
  return (
    <View
      style={{
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: value ? "#ecfdf3" : "#fef3f2",
      }}
    >
      <Text style={{ color: value ? "#157f3b" : "#b42318", fontWeight: "700" }}>
        {label}: {value ? "Yes" : "No"}
      </Text>
    </View>
  );
}

function DimensionSummary({
  label,
  dimension,
  compact = false,
}: {
  label: string;
  dimension: {
    rowCount?: number;
    missingCount?: number;
    coveragePercent?: number;
    complete?: boolean;
  } | null;
  compact?: boolean;
}) {
  const rawCoverage = dimension?.coveragePercent ?? 0;
  const isComplete = Boolean(dimension?.complete);
  const displayedCoverage = Math.max(0, Math.min(100, rawCoverage));
  const rowCount = (dimension?.rowCount ?? 0).toLocaleString();

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "#eaecf0",
        padding: compact ? 10 : 12,
        gap: compact ? 6 : 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <View style={{ flex: 1, minWidth: compact ? 100 : 180, gap: 4 }}>
          <Text style={{ fontWeight: "700", color: "#101828", fontSize: compact ? 13 : 14 }}>
            {label}
          </Text>
          <Text style={{ color: "#475467" }}>{rowCount}</Text>
        </View>
        <ProgressRing
          value={displayedCoverage}
          color={isComplete ? "#157f3b" : "#b54708"}
          size={compact ? 50 : 60}
          strokeWidth={compact ? 6 : 7}
        />
      </View>
    </View>
  );
}
