import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
import { SymbolAvatar } from "@/src/components/symbol-avatar";
import { buildAnalysisDetailMap } from "@/src/lib/analysis-details";
import { configResources, type ConfigResourceKey } from "@/src/lib/configuration";
import {
  getBacktestsSummary,
  getConfigResourceRecords,
  getDataReadiness,
  getRuntimeAnalyses,
  saveConfigResource,
} from "@/src/lib/api";
import { subscribeOpsRealtimeEvent } from "@/src/lib/ops-events";

export default function OverviewScreen() {
  const queryClient = useQueryClient();
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
  const analysisSettingsQuery = useQuery({
    queryKey: ["config-resource", "analysis-settings"],
    queryFn: () => getConfigResourceRecords("analysis-settings"),
  });
  const strategiesQuery = useQuery({
    queryKey: ["config-resource", "strategies"],
    queryFn: () => getConfigResourceRecords("strategies"),
  });
  const runtimeAnalysesQuery = useQuery({
    queryKey: ["runtime-analyses"],
    queryFn: getRuntimeAnalyses,
  });
  const dataReadinessQuery = useQuery({
    queryKey: ["ops-data-readiness"],
    queryFn: getDataReadiness,
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

        void queryClient.invalidateQueries({
          queryKey: ["config-resource", event.payload.resource],
        });
        if (
          event.payload.resource === "symbols" ||
          event.payload.resource === "timeframes" ||
          event.payload.resource === "strategies" ||
          event.payload.resource === "risk-profiles" ||
          event.payload.resource === "analysis-settings"
        ) {
          void queryClient.invalidateQueries({ queryKey: ["runtime-analyses"] });
        }
      }),
    [queryClient],
  );
  const toggleMutation = useMutation({
    mutationFn: ({
      resource,
      id,
      payload,
    }: {
      resource: ConfigResourceKey;
      id: string;
      payload: Record<string, unknown>;
    }) => saveConfigResource(resource, payload, id),
    onSuccess: async () => {
      const resource = toggleMutation.variables?.resource;
      if (!resource) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["config-resource", resource] });
      if (
        resource === "symbols" ||
        resource === "timeframes" ||
        resource === "strategies" ||
        resource === "risk-profiles" ||
        resource === "analysis-settings"
      ) {
        await queryClient.invalidateQueries({ queryKey: ["runtime-analyses"] });
      }
    },
  });

  const activeSymbolCount = (symbolsQuery.data ?? []).filter((record) => Boolean(record.active)).length;
  const activeTimeframeCount = (timeframesQuery.data ?? []).filter((record) => Boolean(record.active)).length;
  const enabledRiskProfileCount = (riskProfilesQuery.data ?? []).filter((record) => Boolean(record.enabled)).length;
  const enabledAnalysisSettingsCount = (analysisSettingsQuery.data ?? []).filter((record) =>
    Boolean(record.enabled),
  ).length;
  const activeStrategyCount = (strategiesQuery.data ?? []).filter((record) =>
    Boolean(record.activated),
  ).length;
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
  const activeSymbols = [...(symbolsQuery.data ?? [])]
    .filter((record) => Boolean(record.active))
    .sort((left, right) => String(left.code ?? "").localeCompare(String(right.code ?? "")))
  const activeTimeframes = [...(timeframesQuery.data ?? [])]
    .filter((record) => Boolean(record.active))
    .sort((left, right) => Number(left.periodMs ?? 0) - Number(right.periodMs ?? 0))
  const activeStrategies = [...(strategiesQuery.data ?? [])]
    .filter((record) => Boolean(record.activated))
    .sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? "")))
  const activeRiskProfiles = [...(riskProfilesQuery.data ?? [])]
    .filter((record) => Boolean(record.enabled))
    .sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? "")))
  const activeAnalysisSettings = [...(analysisSettingsQuery.data ?? [])]
    .filter((record) => Boolean(record.enabled))
    .sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? "")))
  const readinessBySymbol = [...new Map(
    (dataReadinessQuery.data?.items ?? []).map((item) => [
      item.symbolCode,
      {
        symbolCode: item.symbolCode,
        complete: item.status === "ready",
      },
    ]),
  ).values()].sort((left, right) => left.symbolCode.localeCompare(right.symbolCode));

  const handleToggle = (
    resource: ConfigResourceKey,
    record: Record<string, unknown>,
    field: "active" | "activated" | "enabled",
  ) => {
    const id = String(record.id ?? "");
    if (!id) {
      return;
    }

    toggleMutation.mutate({
      resource,
      id,
      payload: buildEditablePayload(
        configResources[resource].fields,
        record,
        field,
        !Boolean(record[field]),
      ),
    });
  };

  return (
    <AppShell>
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active analyses</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {analysisSettingsQuery.isLoading ? "…" : enabledAnalysisSettingsCount.toLocaleString()}
            </Text>
            <OverviewList>
              {activeAnalysisSettings.map((record) => (
                <OverviewListRow
                  key={String(record.id)}
                  title={String(record.name ?? "n/a")}
                  subtitle={String(record.strategyName ?? "n/a")}
                  trailing={
                    <OverviewToggle
                      value={Boolean(record.enabled)}
                      pending={
                        toggleMutation.isPending &&
                        toggleMutation.variables?.resource === "analysis-settings" &&
                        toggleMutation.variables?.id === String(record.id)
                      }
                      onPress={() => handleToggle("analysis-settings", record, "enabled")}
                    />
                  }
                />
              ))}
            </OverviewList>
          </Card>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active strategies</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {strategiesQuery.isLoading ? "…" : activeStrategyCount.toLocaleString()}
            </Text>
            <OverviewList>
              {activeStrategies.map((record) => (
                <OverviewListRow
                  key={String(record.id)}
                  title={String(record.name ?? "n/a")}
                  subtitle={String(record.description ?? "")}
                  trailing={
                    <OverviewToggle
                      value={Boolean(record.activated)}
                      pending={
                        toggleMutation.isPending &&
                        toggleMutation.variables?.resource === "strategies" &&
                        toggleMutation.variables?.id === String(record.id)
                      }
                      onPress={() => handleToggle("strategies", record, "activated")}
                    />
                  }
                />
              ))}
            </OverviewList>
          </Card>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active symbols</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {symbolsQuery.isLoading ? "…" : activeSymbolCount.toLocaleString()}
            </Text>
            <OverviewList>
              {activeSymbols.map((record) => (
                <OverviewListRow
                  key={String(record.id)}
                  avatar={
                    <SymbolAvatar
                      baseAsset={String(record.baseAsset ?? "")}
                      destinationAsset={String(record.destinationAsset ?? "")}
                      size={28}
                    />
                  }
                  title={String(record.code ?? "n/a")}
                  subtitle={`${String(record.baseAsset ?? "")}/${String(record.destinationAsset ?? "")}`}
                  trailing={
                    <OverviewToggle
                      value={Boolean(record.active)}
                      pending={
                        toggleMutation.isPending &&
                        toggleMutation.variables?.resource === "symbols" &&
                        toggleMutation.variables?.id === String(record.id)
                      }
                      onPress={() => handleToggle("symbols", record, "active")}
                    />
                  }
                />
              ))}
            </OverviewList>
          </Card>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active timeframes</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {timeframesQuery.isLoading ? "…" : activeTimeframeCount.toLocaleString()}
            </Text>
            <OverviewList>
              {activeTimeframes.map((record) => (
                <OverviewListRow
                  key={String(record.id)}
                  title={String(record.code ?? "n/a")}
                  subtitle={`${Number(record.periodMs ?? 0).toLocaleString()} ms`}
                  trailing={
                    <OverviewToggle
                      value={Boolean(record.active)}
                      pending={
                        toggleMutation.isPending &&
                        toggleMutation.variables?.resource === "timeframes" &&
                        toggleMutation.variables?.id === String(record.id)
                      }
                      onPress={() => handleToggle("timeframes", record, "active")}
                    />
                  }
                />
              ))}
            </OverviewList>
          </Card>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active risk profiles</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {riskProfilesQuery.isLoading ? "…" : enabledRiskProfileCount.toLocaleString()}
            </Text>
            <OverviewList>
              {activeRiskProfiles.map((record) => (
                <OverviewListRow
                  key={String(record.id)}
                  title={String(record.name ?? "n/a")}
                  subtitle={`RRR ${String(record.rrr ?? "n/a")}`}
                  trailing={
                    <OverviewToggle
                      value={Boolean(record.enabled)}
                      pending={
                        toggleMutation.isPending &&
                        toggleMutation.variables?.resource === "risk-profiles" &&
                        toggleMutation.variables?.id === String(record.id)
                      }
                      onPress={() => handleToggle("risk-profiles", record, "enabled")}
                    />
                  }
                />
              ))}
            </OverviewList>
          </Card>
        </View>

        <Card>
          <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
            Data status
          </Text>
          <View style={{ gap: 12, marginTop: 12 }}>
            {dataReadinessQuery.isLoading ? (
              <Text style={{ color: "#475467" }}>Loading data status…</Text>
            ) : readinessBySymbol.length === 0 ? (
              <Text style={{ color: "#475467" }}>No data status available yet.</Text>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {readinessBySymbol.map((item) => (
                  <Card key={item.symbolCode} style={{ minWidth: 220, flex: 1 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <SymbolAvatar
                          baseAsset={symbolBaseAssets.get(item.symbolCode)}
                          destinationAsset={symbolDestinationAssets.get(item.symbolCode)}
                          size={30}
                        />
                        <Text style={{ color: "#101828", fontWeight: "700" }}>
                          {item.symbolCode}
                        </Text>
                      </View>
                      <View
                        style={{
                          borderRadius: 999,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          backgroundColor: item.complete ? "#ecfdf3" : "#fef3f2",
                        }}
                      >
                        <Text
                          style={{
                            color: item.complete ? "#027a48" : "#b42318",
                            fontWeight: "800",
                          }}
                        >
                          {item.complete ? "Complete" : "Incomplete"}
                        </Text>
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            )}
          </View>
        </Card>

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

function buildEditablePayload(
  fields: Array<{ name: string }>,
  record: Record<string, unknown>,
  field: string,
  nextValue: boolean,
): Record<string, unknown> {
  const payload = fields.reduce<Record<string, unknown>>((accumulator, currentField) => {
    accumulator[currentField.name] = record[currentField.name];
    return accumulator;
  }, {});

  payload[field] = nextValue;
  return payload;
}

function OverviewList({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={{ marginTop: 12, height: 144, flexGrow: 0 }}
      contentContainerStyle={{ gap: 10, paddingRight: 4 }}
      nestedScrollEnabled
      showsVerticalScrollIndicator
    >
      {children}
    </ScrollView>
  );
}

function OverviewListRow({
  avatar,
  title,
  subtitle,
  trailing,
}: {
  avatar?: React.ReactNode;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
        {avatar ?? null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: "#101828", fontWeight: "700" }}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={{ color: "#475467", fontSize: 12 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {trailing ?? null}
    </View>
  );
}

function OverviewToggle({
  value,
  pending,
  onPress,
}: {
  value: boolean;
  pending?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: pending }}
      style={{
        width: 42,
        height: 24,
        borderRadius: 999,
        padding: 3,
        justifyContent: "center",
        backgroundColor: value ? "#12b76a" : "#d0d5dd",
        opacity: pending ? 0.6 : 1,
      }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          backgroundColor: "#ffffff",
          alignSelf: value ? "flex-end" : "flex-start",
        }}
      />
    </Pressable>
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
