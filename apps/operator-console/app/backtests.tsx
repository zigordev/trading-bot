import { MaterialIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
import { MultiSelectFilter } from "@/src/components/multi-select-filter";
import { SymbolAvatar } from "@/src/components/symbol-avatar";
import { getBacktestsSummary, getConfigResourceRecords } from "@/src/lib/api";

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
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

export default function BacktestsScreen() {
  const [symbolFilter, setSymbolFilter] = useState<string[]>([]);
  const [timeframeFilter, setTimeframeFilter] = useState<string[]>([]);

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
                gap: 10,
                minWidth: "100%",
                paddingRight: 8,
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
            </ScrollView>
          </View>
        </View>

        <View style={{ gap: 16, paddingTop: 16 }}>
          {backtestsQuery.isLoading ? (
            <Text style={{ color: "#475467" }}>Loading latest backtests…</Text>
          ) : filteredRuns.length === 0 ? (
            <Text style={{ color: "#475467" }}>No latest backtests match the current filters.</Text>
          ) : (
            filteredRuns.map((run) => (
              <Card key={`${run.symbol}:${run.timeframeCode}`}>
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
                        baseAsset={symbolBaseAssets.get(run.symbol)}
                        destinationAsset={symbolDestinationAssets.get(run.symbol)}
                        size={34}
                      />
                      <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                        {run.symbol} / {run.timeframeCode}
                      </Text>
                    </View>
                    <Text style={{ color: "#475467" }}>{run.strategyName}</Text>
                    <Text style={{ color: "#475467" }}>
                      Finished: {new Date(run.finishedAt).toLocaleString()}
                    </Text>
                  </View>

                  <View
                    style={{
                      borderRadius: 16,
                      backgroundColor: run.totalPnlPercent >= 0 ? "#ecfdf3" : "#fef3f2",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      minWidth: 112,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: run.totalPnlPercent >= 0 ? "#157f3b" : "#b42318",
                        fontSize: 20,
                        fontWeight: "800",
                      }}
                    >
                      {run.totalPnlPercent.toFixed(2)}%
                    </Text>
                    <Text
                      style={{
                        color: run.totalPnlPercent >= 0 ? "#157f3b" : "#b42318",
                        fontWeight: "700",
                        marginTop: 2,
                      }}
                    >
                      PnL
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    marginTop: 14,
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  <MetricBadge
                    label="Duration"
                    value={formatDuration(run.backtestDurationMs)}
                  />
                  <MetricBadge label="Trades" value={run.tradeCount} />
                  <MetricBadge label="Signals" value={run.signalCount} />
                  <MetricBadge label="Klines" value={run.replayKlineCount} />
                  <MetricBadge label="Replay trades" value={run.replayTradeCount} />
                </View>
              </Card>
            ))
          )}
        </View>
      </View>
    </AppShell>
  );
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
