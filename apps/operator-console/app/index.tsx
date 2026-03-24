import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
import { getBacktestsSummary, getOverview } from "@/src/lib/api";

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
            <Text style={{ fontSize: 14, color: "#475467" }}>Queued backtests</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {overviewQuery.data?.queuedBacktests ?? "…"}
            </Text>
          </Card>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Running backtests</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {overviewQuery.data?.runningBacktests ?? "…"}
            </Text>
          </Card>
          <Card style={{ minWidth: 220, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Recent completed runs</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: "#101828" }}>
              {backtestsQuery.data?.recentRuns.length ?? "…"}
            </Text>
          </Card>
        </View>

        <Card>
          <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
            Services
          </Text>
          <View style={{ gap: 12, marginTop: 12 }}>
            {overviewQuery.data?.services.map((service) => (
              <View
                key={service.name}
                style={{
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#eaecf0",
                  padding: 14,
                  gap: 6,
                }}
              >
                <Text style={{ fontSize: 17, fontWeight: "600", color: "#101828" }}>
                  {service.name}
                </Text>
                <Text
                  style={{
                    color: statusTone[service.status],
                    fontWeight: "700",
                    textTransform: "uppercase",
                  }}
                >
                  {service.status}
                </Text>
                {service.details ? (
                  <Text style={{ color: "#475467" }}>{service.details}</Text>
                ) : null}
              </View>
            )) ?? (
              <Text style={{ color: "#475467" }}>Loading service overview…</Text>
            )}
          </View>
        </Card>
      </View>
    </AppShell>
  );
}
