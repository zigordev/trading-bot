import { MaterialIcons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";

import { AppShell } from "@/src/components/app-shell";
import { Card } from "@/src/components/card";
import { MultiSelectFilter } from "@/src/components/multi-select-filter";
import { SymbolAvatar } from "@/src/components/symbol-avatar";
import {
  getBacktestsSummary,
  getConfigResourceRecords,
  getExecutionSummary,
  getExecutionTrades,
} from "@/src/lib/api";
import { subscribeOpsRealtimeEvent } from "@/src/lib/ops-events";

const PAGE_SIZE = 10;

const formatMoney = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : `$${value.toFixed(2)}`;

const formatPrice = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : `$${value.toFixed(4)}`;

const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined ? "n/a" : `${value.toFixed(2)}%`;

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString().replace(",", "");
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

const sortOptions = {
  openedAt: "Opened",
  closedAt: "Closed",
  realizedPnlPercent: "PnL %",
  symbolCode: "Symbol",
  notionalUsd: "Notional",
} as const;

type SortKey = keyof typeof sortOptions;
type ExecutionMode = "paper" | "live";
type ExecutionSection = "trades" | "promotion";
type TradesTableLayout = {
  statusFlex: number;
  contextFlex: number;
  entryFlex: number;
  riskFlex: number;
  exitFlex: number;
  strategyFlex: number;
  statusMin: number;
  contextMin: number;
  entryMin: number;
  riskMin: number;
  exitMin: number;
  strategyMin: number;
};

const getTradesTableLayout = (width: number): TradesTableLayout => {
  if (width >= 1600) {
    return {
      statusFlex: 0.55,
      contextFlex: 0.9,
      entryFlex: 3.05,
      riskFlex: 1.35,
      exitFlex: 3.45,
      strategyFlex: 0.68,
      statusMin: 92,
      contextMin: 145,
      entryMin: 320,
      riskMin: 190,
      exitMin: 360,
      strategyMin: 118,
    };
  }

  if (width >= 1280) {
    return {
      statusFlex: 0.6,
      contextFlex: 0.95,
      entryFlex: 2.95,
      riskFlex: 1.35,
      exitFlex: 3.28,
      strategyFlex: 0.72,
      statusMin: 88,
      contextMin: 140,
      entryMin: 300,
      riskMin: 180,
      exitMin: 330,
      strategyMin: 112,
    };
  }

  return {
    statusFlex: 0.7,
    contextFlex: 1.0,
    entryFlex: 2.7,
    riskFlex: 1.45,
    exitFlex: 2.98,
    strategyFlex: 0.86,
    statusMin: 84,
    contextMin: 132,
    entryMin: 270,
    riskMin: 165,
    exitMin: 290,
    strategyMin: 108,
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

export function ExecutionScreenContent({
  fixedMode,
}: {
  fixedMode?: ExecutionMode;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const queryClient = useQueryClient();
  const [tabMode, setTabMode] = useState<ExecutionMode>("paper");
  const [section, setSection] = useState<ExecutionSection>("trades");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [symbolCode, setSymbolCode] = useState<string>("");
  const [timeframeCode, setTimeframeCode] = useState<string>("");
  const [strategyName, setStrategyName] = useState<string>("");
  const [openedFrom, setOpenedFrom] = useState("");
  const [openedTo, setOpenedTo] = useState("");
  const [status, setStatus] = useState<"" | "open" | "closed" | "cancelled" | "rejected">("");
  const [side, setSide] = useState<"" | "long" | "short">("");
  const [sortBy, setSortBy] = useState<SortKey>("openedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedBacktestId, setSelectedBacktestId] = useState<string | null>(null);
  const [selectedPromotionId, setSelectedPromotionId] = useState<string | null>(null);
  const [selectedAnalysisSettingId, setSelectedAnalysisSettingId] = useState<string | null>(null);
  const [selectedRiskProfileName, setSelectedRiskProfileName] = useState<string | null>(null);
  const currentMode = fixedMode ?? tabMode;
  const tableLayout = useMemo(() => getTradesTableLayout(viewportWidth), [viewportWidth]);
  const tableMinContentWidth = useMemo(
    () =>
      tableLayout.statusMin +
      tableLayout.contextMin +
      tableLayout.entryMin +
      tableLayout.riskMin +
      tableLayout.exitMin +
      tableLayout.strategyMin +
      120,
    [tableLayout],
  );
  const tableWidth = Math.max(viewportWidth - 96, tableMinContentWidth);

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
      openedFrom,
      openedTo,
      status,
      side,
      currentMode,
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
        openedFrom: toIsoDateTime(openedFrom),
        openedTo: toIsoDateTime(openedTo),
        status: status || undefined,
        side: side || undefined,
        mode: currentMode,
        sortBy,
        sortDirection,
      }),
  });
  const closedTradesCountQuery = useQuery({
    queryKey: ["ops-execution-trades-count", "closed", currentMode],
    queryFn: () =>
      getExecutionTrades({
        page: 1,
        pageSize: 1,
        status: "closed",
        mode: currentMode,
        sortBy: "openedAt",
        sortDirection: "desc",
      }),
  });

  const trades = executionTradesQuery.data?.items ?? [];
  const totalCount = executionTradesQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const modeActivePromotions = useMemo(
    () =>
      (executionSummaryQuery.data?.activePromotions ?? []).filter(
        (promotion) => promotion.mode === currentMode,
      ),
    [executionSummaryQuery.data?.activePromotions, currentMode],
  );
  const modeRecentTrades = useMemo(
    () =>
      (executionSummaryQuery.data?.recentTrades ?? []).filter((trade) => trade.mode === currentMode),
    [executionSummaryQuery.data?.recentTrades, currentMode],
  );
  const summaryStats = useMemo(
    () => ({
      openTradeCount: modeRecentTrades.filter((trade) => trade.status === "open").length,
      closedTradeCount: closedTradesCountQuery.data?.totalCount ?? 0,
      realizedPnlUsd: modeRecentTrades.reduce(
        (sum, trade) => sum + (trade.realizedPnlUsd ?? 0),
        0,
      ),
    }),
    [closedTradesCountQuery.data?.totalCount, modeRecentTrades],
  );
  const selectedPromotion = useMemo(() => {
    if (!selectedPromotionId) {
      return null;
    }

    return (
      modeActivePromotions.find(
        (promotion) => promotion.promotionId === selectedPromotionId,
      ) ?? null
    );
  }, [modeActivePromotions, selectedPromotionId]);
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
    return {
      symbols: Array.from(
        new Set([
          ...modeRecentTrades.map((item) => item.symbolCode),
        ]),
      ).sort(),
      timeframes: Array.from(
        new Set([
          ...modeRecentTrades.map((item) => item.timeframeCode),
        ]),
      ).sort(),
      strategies: Array.from(
        new Set(modeRecentTrades.map((item) => item.strategyName)),
      ).sort(),
    };
  }, [modeRecentTrades]);

  const resetFilters = () => {
    setPage(1);
    setSearch("");
    setSymbolCode("");
    setTimeframeCode("");
    setStrategyName("");
    setOpenedFrom("");
    setOpenedTo("");
    setStatus("");
    setSide("");
    setSortBy("openedAt");
    setSortDirection("desc");
  };

  return (
    <AppShell>
      <View style={{ gap: 0 }}>
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
              <ExecutionSectionTab
                label="Trades"
                icon="receipt-long"
                active={section === "trades"}
                onPress={() => setSection("trades")}
              />
              <ExecutionSectionTab
                label="Promotion"
                icon="military-tech"
                active={section === "promotion"}
                onPress={() => setSection("promotion")}
              />
            </ScrollView>
          </View>
        </View>

        <View style={{ gap: 16, paddingTop: 16 }}>
        {section === "promotion" ? (
          <Card>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 20, fontWeight: "700", color: "#101828" }}>
                Promoted strategies
              </Text>
              <Text style={{ color: "#475467" }}>
                Current active {currentMode} promotion set ranked by compounded backtest score.
              </Text>
            </View>
            {modeActivePromotions.length === 0 ? (
              <View
                style={{
                  marginTop: 12,
                  borderWidth: 1,
                  borderColor: "#eaecf0",
                  borderRadius: 12,
                  backgroundColor: "#fcfcfd",
                  paddingHorizontal: 14,
                  paddingVertical: 16,
                }}
              >
                <Text style={{ color: "#475467" }}>
                  No promoted strategies are available for {currentMode} mode.
                </Text>
              </View>
            ) : (
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
                    Score
                  </Text>
                </View>
                {modeActivePromotions.map((promotion, index, items) => (
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
                    onPress={() =>
                      promotion.sourceBacktestId && setSelectedBacktestId(promotion.sourceBacktestId)
                    }
                    style={{
                      flex: 0.8,
                      color: promotion.sourceBacktestId ? "#1d4ed8" : "#101828",
                      fontWeight: "700",
                      textAlign: "right",
                      textDecorationLine: promotion.sourceBacktestId ? "underline" : "none",
                    }}
                  >
                    {promotion.selectionValue.toFixed(2)}
                  </Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        ) : (
          <Card>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 14,
              }}
            >
              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <InlineStat
                  label="Realized PnL"
                  value={formatMoney(summaryStats.realizedPnlUsd)}
                  valueColor={
                    summaryStats.realizedPnlUsd > 0
                      ? "#157f3b"
                      : summaryStats.realizedPnlUsd < 0
                        ? "#b42318"
                        : "#101828"
                  }
                />
              </View>
            </View>

          <View style={{ gap: 10, marginTop: 10, position: "relative", zIndex: 30 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, zIndex: 30 }}>
              {!fixedMode ? (
                <View
                  style={{
                    minWidth: 220,
                    flexDirection: "row",
                    minHeight: 44,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#d0d5dd",
                    backgroundColor: "#ffffff",
                    padding: 4,
                  }}
                >
                  <ExecutionModeTab
                    label="Paper"
                    active={currentMode === "paper"}
                    onPress={() => {
                      setTabMode("paper");
                      setPage(1);
                    }}
                  />
                  <ExecutionModeTab
                    label="Live"
                    active={currentMode === "live"}
                    onPress={() => {
                      setTabMode("live");
                      setPage(1);
                    }}
                  />
                </View>
              ) : null}
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
              <DateTimeRangeFilter
                label="Opened range"
                fromValue={openedFrom}
                toValue={openedTo}
                onChange={(nextFrom, nextTo) => {
                  setOpenedFrom(nextFrom);
                  setOpenedTo(nextTo);
                  setPage(1);
                }}
              />
              <SingleSelectFilter
                label="Status"
                value={status}
                options={["open", "closed", "cancelled", "rejected"]}
                allLabel="All statuses"
                hideOptionText
                hideSelectedSummaryText
                renderOptionAdornment={(option) => (
                  option === "open" ||
                  option === "closed" ||
                  option === "cancelled" ||
                  option === "rejected" ? (
                    <StatusBadge status={option} />
                  ) : null
                )}
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
                hideOptionText
                hideSelectedSummaryText
                renderOptionAdornment={(option) => (
                  option === "long" || option === "short" ? (
                    <SideBadge side={option} />
                  ) : null
                )}
                onChange={(value) => {
                  setSide(value as typeof side);
                  setPage(1);
                }}
              />
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ zIndex: 1, marginTop: 16 }}
            contentContainerStyle={{ minWidth: "100%" }}
          >
            <View style={{ width: tableWidth, minWidth: tableWidth, gap: 0 }}>
              <ExecutionTableHeader
                sortBy={sortBy}
                sortDirection={sortDirection}
                viewportWidth={viewportWidth}
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
                  promotionId={derivePromotionIdFromTradeId(trade.tradeId)}
                  baseAsset={
                    symbolBaseAssets.get(trade.symbolCode) ??
                    deriveAssetsFromSymbolCode(trade.symbolCode)?.baseAsset
                  }
                  destinationAsset={
                    symbolDestinationAssets.get(trade.symbolCode) ??
                    deriveAssetsFromSymbolCode(trade.symbolCode)?.destinationAsset
                  }
                  viewportWidth={viewportWidth}
                  onOpenPromotionDetails={setSelectedPromotionId}
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
                    backgroundColor: "#fcfcfd",
                  }}
                >
                  <Text style={{ color: "#475467" }}>
                    No execution trades match the current filters. Once the execution service starts
                    emitting trade events, they will appear here.
                  </Text>
                </View>
              ) : null}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                  borderWidth: 1,
                  borderTopWidth: 0,
                  borderColor: "#eaecf0",
                  borderBottomLeftRadius: 18,
                  borderBottomRightRadius: 18,
                  backgroundColor: "#f8fafc",
                  paddingHorizontal: 14,
                  paddingVertical: 12,
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
            </View>
          </ScrollView>
          </Card>
        )}
        </View>
      </View>
      <Modal
        visible={selectedPromotionId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPromotionId(null)}
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
              <ModalHeader
                title="Promoted strategy details"
                onClose={() => setSelectedPromotionId(null)}
              />
              <View style={{ gap: 10, marginTop: 12 }}>
                <DetailRow label="Promotion id" value={selectedPromotionId ?? "n/a"} />
                {selectedPromotion ? (
                  <>
                    <DetailRow
                      label="Execution setting"
                      value={selectedPromotion.executionSettingsName}
                    />
                    <DetailRow label="Mode" value={selectedPromotion.mode} />
                    <DetailRow label="Status" value={selectedPromotion.status} />
                    <DetailRow
                      label="Market"
                      value={`${selectedPromotion.symbolCode} · ${selectedPromotion.timeframeCode}`}
                    />
                    <DetailRow label="Strategy" value={selectedPromotion.strategyName} />
                    <DetailRow label="Risk profile" value={selectedPromotion.riskProfileName} />
                    <DetailRow
                      label="Analysis setting id"
                      value={selectedPromotion.analysisSettingId}
                    />
                    <DetailRow
                      label="Selection value"
                      value={selectedPromotion.selectionValue.toFixed(2)}
                    />
                    <DetailRow
                      label="Promoted at"
                      value={formatTimestamp(selectedPromotion.promotedAt)}
                    />
                    <DetailRow
                      label="Source backtest id"
                      value={selectedPromotion.sourceBacktestId ?? "n/a"}
                    />
                  </>
                ) : (
                  <Text style={{ color: "#475467" }}>
                    This promoted strategy is not in the current active promotion set.
                  </Text>
                )}
              </View>
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
                    <DetailRow label="Analysis setting id" value={selectedBacktestRun.analysisSettingId} />
                    <DetailRow label="Risk profile" value={selectedBacktestRun.riskProfileName} />
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

function ScoreBreakdownSection({
  run,
}: {
  run: Awaited<ReturnType<typeof getBacktestsSummary>>["latestRuns"][number];
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
  hideOptionText,
  hideSelectedSummaryText,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  allLabel: string;
  renderOptionAdornment?: (option: string) => ReactNode;
  hideOptionText?: boolean;
  hideSelectedSummaryText?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <MultiSelectFilter
      label={label}
      value={value ? [value] : []}
      options={options}
      allLabel={allLabel}
      renderOptionAdornment={renderOptionAdornment}
      hideOptionText={hideOptionText}
      hideSelectedSummaryText={hideSelectedSummaryText}
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
  viewportWidth,
  onSort,
}: {
  sortBy: SortKey;
  sortDirection: "asc" | "desc";
  viewportWidth: number;
  onSort: (sortBy: SortKey) => void;
}) {
  const layout = getTradesTableLayout(viewportWidth);
  const columns: Array<{ label: string; flex: number; sortKey?: SortKey }> = [
    { label: "Status", flex: layout.statusFlex },
    { label: "Context", flex: layout.contextFlex, sortKey: "symbolCode" },
    { label: "Entry", flex: layout.entryFlex, sortKey: "openedAt" },
    { label: "Risk info", flex: layout.riskFlex },
    { label: "Exit", flex: layout.exitFlex, sortKey: "closedAt" },
    { label: "Promoted strategy", flex: layout.strategyFlex },
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
            paddingRight: 8,
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
  promotionId,
  baseAsset,
  destinationAsset,
  viewportWidth,
  onOpenPromotionDetails,
}: {
  trade: Awaited<ReturnType<typeof getExecutionTrades>>["items"][number];
  promotionId: string | null;
  baseAsset?: string | null;
  destinationAsset?: string | null;
  viewportWidth: number;
  onOpenPromotionDetails: (promotionId: string) => void;
}) {
  const layout = getTradesTableLayout(viewportWidth);
  const dense = viewportWidth >= 1280;
  const compact = viewportWidth <= 1120;

  return (
    <View
      style={{
        flexDirection: "row",
        width: "100%",
        borderWidth: 1,
        borderTopWidth: 0,
        borderColor: "#eaecf0",
        paddingHorizontal: 14,
        paddingVertical: dense ? 10 : 12,
        backgroundColor: "#ffffff",
      }}
    >
      <Cell
        flex={layout.statusFlex}
        minWidth={layout.statusMin}
        title={
          <View style={{ alignSelf: "flex-start" }}>
            <StatusBadge status={trade.status} />
          </View>
        }
        subtitle=""
      />
      <View style={{ flex: layout.contextFlex, minWidth: layout.contextMin, paddingRight: 4, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <SymbolAvatar
            baseAsset={baseAsset}
            destinationAsset={destinationAsset}
            size={22}
          />
          <Text numberOfLines={1} style={{ color: "#101828", fontWeight: "700", flex: 1 }}>
            {trade.symbolCode}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ color: "#475467" }}>
          {trade.timeframeCode} · {trade.strategyName}
        </Text>
      </View>
      <View
        style={{
          flex: layout.entryFlex,
          minWidth: layout.entryMin,
          paddingRight: 8,
          gap: 4,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <TimeBadge value={trade.openedAt} />
          <InfoBadge label={formatPrice(trade.entryPrice)} />
          <SideBadge side={trade.side} />
          <InfoBadge label={`Qty ${trade.quantity.toFixed(4)} / ${formatMoney(trade.notionalUsd)}`} />
        </View>
      </View>
      <Cell
        flex={layout.riskFlex}
        minWidth={layout.riskMin}
        title={
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <RiskPriceBadge kind="SL" value={trade.stopLossPrice} tone="danger" />
            <RiskPriceBadge kind="TP" value={trade.takeProfitPrice} tone="success" />
          </View>
        }
        subtitle={
          ""
        }
      />
      <View style={{ flex: layout.exitFlex, minWidth: layout.exitMin, paddingRight: 10, gap: 4 }}>
        <View
          style={{
            flexDirection: "row",
            gap: 6,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <TimeBadge value={trade.closedAt} />
          <InfoBadge
            label={trade.exitPrice === null ? "Exit n/a" : formatPrice(trade.exitPrice)}
          />
          <ExitOutcomeBadge
            status={trade.status}
            closeReason={trade.closeReason}
            percent={trade.realizedPnlPercent}
          />
          <InfoBadge label={`${formatMoney(trade.realizedPnlUsd)} · fees ${formatMoney(trade.feesUsd)}`} />
        </View>
      </View>
      <View style={{ flex: layout.strategyFlex, minWidth: layout.strategyMin, paddingRight: compact ? 0 : 8, gap: 6 }}>
        <ActionLink
          label="Open details"
          disabled={!promotionId}
          onPress={() => promotionId && onOpenPromotionDetails(promotionId)}
        />
      </View>
    </View>
  );
}

function Cell({
  flex,
  minWidth,
  title,
  subtitle,
}: {
  flex: number;
  minWidth?: number;
  title: ReactNode;
  subtitle: ReactNode;
}) {
  return (
    <View style={{ flex, minWidth, paddingRight: 8, gap: 4 }}>
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


function RiskPriceBadge({
  kind,
  value,
  tone,
}: {
  kind: "SL" | "TP";
  value: number | null;
  tone: "danger" | "success";
}) {
  const foregroundColor = tone === "danger" ? "#b42318" : "#157f3b";
  const backgroundColor = tone === "danger" ? "#fef3f2" : "#ecfdf3";
  return (
    <Badge
      icon={tone === "danger" ? "warning" : "flag"}
      label={`${kind} ${formatPrice(value)}`}
      backgroundColor={backgroundColor}
      foregroundColor={foregroundColor}
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
        backgroundColor="#fffaeb"
        foregroundColor="#b54708"
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
        backgroundColor="#fef3c7"
        foregroundColor="#a16207"
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

function ExitOutcomeBadge({
  status,
  closeReason,
  percent,
}: {
  status: "open" | "closed" | "cancelled" | "rejected";
  closeReason: string | null;
  percent: number | null;
}) {
  if (status !== "closed") {
    return null;
  }

  const percentLabel = percent === null ? "n/a" : formatPercent(percent);

  if (closeReason === "stopLoss") {
    return (
      <Badge
        icon="trending-down"
        label={`stop loss ${percentLabel}`}
        backgroundColor="#fef3f2"
        foregroundColor="#b42318"
      />
    );
  }

  if (closeReason === "takeProfit") {
    return (
      <Badge
        icon="trending-up"
        label={`take profit ${percentLabel}`}
        backgroundColor="#ecfdf3"
        foregroundColor="#157f3b"
      />
    );
  }

  if (closeReason === "reversal") {
    return (
      <Badge
        icon="swap-horiz"
        label={`reversal ${percentLabel}`}
        backgroundColor="#eff8ff"
        foregroundColor="#175cd3"
      />
    );
  }

  if (closeReason === "riskExit") {
    return (
      <Badge
        icon="rule"
        label={`risk exit ${percentLabel}`}
        backgroundColor="#fffaeb"
        foregroundColor="#b54708"
      />
    );
  }

  return <PnlBadge percent={percent} />;
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
        alignSelf: "flex-start",
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
      <Text numberOfLines={1} style={{ color: foregroundColor, fontSize: 12, fontWeight: "700", maxWidth: 260 }}>
        {label}
      </Text>
    </View>
  );
}

function TimeBadge({ value }: { value: string | null | undefined }) {
  return (
    <Badge
      icon="schedule"
      label={formatCompactTimestamp(value)}
      backgroundColor="#eff8ff"
      foregroundColor="#175cd3"
    />
  );
}

function InfoBadge({ label }: { label: string }) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 999,
        backgroundColor: "#f2f4f7",
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    >
      <Text style={{ color: "#475467", fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

function ActionLink({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress}>
      <Text
        style={{
          color: disabled ? "#98a2b3" : "#175cd3",
          fontWeight: "700",
          textDecorationLine: "underline",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function derivePromotionIdFromTradeId(tradeId: string): string | null {
  if (!tradeId.startsWith("paper:")) {
    return null;
  }

  const withoutPrefix = tradeId.slice("paper:".length);
  const separatorIndex = withoutPrefix.lastIndexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  return withoutPrefix.slice(0, separatorIndex);
}

function toIsoDateTime(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function DateTimeRangeFilter({
  label,
  fromValue,
  toValue,
  onChange,
}: {
  label: string;
  fromValue: string;
  toValue: string;
  onChange: (fromValue: string, toValue: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(fromValue);
  const [draftTo, setDraftTo] = useState(toValue);

  const summary = fromValue || toValue ? `${fromValue || "Any"} -> ${toValue || "Any"}` : "Any time";

  const openPanel = () => {
    setOpen((current) => {
      const next = !current;
      if (next) {
        setDraftFrom(fromValue);
        setDraftTo(toValue);
      }
      return next;
    });
  };

  return (
    <View style={{ minWidth: 240, position: "relative", zIndex: open ? 40 : 1 }}>
      <Pressable
        onPress={openPanel}
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: "#cbd5e1",
          backgroundColor: "#ffffff",
          paddingHorizontal: 12,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: "#475467" }}>{label}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <MaterialIcons name="event" size={18} color="#344054" />
            <Text numberOfLines={1} style={{ color: "#101828", fontWeight: "600", flex: 1 }}>
              {summary}
            </Text>
          </View>
        </View>
        {fromValue || toValue ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onChange("", "");
            }}
            style={{
              borderRadius: 999,
              padding: 4,
            }}
          >
            <MaterialIcons name="close" size={16} color="#667085" />
          </Pressable>
        ) : (
          <MaterialIcons name="arrow-drop-down" size={20} color="#344054" />
        )}
      </Pressable>

      {open ? (
        <View
          style={{
            position: "absolute",
            top: 58,
            left: 0,
            width: Platform.OS === "web" ? 520 : undefined,
            minWidth: 320,
            maxWidth: 520,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#d0d5dd",
            backgroundColor: "#ffffff",
            padding: 12,
            gap: 10,
            zIndex: 50,
            shadowColor: "#101828",
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.12,
            shadowRadius: 16,
            elevation: 10,
          }}
        >
          {Platform.OS === "web" ? (
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
                <Text style={{ fontSize: 12, color: "#475467", fontWeight: "700" }}>From</Text>
                <input
                  type="datetime-local"
                  value={draftFrom}
                  onChange={(event) => setDraftFrom(event.target.value)}
                  style={{
                    borderRadius: 10,
                    border: "1px solid #d0d5dd",
                    backgroundColor: "#f8fafc",
                    color: "#101828",
                    padding: "10px 12px",
                    fontSize: "14px",
                    fontWeight: 600,
                    fontFamily: "inherit",
                  }}
                />
              </View>
              <View style={{ flex: 1, minWidth: 220, gap: 6 }}>
                <Text style={{ fontSize: 12, color: "#475467", fontWeight: "700" }}>To</Text>
                <input
                  type="datetime-local"
                  value={draftTo}
                  onChange={(event) => setDraftTo(event.target.value)}
                  style={{
                    borderRadius: 10,
                    border: "1px solid #d0d5dd",
                    backgroundColor: "#f8fafc",
                    color: "#101828",
                    padding: "10px 12px",
                    fontSize: "14px",
                    fontWeight: 600,
                    fontFamily: "inherit",
                  }}
                />
              </View>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <TextInput
                value={draftFrom}
                onChangeText={setDraftFrom}
                placeholder="From (YYYY-MM-DDTHH:mm)"
                placeholderTextColor="#98a2b3"
                style={{
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#d0d5dd",
                  backgroundColor: "#f8fafc",
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: "#101828",
                  fontWeight: "600",
                }}
              />
              <TextInput
                value={draftTo}
                onChangeText={setDraftTo}
                placeholder="To (YYYY-MM-DDTHH:mm)"
                placeholderTextColor="#98a2b3"
                style={{
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#d0d5dd",
                  backgroundColor: "#f8fafc",
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  color: "#101828",
                  fontWeight: "600",
                }}
              />
            </View>
          )}

          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
            <Pressable
              onPress={() => {
                setDraftFrom("");
                setDraftTo("");
                onChange("", "");
                setOpen(false);
              }}
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#d0d5dd",
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <Text style={{ color: "#344054", fontWeight: "700" }}>Clear</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onChange(draftFrom.trim(), draftTo.trim());
                setOpen(false);
              }}
              style={{
                borderRadius: 10,
                backgroundColor: "#1f3a5f",
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            >
              <Text style={{ color: "#ffffff", fontWeight: "700" }}>Apply</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ExecutionSectionTab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: active ? "#1f3a5f" : "transparent",
        borderWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      }}
    >
      <MaterialIcons
        name={icon}
        size={18}
        color={active ? "#ffffff" : "#344054"}
      />
      <Text style={{ color: active ? "#ffffff" : "#344054", fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function ExecutionModeTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
        backgroundColor: active ? "#1f3a5f" : "transparent",
        borderWidth: active ? 1 : 0,
        borderColor: "#1f3a5f",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: active ? "#dbeafe" : "#344054", fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function InlineStat({
  label,
  value,
  icon,
  valueColor = "#101828",
}: {
  label: string;
  value: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  valueColor?: string;
}) {
  const badgePalette =
    valueColor === "#157f3b"
      ? { backgroundColor: "#ecfdf3", borderColor: "#abefc6" }
      : valueColor === "#b42318"
        ? { backgroundColor: "#fef3f2", borderColor: "#fecdca" }
        : valueColor === "#b54708"
          ? { backgroundColor: "#fffaeb", borderColor: "#fedf89" }
          : { backgroundColor: "#f2f4f7", borderColor: "#d0d5dd" };

  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
        ...badgePalette,
      }}
    >
      {icon ? <MaterialIcons name={icon} size={16} color={valueColor} /> : null}
      <Text style={{ fontSize: 12, color: valueColor, fontWeight: "700" }}>{label}</Text>
      <Text style={{ fontSize: 14, color: valueColor, fontWeight: "800" }}>{value}</Text>
    </View>
  );
}

export default function ExecutionScreen() {
  return <ExecutionScreenContent />;
}
