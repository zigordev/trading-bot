import { MaterialIcons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

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

export default function BacktestingScreen() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<BacktestingSection>("data-readiness");
  const [symbolFilter, setSymbolFilter] = useState<string[]>([]);
  const [timeframeFilter, setTimeframeFilter] = useState<string[]>([]);
  const [expandedSymbols, setExpandedSymbols] = useState<string[]>([]);
  const [expandedReadinessSymbols, setExpandedReadinessSymbols] = useState<string[]>([]);

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
  const readinessGroups = groupDataReadinessBySymbol(filteredReadinessItems);

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
                                <View
                                  style={{
                                    borderRadius: 16,
                                    backgroundColor:
                                      group.bestPnlPercent >= 0 ? "#ecfdf3" : "#fef3f2",
                                    paddingHorizontal: 14,
                                    paddingVertical: 12,
                                    minWidth: 120,
                                    alignItems: "center",
                                  }}
                                >
                                  <Text
                                    style={{
                                      color: group.bestPnlPercent >= 0 ? "#157f3b" : "#b42318",
                                      fontSize: 20,
                                      fontWeight: "800",
                                    }}
                                  >
                                    {group.bestPnlPercent.toFixed(2)}%
                                  </Text>
                                  <Text
                                    style={{
                                      color: group.bestPnlPercent >= 0 ? "#157f3b" : "#b42318",
                                      fontWeight: "700",
                                      marginTop: 2,
                                    }}
                                  >
                                    Best PnL
                                  </Text>
                                </View>
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
                                <TableHeader label="PnL" flex={0.8} align="right" />
                                <TableHeader label="Duration" flex={0.9} align="right" />
                                <TableHeader label="Finished" flex={1.3} align="right" />
                              </View>
                              {group.runs.map((run, index) => (
                                <View
                                  key={`${run.backtestId}:${run.analysisSettingId}:${run.riskProfileName}`}
                                  style={{
                                    flexDirection: "row",
                                    paddingHorizontal: 14,
                                    paddingVertical: 12,
                                    gap: 12,
                                    borderTopWidth: index === 0 ? 0 : 1,
                                    borderTopColor: "#eaecf0",
                                    backgroundColor: index % 2 === 0 ? "#ffffff" : "#fcfcfd",
                                  }}
                                >
                                  <TableCell label={run.timeframeCode} flex={0.9} />
                                  <TableCell
                                    label={
                                      analysisDetailById.get(run.analysisSettingId) ??
                                      run.analysisSettingId
                                    }
                                    flex={2.2}
                                  />
                                  <TableCell label={run.riskProfileName} flex={1.1} />
                                  <TableCell
                                    label={`${run.totalPnlPercent.toFixed(2)}%`}
                                    flex={0.8}
                                    align="right"
                                    color={run.totalPnlPercent >= 0 ? "#157f3b" : "#b42318"}
                                    weight="700"
                                  />
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
}: {
  label: string;
  value: string | number;
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
        {label}: <Text style={{ color: "#101828" }}>{value}</Text>
      </Text>
    </View>
  );
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
      bestPnlPercent: number;
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
        bestPnlPercent: Number.NEGATIVE_INFINITY,
        latestFinishedAt: run.finishedAt,
        runs: [],
      };

    current.count += 1;
    current.bestPnlPercent = Math.max(current.bestPnlPercent, run.totalPnlPercent);
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
