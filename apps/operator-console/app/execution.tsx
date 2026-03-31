import { MaterialIcons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
import { MultiSelectFilter } from "@/src/components/multi-select-filter";
import { SymbolAvatar } from "@/src/components/symbol-avatar";
import {
  getBacktestsSummary,
  type ExecutionSettingsRecord,
  getConfigResourceRecords,
  getExecutionSummary,
  getExecutionTrades,
} from "@/src/lib/api";
import { subscribeOpsRealtimeEvent } from "@/src/lib/ops-events";

const PAGE_SIZE = 10;

const formatMoney = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : `$${value.toFixed(2)}`;

const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : `${value.toFixed(2)}%`;

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString();
};

const sortOptions = {
  openedAt: "Opened",
  closedAt: "Closed",
  realizedPnlPercent: "PnL %",
  symbolCode: "Symbol",
  notionalUsd: "Notional",
} as const;

type SortKey = keyof typeof sortOptions;

const formatDuration = (durationMs: number): string => {
  const safeDurationMs = Math.max(0, durationMs);
  if (safeDurationMs < 1000) {
    return `${safeDurationMs}ms`;
  }

  const totalSeconds = Math.floor(safeDurationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${hours}h ${remainingMinutes}m`;
};

const deriveAssetsFromSymbolCode = (
  code: string,
): { baseAsset: string; destinationAsset: string } | null => {
  const normalized = code.trim().toUpperCase();
  const knownQuoteAssets = [
    "USDT",
    "FDUSD",
    "USDC",
    "BUSD",
    "TUSD",
    "DAI",
    "BTC",
    "ETH",
    "BNB",
    "EUR",
    "GBP",
    "AUD",
    "BRL",
    "TRY",
  ];

  for (const quoteAsset of knownQuoteAssets) {
    if (normalized.endsWith(quoteAsset) && normalized.length > quoteAsset.length) {
      return {
        baseAsset: normalized.slice(0, -quoteAsset.length),
        destinationAsset: quoteAsset,
      };
    }
  }

  return null;
};

export default function ExecutionScreen() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [symbolCode, setSymbolCode] = useState<string>("");
  const [timeframeCode, setTimeframeCode] = useState<string>("");
  const [strategyName, setStrategyName] = useState<string>("");
  const [status, setStatus] = useState<"" | "open" | "closed" | "cancelled" | "rejected">("");
  const [side, setSide] = useState<"" | "long" | "short">("");
  const [mode, setMode] = useState<"" | "paper" | "live">("");
  const [sortBy, setSortBy] = useState<SortKey>("openedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedBacktestId, setSelectedBacktestId] = useState<string | null>(null);
  const [selectedAnalysisSettingId, setSelectedAnalysisSettingId] = useState<string | null>(null);
  const [selectedRiskProfileName, setSelectedRiskProfileName] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeOpsRealtimeEvent((event) => {
        if (event.type === "ops.execution.updated") {
          void queryClient.invalidateQueries({ queryKey: ["ops-execution-summary"] });
          void queryClient.invalidateQueries({ queryKey: ["ops-execution-trades"] });
          return;
        }

        if (
          event.type === "config.resource.updated" &&
          event.payload.resource === "execution-settings"
        ) {
          void queryClient.invalidateQueries({
            queryKey: ["config-resource", "execution-settings"],
          });
        }
      }),
    [queryClient],
  );

  const executionSummaryQuery = useQuery({
    queryKey: ["ops-execution-summary"],
    queryFn: getExecutionSummary,
  });

  const executionSettingsQuery = useQuery({
    queryKey: ["config-resource", "execution-settings"],
    queryFn: () =>
      getConfigResourceRecords("execution-settings") as Promise<ExecutionSettingsRecord[]>,
  });
  const symbolsQuery = useQuery({
    queryKey: ["config-resource", "symbols"],
    queryFn: () => getConfigResourceRecords("symbols"),
  });
  const analysisSettingsQuery = useQuery({
    queryKey: ["config-resource", "analysis-settings"],
    queryFn: () => getConfigResourceRecords("analysis-settings"),
  });
  const riskProfilesQuery = useQuery({
    queryKey: ["config-resource", "risk-profiles"],
    queryFn: () => getConfigResourceRecords("risk-profiles"),
  });
  const backtestsSummaryQuery = useQuery({
    queryKey: ["ops-backtests-summary"],
    queryFn: getBacktestsSummary,
  });

  const executionTradesQuery = useQuery({
    queryKey: [
      "ops-execution-trades",
      page,
      search,
      symbolCode,
      timeframeCode,
      strategyName,
      status,
      side,
      mode,
      sortBy,
      sortDirection,
    ],
    queryFn: () =>
      getExecutionTrades({
        page,
        pageSize: PAGE_SIZE,
        search: search.trim() || undefined,
        symbolCode: symbolCode || undefined,
        timeframeCode: timeframeCode || undefined,
        strategyName: strategyName || undefined,
        status: status || undefined,
        side: side || undefined,
        mode: mode || undefined,
        sortBy,
        sortDirection,
      }),
  });

  const trades = executionTradesQuery.data?.items ?? [];
  const totalCount = executionTradesQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const selectedBacktestRun = useMemo(() => {
    if (!selectedBacktestId) {
      return null;
    }

    const runs = [
      ...(backtestsSummaryQuery.data?.latestRuns ?? []),
      ...(backtestsSummaryQuery.data?.recentRuns ?? []),
    ];

    return runs.find((run) => run.backtestId === selectedBacktestId) ?? null;
  }, [backtestsSummaryQuery.data?.latestRuns, backtestsSummaryQuery.data?.recentRuns, selectedBacktestId]);
  const symbolBaseAssets = useMemo(
    () =>
      new Map(
        (symbolsQuery.data ?? []).map((record) => [
          String(record.code ?? ""),
          String(record.baseAsset ?? ""),
        ]),
      ),
    [symbolsQuery.data],
  );
  const symbolDestinationAssets = useMemo(
    () =>
      new Map(
        (symbolsQuery.data ?? []).map((record) => [
          String(record.code ?? ""),
          String(record.destinationAsset ?? ""),
        ]),
      ),
    [symbolsQuery.data],
  );
  const analysisSettingsById = useMemo(
    () =>
      new Map(
        (analysisSettingsQuery.data ?? []).map((record) => [String(record.id ?? ""), record]),
      ),
    [analysisSettingsQuery.data],
  );
  const riskProfilesByName = useMemo(
    () =>
      new Map(
        (riskProfilesQuery.data ?? []).map((record) => [String(record.name ?? ""), record]),
      ),
    [riskProfilesQuery.data],
  );
  const selectedAnalysisSettingRecord =
    selectedAnalysisSettingId === null
      ? null
      : (analysisSettingsById.get(selectedAnalysisSettingId) ?? null);
  const selectedRiskProfileRecord =
    selectedRiskProfileName === null ? null : (riskProfilesByName.get(selectedRiskProfileName) ?? null);

  const filterOptions = useMemo(() => {
    const summaryTrades = executionSummaryQuery.data?.recentTrades ?? [];
    const enabledSettings = executionSettingsQuery.data?.filter((item) => item.enabled) ?? [];

    return {
      symbols: Array.from(
        new Set([
          ...summaryTrades.map((item) => item.symbolCode),
        ]),
      ).sort(),
      timeframes: Array.from(
        new Set([
          ...summaryTrades.map((item) => item.timeframeCode),
        ]),
      ).sort(),
      strategies: Array.from(
        new Set(summaryTrades.map((item) => item.strategyName)),
      ).sort(),
    };
  }, [executionSettingsQuery.data, executionSummaryQuery.data?.recentTrades]);

  const resetFilters = () => {
    setPage(1);
    setSearch("");
    setSymbolCode("");
    setTimeframeCode("");
    setStrategyName("");
    setStatus("");
    setSide("");
    setMode("");
    setSortBy("openedAt");
    setSortDirection("desc");
  };

  return (
    <AppShell>
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          <Card style={{ minWidth: 260, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Active promotions</Text>
            <Text style={{ fontSize: 24, fontWeight: "700", color: "#101828" }}>
              {executionSummaryQuery.data?.activePromotions?.length
                ? `${executionSummaryQuery.data.activePromotions.length} active promotion${executionSummaryQuery.data.activePromotions.length === 1 ? "" : "s"}`
                : "No promoted config"}
            </Text>
            <Text style={{ color: "#475467" }}>
              {executionSummaryQuery.data?.activePromotions?.length
                ? "Strategies promoted for execution across the current ranking window."
                : "Execution can be configured before the live service is wired in."}
            </Text>
          </Card>

          <Card style={{ minWidth: 180, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Open trades</Text>
            <Text style={{ fontSize: 30, fontWeight: "700", color: "#101828" }}>
              {(executionSummaryQuery.data?.totals.openTradeCount ?? 0).toLocaleString()}
            </Text>
          </Card>

          <Card style={{ minWidth: 180, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Recent closed</Text>
            <Text style={{ fontSize: 30, fontWeight: "700", color: "#101828" }}>
              {(executionSummaryQuery.data?.totals.closedTradeCount ?? 0).toLocaleString()}
            </Text>
          </Card>

          <Card style={{ minWidth: 200, flex: 1 }}>
            <Text style={{ fontSize: 14, color: "#475467" }}>Realized PnL</Text>
            <Text style={{ fontSize: 30, fontWeight: "700", color: "#101828" }}>
              {formatMoney(executionSummaryQuery.data?.totals.realizedPnlUsd)}
            </Text>
          </Card>
        </View>

        {executionSummaryQuery.data?.activePromotions?.length ? (
          <Card>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                Promoted strategies
              </Text>
              <Text style={{ color: "#475467" }}>
                Current active promotion set ranked by total PnL %.
              </Text>
            </View>
            <View style={{ marginTop: 12, gap: 0 }}>
              <View
                style={{
                  flexDirection: "row",
                  borderWidth: 1,
                  borderBottomWidth: 0,
                  borderColor: "#eaecf0",
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                  backgroundColor: "#f8fafc",
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <Text style={{ flex: 1.3, color: "#475467", fontWeight: "700", fontSize: 12 }}>
                  Strategy
                </Text>
                <Text style={{ flex: 1.2, color: "#475467", fontWeight: "700", fontSize: 12 }}>
                  Market
                </Text>
                <Text style={{ flex: 1.5, color: "#475467", fontWeight: "700", fontSize: 12 }}>
                  Analysis
                </Text>
                <Text style={{ flex: 1.1, color: "#475467", fontWeight: "700", fontSize: 12 }}>
                  Risk
                </Text>
                <Text style={{ flex: 1.6, color: "#475467", fontWeight: "700", fontSize: 12 }}>
                  Backtest
                </Text>
                <Text
                  style={{
                    flex: 0.8,
                    color: "#475467",
                    fontWeight: "700",
                    fontSize: 12,
                    textAlign: "right",
                  }}
                >
                    PnL %
                  </Text>
                </View>
                {executionSummaryQuery.data.activePromotions.map((promotion, index, items) => (
                <View
                  key={promotion.promotionId}
                  style={{
                    flexDirection: "row",
                    borderWidth: 1,
                    borderTopWidth: 0,
                    borderColor: "#eaecf0",
                    borderBottomLeftRadius: index === items.length - 1 ? 12 : 0,
                    borderBottomRightRadius: index === items.length - 1 ? 12 : 0,
                    backgroundColor: "#ffffff",
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                >
                  <View style={{ flex: 1.3, paddingRight: 8 }}>
                    <Text style={{ color: "#101828", fontWeight: "700" }}>
                      {promotion.strategyName}
                    </Text>
                    <Text style={{ color: "#475467", fontSize: 12 }}>{promotion.mode}</Text>
                  </View>
                  <View style={{ flex: 1.2, paddingRight: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <SymbolAvatar
                        baseAsset={
                          symbolBaseAssets.get(promotion.symbolCode) ??
                          deriveAssetsFromSymbolCode(promotion.symbolCode)?.baseAsset
                        }
                        destinationAsset={
                          symbolDestinationAssets.get(promotion.symbolCode) ??
                          deriveAssetsFromSymbolCode(promotion.symbolCode)?.destinationAsset
                        }
                        size={24}
                      />
                      <Text style={{ color: "#101828", fontWeight: "600" }}>
                        {promotion.symbolCode}
                      </Text>
                    </View>
                    <Text style={{ color: "#475467", fontSize: 12 }}>
                      {promotion.timeframeCode}
                    </Text>
                  </View>
                  <View style={{ flex: 1.5, paddingRight: 8 }}>
                    <Text
                      onPress={() => setSelectedAnalysisSettingId(promotion.analysisSettingId)}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      style={{ color: "#1d4ed8", fontSize: 12, fontWeight: "700" }}
                    >
                      {promotion.analysisSettingId}
                    </Text>
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={{ color: "#475467", fontSize: 12 }}
                    >
                      {String(
                        analysisSettingsById.get(promotion.analysisSettingId)?.name ?? "Open details",
                      )}
                    </Text>
                  </View>
                  <View style={{ flex: 1.1, paddingRight: 8 }}>
                    <Text
                      onPress={() => setSelectedRiskProfileName(promotion.riskProfileName)}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={{ color: "#1d4ed8", fontSize: 12, fontWeight: "700" }}
                    >
                      {promotion.riskProfileName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      style={{ color: "#475467", fontSize: 12 }}
                    >
                      {String(riskProfilesByName.get(promotion.riskProfileName)?.id ?? "Open details")}
                    </Text>
                  </View>
                  <View style={{ flex: 1.6, paddingRight: 8 }}>
                    <Text
                      style={{ color: "#344054", fontSize: 12 }}
                    >
                      {promotion.sourceBacktestId ? (
                        <Text
                          onPress={() => setSelectedBacktestId(promotion.sourceBacktestId)}
                          style={{ color: "#1d4ed8", fontWeight: "700" }}
                        >
                          {promotion.sourceBacktestId}
                        </Text>
                      ) : (
                        "n/a"
                      )}
                    </Text>
                    <Text style={{ color: "#475467", fontSize: 12 }}>
                      Open details
                    </Text>
                  </View>
                  <Text
                    style={{
                      flex: 0.8,
                      color: "#101828",
                      fontWeight: "700",
                      textAlign: "right",
                    }}
                  >
                    {promotion.selectionValue.toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <Card>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                Execution trades
              </Text>
              <Text style={{ color: "#475467" }}>
                Persisted execution ledger for operator review, filtering, and audit.
              </Text>
            </View>
            <Pressable
              onPress={resetFilters}
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#d0d5dd",
                paddingHorizontal: 14,
                paddingVertical: 10,
              }}
            >
              <Text style={{ color: "#344054", fontWeight: "700" }}>Reset</Text>
            </Pressable>
          </View>

          <View style={{ gap: 10, marginTop: 10 }}>
            <TextInput
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search trade id, backtest id, order id, analysis id"
              placeholderTextColor="#98a2b3"
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#d0d5dd",
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: "#101828",
                backgroundColor: "#ffffff",
              }}
            />

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <SingleSelectFilter
                label="Symbol"
                value={symbolCode}
                options={filterOptions.symbols}
                allLabel="All symbols"
                renderOptionAdornment={(option) => (
                  <SymbolAvatar
                    baseAsset={symbolBaseAssets.get(option)}
                    destinationAsset={symbolDestinationAssets.get(option)}
                    size={22}
                  />
                )}
                onChange={(value) => {
                  setSymbolCode(value);
                  setPage(1);
                }}
              />
              <SingleSelectFilter
                label="Timeframe"
                value={timeframeCode}
                options={filterOptions.timeframes}
                allLabel="All timeframes"
                onChange={(value) => {
                  setTimeframeCode(value);
                  setPage(1);
                }}
              />
              <SingleSelectFilter
                label="Strategy"
                value={strategyName}
                options={filterOptions.strategies}
                allLabel="All strategies"
                onChange={(value) => {
                  setStrategyName(value);
                  setPage(1);
                }}
              />
              <SingleSelectFilter
                label="Status"
                value={status}
                options={["open", "closed", "cancelled", "rejected"]}
                allLabel="All statuses"
                onChange={(value) => {
                  setStatus(value as typeof status);
                  setPage(1);
                }}
              />
              <SingleSelectFilter
                label="Side"
                value={side}
                options={["long", "short"]}
                allLabel="All sides"
                onChange={(value) => {
                  setSide(value as typeof side);
                  setPage(1);
                }}
              />
              <SingleSelectFilter
                label="Mode"
                value={mode}
                options={["paper", "live"]}
                allLabel="All modes"
                onChange={(value) => {
                  setMode(value as typeof mode);
                  setPage(1);
                }}
              />
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: "100%" }}>
            <View style={{ width: "100%", minWidth: "100%", gap: 0, marginTop: 16 }}>
              <ExecutionTableHeader
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={(nextSortBy) => {
                  setPage(1);
                  if (sortBy === nextSortBy) {
                    setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
                    return;
                  }
                  setSortBy(nextSortBy);
                  setSortDirection("desc");
                }}
              />
              {trades.map((trade) => (
                <ExecutionTableRow
                  key={trade.tradeId}
                  trade={trade}
                  baseAsset={
                    symbolBaseAssets.get(trade.symbolCode) ??
                    deriveAssetsFromSymbolCode(trade.symbolCode)?.baseAsset
                  }
                  destinationAsset={
                    symbolDestinationAssets.get(trade.symbolCode) ??
                    deriveAssetsFromSymbolCode(trade.symbolCode)?.destinationAsset
                  }
                />
              ))}
              {trades.length === 0 ? (
                <View
                  style={{
                    paddingVertical: 28,
                    paddingHorizontal: 18,
                    borderWidth: 1,
                    borderTopWidth: 0,
                    borderColor: "#eaecf0",
                    borderBottomLeftRadius: 18,
                    borderBottomRightRadius: 18,
                    backgroundColor: "#fcfcfd",
                  }}
                >
                  <Text style={{ color: "#475467" }}>
                    No execution trades match the current filters. Once the execution service starts
                    emitting trade events, they will appear here.
                  </Text>
                </View>
              ) : null}
            </View>
          </ScrollView>

          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 14,
            }}
          >
            <Text style={{ color: "#475467" }}>
              Page {page} of {totalPages} · {totalCount.toLocaleString()} trades
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <PaginationButton
                label="Previous"
                disabled={page <= 1}
                onPress={() => setPage((current) => Math.max(1, current - 1))}
              />
              <PaginationButton
                label="Next"
                disabled={page >= totalPages}
                onPress={() => setPage((current) => Math.min(totalPages, current + 1))}
              />
            </View>
          </View>
        </Card>
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
                    <DetailRow label="Analysis setting id" value={selectedBacktestRun.analysisSettingId} />
                    <DetailRow label="Risk profile" value={selectedBacktestRun.riskProfileName} />
                    <DetailRow
                      label="Finished"
                      value={new Date(selectedBacktestRun.finishedAt).toLocaleString()}
                    />
                    <DetailRow
                      label="PnL %"
                      value={`${selectedBacktestRun.totalPnlPercent.toFixed(2)}%`}
                    />
                    <DetailRow
                      label="Backtest duration"
                      value={formatDuration(selectedBacktestRun.backtestDurationMs)}
                    />
                    <DetailRow
                      label="Data retrieval"
                      value={formatDuration(selectedBacktestRun.dataRetrievalDurationMs)}
                    />
                    <DetailRow
                      label="Replay counts"
                      value={`${selectedBacktestRun.replayKlineCount} klines · ${selectedBacktestRun.replayTradeCount} trades`}
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
        visible={selectedAnalysisSettingId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedAnalysisSettingId(null)}
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
              <ModalHeader title="Analysis setting details" onClose={() => setSelectedAnalysisSettingId(null)} />
              <View style={{ gap: 10, marginTop: 12 }}>
                <DetailRow label="Analysis setting id" value={selectedAnalysisSettingId ?? "n/a"} />
                {selectedAnalysisSettingRecord ? (
                  <>
                    <DetailRow label="Name" value={String(selectedAnalysisSettingRecord.name ?? "n/a")} />
                    <DetailRow label="Strategy name" value={String(selectedAnalysisSettingRecord.strategyName ?? "n/a")} />
                    <DetailRow
                      label="Technical analysis settings"
                      value={JSON.stringify(
                        selectedAnalysisSettingRecord.technicalAnalysisSettings ?? {},
                        null,
                        2,
                      )}
                      monospace
                    />
                  </>
                ) : (
                  <Text style={{ color: "#475467" }}>
                    This analysis setting was not found in the current configuration payload.
                  </Text>
                )}
              </View>
            </Card>
          </View>
        </View>
      </Modal>
      <Modal
        visible={selectedRiskProfileName !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedRiskProfileName(null)}
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
              <ModalHeader title="Risk profile details" onClose={() => setSelectedRiskProfileName(null)} />
              <View style={{ gap: 10, marginTop: 12 }}>
                <DetailRow label="Risk profile" value={selectedRiskProfileName ?? "n/a"} />
                {selectedRiskProfileRecord ? (
                  <>
                    <DetailRow label="Risk profile id" value={String(selectedRiskProfileRecord.id ?? "n/a")} />
                    <DetailRow label="Description" value={String(selectedRiskProfileRecord.description ?? "n/a")} />
                    <DetailRow label="Maximum stop loss" value={String(selectedRiskProfileRecord.maximumStopLoss ?? "n/a")} />
                    <DetailRow label="Minimum stop loss" value={String(selectedRiskProfileRecord.minimumStopLoss ?? "n/a")} />
                    <DetailRow label="Swing gap" value={String(selectedRiskProfileRecord.swingGap ?? "n/a")} />
                    <DetailRow label="RRR" value={String(selectedRiskProfileRecord.rrr ?? "n/a")} />
                  </>
                ) : (
                  <Text style={{ color: "#475467" }}>
                    This risk profile was not found in the current configuration payload.
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

function DetailRow({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: "#475467", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text
        style={{
          color: "#101828",
          fontFamily: monospace ? "monospace" : undefined,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>{title}</Text>
      <Pressable
        onPress={onClose}
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
  );
}

function SingleSelectFilter({
  label,
  value,
  options,
  allLabel,
  renderOptionAdornment,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  allLabel: string;
  renderOptionAdornment?: (option: string) => ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <MultiSelectFilter
      label={label}
      value={value ? [value] : []}
      options={options}
      allLabel={allLabel}
      renderOptionAdornment={renderOptionAdornment}
      onChange={(values) => onChange(values.at(-1) ?? "")}
    />
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

function ExecutionTableHeader({
  sortBy,
  sortDirection,
  onSort,
}: {
  sortBy: SortKey;
  sortDirection: "asc" | "desc";
  onSort: (sortBy: SortKey) => void;
}) {
  const columns: Array<{ label: string; flex: number; sortKey?: SortKey }> = [
    { label: "Trade", flex: 1.3 },
    { label: "Context", flex: 1.4, sortKey: "symbolCode" },
    { label: "Timing", flex: 1.8, sortKey: "openedAt" },
    { label: "Position", flex: 1.7, sortKey: "notionalUsd" },
    { label: "Risk", flex: 1.5 },
    { label: "PnL", flex: 1.3, sortKey: "realizedPnlPercent" },
    { label: "Backtest", flex: 1.4 },
  ];

  return (
    <View
      style={{
        flexDirection: "row",
        width: "100%",
        backgroundColor: "#f8fafc",
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        borderWidth: 1,
        borderColor: "#eaecf0",
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      {columns.map((column) => (
        <Pressable
          key={column.label}
          disabled={!column.sortKey}
          onPress={() => column.sortKey && onSort(column.sortKey)}
          style={{
            flex: column.flex,
            paddingRight: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Text
            style={{
              color: "#475467",
              fontWeight: "700",
              fontSize: 12,
              textTransform: "uppercase",
            }}
          >
            {column.label}
          </Text>
          {column.sortKey ? (
            <MaterialIcons
              name={
                sortBy === column.sortKey
                  ? sortDirection === "asc"
                    ? "arrow-upward"
                    : "arrow-downward"
                  : "unfold-more"
              }
              size={14}
              color={sortBy === column.sortKey ? "#1d4ed8" : "#98a2b3"}
            />
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function ExecutionTableRow({
  trade,
  baseAsset,
  destinationAsset,
}: {
  trade: Awaited<ReturnType<typeof getExecutionTrades>>["items"][number];
  baseAsset?: string | null;
  destinationAsset?: string | null;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        width: "100%",
        borderWidth: 1,
        borderTopWidth: 0,
        borderColor: "#eaecf0",
        paddingHorizontal: 14,
        paddingVertical: 14,
        backgroundColor: "#ffffff",
      }}
    >
      <Cell
        flex={1.3}
        title={trade.tradeId}
        subtitle={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <StatusBadge status={trade.status} />
            <Text style={{ color: "#475467" }}>{trade.mode}</Text>
          </View>
        }
      />
      <View style={{ flex: 1.4, paddingRight: 12, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <SymbolAvatar
            baseAsset={baseAsset}
            destinationAsset={destinationAsset}
            size={22}
          />
          <Text numberOfLines={2} style={{ color: "#101828", fontWeight: "700", flex: 1 }}>
            {`${trade.symbolCode} · ${trade.timeframeCode}`}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text numberOfLines={2} style={{ color: "#475467" }}>
            {trade.strategyName}
          </Text>
          <SideBadge side={trade.side} />
        </View>
      </View>
      <Cell
        flex={1.8}
        title={formatTimestamp(trade.openedAt)}
        subtitle={
          trade.closedAt ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <CloseReasonBadge
                status={trade.status}
                closeReason={trade.closeReason}
              />
              <Text style={{ color: "#475467" }}>{formatTimestamp(trade.closedAt)}</Text>
            </View>
          ) : (
            <StatusBadge status="open" />
          )
        }
      />
      <Cell
        flex={1.7}
        title={`Entry ${trade.entryPrice.toFixed(4)}`}
        subtitle={`Exit ${trade.exitPrice === null ? "n/a" : trade.exitPrice.toFixed(4)} · Qty ${trade.quantity.toFixed(4)}`}
      />
      <Cell
        flex={1.5}
        title={`SL ${trade.stopLossPrice === null ? "n/a" : trade.stopLossPrice.toFixed(4)}`}
        subtitle={`TP ${trade.takeProfitPrice === null ? "n/a" : trade.takeProfitPrice.toFixed(4)}`}
      />
      <Cell
        flex={1.3}
        title={<PnlBadge percent={trade.realizedPnlPercent} />}
        subtitle={`${formatMoney(trade.realizedPnlUsd)} · fees ${formatMoney(trade.feesUsd)}`}
      />
      <Cell
        flex={1.4}
        title={trade.sourceBacktestId ?? "n/a"}
        subtitle={trade.analysisSettingId}
      />
    </View>
  );
}

function Cell({
  flex,
  title,
  subtitle,
}: {
  flex: number;
  title: ReactNode;
  subtitle: ReactNode;
}) {
  return (
    <View style={{ flex, paddingRight: 12, gap: 4 }}>
      {typeof title === "string" ? (
        <Text numberOfLines={2} style={{ color: "#101828", fontWeight: "700" }}>
          {title}
        </Text>
      ) : (
        title
      )}
      {typeof subtitle === "string" ? (
        <Text numberOfLines={3} style={{ color: "#475467" }}>
          {subtitle}
        </Text>
      ) : (
        subtitle
      )}
    </View>
  );
}

function SideBadge({ side }: { side: "long" | "short" }) {
  const isLong = side === "long";
  return (
    <Badge
      icon={isLong ? "arrow-upward" : "arrow-downward"}
      label={side}
      backgroundColor={isLong ? "#ecfdf3" : "#fef3f2"}
      foregroundColor={isLong ? "#157f3b" : "#b42318"}
    />
  );
}

function StatusBadge({
  status,
}: {
  status: "open" | "closed" | "cancelled" | "rejected";
}) {
  if (status === "open") {
    return (
      <Badge
        icon="lock-open"
        label="open"
        backgroundColor="#eff8ff"
        foregroundColor="#175cd3"
      />
    );
  }

  if (status === "closed") {
    return (
      <Badge
        icon="lock"
        label="closed"
        backgroundColor="#f2f4f7"
        foregroundColor="#344054"
      />
    );
  }

  if (status === "cancelled") {
    return (
      <Badge
        icon="lock"
        label="cancelled"
        backgroundColor="#fffaeb"
        foregroundColor="#b54708"
      />
    );
  }

  return (
    <Badge
      icon="lock"
      label="rejected"
      backgroundColor="#fef3f2"
      foregroundColor="#b42318"
    />
  );
}

function CloseReasonBadge({
  status,
  closeReason,
}: {
  status: "open" | "closed" | "cancelled" | "rejected";
  closeReason: string | null;
}) {
  if (status !== "closed") {
    return <StatusBadge status={status} />;
  }

  if (closeReason === "stopLoss") {
    return (
      <Badge
        icon="trending-down"
        label="stop loss"
        backgroundColor="#fef3f2"
        foregroundColor="#b42318"
      />
    );
  }

  if (closeReason === "takeProfit") {
    return (
      <Badge
        icon="trending-up"
        label="take profit"
        backgroundColor="#ecfdf3"
        foregroundColor="#157f3b"
      />
    );
  }

  if (closeReason === "reversal") {
    return (
      <Badge
        icon="swap-horiz"
        label="reversal"
        backgroundColor="#eff8ff"
        foregroundColor="#175cd3"
      />
    );
  }

  if (closeReason === "riskExit") {
    return (
      <Badge
        icon="rule"
        label="risk exit"
        backgroundColor="#fffaeb"
        foregroundColor="#b54708"
      />
    );
  }

  return <StatusBadge status="closed" />;
}

function PnlBadge({ percent }: { percent: number | null }) {
  if (percent === null) {
    return (
      <Badge
        icon="remove"
        label="n/a"
        backgroundColor="#f2f4f7"
        foregroundColor="#475467"
      />
    );
  }

  if (percent > 0) {
    return (
      <Badge
        icon="trending-up"
        label={formatPercent(percent)}
        backgroundColor="#ecfdf3"
        foregroundColor="#157f3b"
      />
    );
  }

  if (percent < 0) {
    return (
      <Badge
        icon="trending-down"
        label={formatPercent(percent)}
        backgroundColor="#fef3f2"
        foregroundColor="#b42318"
      />
    );
  }

  return (
    <Badge
      icon="trending-flat"
      label={formatPercent(percent)}
      backgroundColor="#fffaeb"
      foregroundColor="#b54708"
    />
  );
}

function Badge({
  icon,
  label,
  backgroundColor,
  foregroundColor,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  backgroundColor: string;
  foregroundColor: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        borderRadius: 999,
        backgroundColor,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      <MaterialIcons name={icon} size={12} color={foregroundColor} />
      <Text style={{ color: foregroundColor, fontSize: 12, fontWeight: "700" }}>
        {label}
      </Text>
    </View>
  );
}
