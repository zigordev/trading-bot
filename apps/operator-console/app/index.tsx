import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
import { SymbolAvatar } from "@/src/components/symbol-avatar";
import { buildAnalysisDetailMap } from "@/src/lib/analysis-details";
import {
  getBacktestsSummary,
  getConfigResourceRecords,
  getOverview,
  getRuntimeAnalyses,
} from "@/src/lib/api";

const statusTone = {
  up: "#157f3b",
  down: "#b42318",
  unknown: "#b54708",
} as const;

export default function OverviewScreen() {
  const overviewQuery = useQuery({
    queryKey: ["ops-overview"],
    queryFn: getOverview,
  });
  const backtestsQuery = useQuery({
    queryKey: ["ops-backtests-summary"],
    queryFn: getBacktestsSummary,
  });
  const symbolsQuery = useQuery({
    queryKey: ["config-resource", "symbols"],
    queryFn: () => getConfigResourceRecords("symbols"),
  });
  const timeframesQuery = useQuery({
    queryKey: ["config-resource", "timeframes"],
    queryFn: () => getConfigResourceRecords("timeframes"),
  });
  const riskProfilesQuery = useQuery({
    queryKey: ["config-resource", "risk-profiles"],
    queryFn: () => getConfigResourceRecords("risk-profiles"),
  });
  const runtimeAnalysesQuery = useQuery({
    queryKey: ["runtime-analyses"],
    queryFn: getRuntimeAnalyses,
  });

  const activeSymbolCount = (symbolsQuery.data ?? []).filter((record) => Boolean(record.active)).length;
  const activeTimeframeCount = (timeframesQuery.data ?? []).filter((record) => Boolean(record.active)).length;
  const enabledRiskProfileCount = (riskProfilesQuery.data ?? []).filter((record) => Boolean(record.enabled)).length;
  const topBacktests = [...(backtestsQuery.data?.recentRuns ?? [])]
    .sort((left, right) => right.totalPnlPercent - left.totalPnlPercent)
    .slice(0, 10);
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

  return (
    <AppShell>
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active analyses</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {overviewQuery.data?.activeAnalysisCount ?? "…"}
            </Text>
          </Card>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active symbols</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {symbolsQuery.isLoading ? "…" : activeSymbolCount.toLocaleString()}
            </Text>
          </Card>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active timeframes</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {timeframesQuery.isLoading ? "…" : activeTimeframeCount.toLocaleString()}
            </Text>
          </Card>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active risk profiles</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {riskProfilesQuery.isLoading ? "…" : enabledRiskProfileCount.toLocaleString()}
            </Text>
          </Card>
        </View>

        <Card>
          <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
            Top 10 Backtests
          </Text>
          <View style={{ gap: 12, marginTop: 12 }}>
            {backtestsQuery.isLoading ? (
              <Text style={{ color: "#475467" }}>Loading backtest ranking…</Text>
            ) : topBacktests.length === 0 ? (
              <Text style={{ color: "#475467" }}>No completed backtests available yet.</Text>
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
                  <OverviewHeader label="#" flex={0.45} />
                  <OverviewHeader label="Symbol" flex={1.35} />
                  <OverviewHeader label="Analysis" flex={2.3} />
                  <OverviewHeader label="PnL" flex={0.8} align="right" />
                  <OverviewHeader label="Finished" flex={1.4} align="right" />
                </View>
                {topBacktests.map((run, index) => (
                  <View
                    key={`${run.backtestId}:${index}`}
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
                    <OverviewCell label={`#${index + 1}`} flex={0.45} color="#475467" weight="700" />
                    <View style={{ flex: 1.35, flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <SymbolAvatar
                        baseAsset={symbolBaseAssets.get(run.symbol)}
                        destinationAsset={symbolDestinationAssets.get(run.symbol)}
                        size={28}
                      />
                      <Text style={{ color: "#101828", fontWeight: "700" }}>
                        {run.symbol} / {run.timeframeCode}
                      </Text>
                    </View>
                    <OverviewCell
                      label={analysisDetailById.get(run.analysisSettingId) ?? run.analysisSettingId}
                      flex={2.3}
                    />
                    <OverviewCell
                      label={`${run.totalPnlPercent.toFixed(2)}%`}
                      flex={0.8}
                      align="right"
                      color={run.totalPnlPercent >= 0 ? "#157f3b" : "#b42318"}
                      weight="700"
                    />
                    <OverviewCell
                      label={new Date(run.finishedAt).toLocaleString()}
                      flex={1.4}
                      align="right"
                    />
                  </View>
                ))}
              </View>
            )}
          </View>
        </Card>
      </View>
    </AppShell>
  );
}

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

function OverviewHeader({
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

function OverviewCell({
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
