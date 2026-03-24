import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Svg, { Circle } from "react-native-svg";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
import { MultiSelectFilter } from "@/src/components/multi-select-filter";
import { SymbolAvatar } from "@/src/components/symbol-avatar";
import { getConfigResourceRecords, getDataReadiness } from "@/src/lib/api";

export default function DataReadinessScreen() {
  const [symbolFilter, setSymbolFilter] = useState<string[]>([]);
  const [timeframeFilter, setTimeframeFilter] = useState<string[]>([]);

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

  const symbolState = new Map(
    (symbolsQuery.data ?? []).map((record) => [String(record.code ?? ""), Boolean(record.active)]),
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
  const timeframeState = new Map(
    (timeframesQuery.data ?? []).map((record) => [
      String(record.code ?? ""),
      Boolean(record.active),
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

  const filteredItems =
    readinessQuery.data?.items.filter((item) => {
      if (symbolFilter.length > 0 && !symbolFilter.includes(item.symbolCode)) {
        return false;
      }
      if (timeframeFilter.length > 0 && !timeframeFilter.includes(item.timeframeCode)) {
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
          {readinessQuery.isLoading ? (
            <Text style={{ color: "#475467" }}>Loading readiness data…</Text>
          ) : filteredItems.length === 0 ? (
            <Text style={{ color: "#475467" }}>No readiness rows match the current filters.</Text>
          ) : (
            filteredItems.map((item) => (
              <Card key={`${item.symbolCode}:${item.timeframeCode}`}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "flex-start",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <SymbolAvatar
                    baseAsset={symbolBaseAssets.get(item.symbolCode)}
                    destinationAsset={symbolDestinationAssets.get(item.symbolCode)}
                    size={36}
                  />
                  <View style={{ flex: 1, minWidth: 220 }}>
                    <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                      {item.symbolCode} / {item.timeframeCode}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      <StatusBadge
                        label="Active"
                        value={
                          (symbolState.get(item.symbolCode) ?? false) &&
                          (timeframeState.get(item.timeframeCode) ?? false)
                        }
                      />
                    </View>
                  </View>
                </View>
                <View style={{ gap: 10, marginTop: 14 }}>
                  <DimensionSummary label="Klines" dimension={item.kline} />
                  <DimensionSummary label="Trades" dimension={item.trades} />
                  <DimensionSummary label="Book tickers" dimension={item.bookTickers} />
                </View>
              </Card>
            ))
          )}
        </View>
      </View>
    </AppShell>
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
        {Math.round(normalized)}%
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
}: {
  label: string;
  dimension: {
    rowCount?: number;
    gapCount?: number;
    coveragePercent?: number;
    complete?: boolean;
  } | null;
}) {
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "#eaecf0",
        padding: 12,
        gap: 8,
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
        <View style={{ flex: 1, minWidth: 180, gap: 4 }}>
          <Text style={{ fontWeight: "700", color: "#101828" }}>{label}</Text>
          <Text style={{ color: "#475467" }}>
            Rows: {dimension?.rowCount ?? 0} | Gaps: {dimension?.gapCount ?? 0}
          </Text>
        </View>
        <ProgressRing
          value={dimension?.coveragePercent ?? 0}
          color={dimension?.complete ? "#157f3b" : "#b54708"}
          size={60}
          strokeWidth={7}
        />
      </View>
      <Text style={{ color: dimension?.complete ? "#157f3b" : "#b54708" }}>
        {dimension?.complete ? "Complete for requested window" : "Incomplete for requested window"}
      </Text>
    </View>
  );
}
