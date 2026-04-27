"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { DateRange } from "react-day-picker";
import type { SortingState } from "@tanstack/react-table";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";
import { useExecutionTrades } from "@/lib/hooks/use-execution-trades";
import { useExecutionSummary } from "@/lib/hooks/use-execution-summary";
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  useEnumState,
  useStringFilter,
} from "@/lib/url-state";
import { useQueryState } from "nuqs";
import type { ExecutionTrade, ExecutionTradesQuery } from "@/lib/api";

import { ExecutionFilters } from "./execution-filters";
import { ExecutionKpis } from "./execution-kpis";
import { ExecutionTradesTable } from "./execution-trades-table";
import { TradeDetailSheet } from "./trade-detail-sheet";

const SORT_FIELDS = new Set<ExecutionTradesQuery["sortBy"]>([
  "openedAt",
  "closedAt",
  "realizedPnlPercent",
  "symbolCode",
  "notionalUsd",
]);

interface ExecutionScreenProps {
  mode: "paper" | "live";
}

export function ExecutionScreen({ mode }: ExecutionScreenProps) {
  return (
    <React.Suspense fallback={null}>
      <ExecutionScreenInner mode={mode} />
    </React.Suspense>
  );
}

function ExecutionScreenInner({ mode }: ExecutionScreenProps) {
  const [search, setSearch] = useStringFilter("q", "");
  const [selectedSymbol, setSelectedSymbol] = useStringFilter("sym", "all");
  const [selectedTimeframe, setSelectedTimeframe] = useStringFilter("tf", "all");
  const [selectedStrategy, setSelectedStrategy] = useStringFilter("strategy", "all");
  const [selectedSide, setSelectedSide] = useEnumState(
    "side",
    ["all", "long", "short"] as const,
    "all",
  );
  const [selectedStatuses, setSelectedStatuses] = useQueryState(
    "status",
    parseAsArrayOf(parseAsString).withDefault([]).withOptions({
      history: "replace",
      shallow: true,
    }),
  );
  const [openedFrom, setOpenedFrom] = useStringFilter("from", "");
  const [openedTo, setOpenedTo] = useStringFilter("to", "");
  const [pageIndex, setPageIndex] = useQueryState(
    "page",
    parseAsInteger.withDefault(0).withOptions({
      history: "replace",
      shallow: true,
    }),
  );
  const [pageSize, setPageSize] = useQueryState(
    "size",
    parseAsInteger.withDefault(25).withOptions({
      history: "replace",
      shallow: true,
    }),
  );
  const [selectedTradeId, setSelectedTradeId] = useQueryState(
    "trade",
    parseAsString.withDefault("").withOptions({
      history: "push",
      shallow: true,
    }),
  );

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "openedAt", desc: true },
  ]);

  const dateRange = React.useMemo<DateRange | undefined>(() => {
    if (!openedFrom && !openedTo) return undefined;
    return {
      from: openedFrom ? new Date(openedFrom) : undefined,
      to: openedTo ? new Date(openedTo) : undefined,
    };
  }, [openedFrom, openedTo]);

  const handleDateRangeChange = (next: DateRange | undefined) => {
    setOpenedFrom(next?.from ? next.from.toISOString() : "");
    setOpenedTo(next?.to ? next.to.toISOString() : "");
    setPageIndex(0);
  };

  const querySortBy = sorting[0]?.id;
  const sortBy =
    querySortBy && SORT_FIELDS.has(querySortBy as ExecutionTradesQuery["sortBy"])
      ? (querySortBy as ExecutionTradesQuery["sortBy"])
      : "openedAt";
  const sortDirection = sorting[0]?.desc === false ? "asc" : "desc";

  const query: ExecutionTradesQuery = {
    mode,
    page: pageIndex + 1,
    pageSize,
    sortBy,
    sortDirection,
    search: search || undefined,
    symbolCode: selectedSymbol !== "all" ? selectedSymbol : undefined,
    timeframeCode: selectedTimeframe !== "all" ? selectedTimeframe : undefined,
    strategyName: selectedStrategy !== "all" ? selectedStrategy : undefined,
    side: selectedSide !== "all" ? selectedSide : undefined,
    status:
      selectedStatuses.length === 1
        ? (selectedStatuses[0] as ExecutionTrade["status"])
        : undefined,
    openedFrom: openedFrom || undefined,
    openedTo: openedTo || undefined,
  };

  const trades = useExecutionTrades(query);
  const summary = useExecutionSummary();

  const filteredItems = React.useMemo(() => {
    if (!trades.data) return [];
    if (selectedStatuses.length <= 1) return trades.data.items;
    const statusSet = new Set(selectedStatuses);
    return trades.data.items.filter((trade) => statusSet.has(trade.status));
  }, [trades.data, selectedStatuses]);

  const symbolOptions = React.useMemo(() => {
    const seen = new Set<string>();
    for (const trade of summary.data?.recentTrades ?? []) {
      seen.add(trade.symbolCode);
    }
    for (const trade of trades.data?.items ?? []) {
      seen.add(trade.symbolCode);
    }
    return Array.from(seen).sort();
  }, [summary.data, trades.data]);

  const timeframeOptions = React.useMemo(() => {
    const seen = new Set<string>();
    for (const trade of summary.data?.recentTrades ?? []) {
      seen.add(trade.timeframeCode);
    }
    for (const trade of trades.data?.items ?? []) {
      seen.add(trade.timeframeCode);
    }
    return Array.from(seen).sort();
  }, [summary.data, trades.data]);

  const strategyOptions = React.useMemo(() => {
    const seen = new Set<string>();
    for (const trade of summary.data?.recentTrades ?? []) {
      seen.add(trade.strategyName);
    }
    for (const trade of trades.data?.items ?? []) {
      seen.add(trade.strategyName);
    }
    return Array.from(seen).sort();
  }, [summary.data, trades.data]);

  const selectedTrade = React.useMemo<ExecutionTrade | null>(() => {
    if (!selectedTradeId) return null;
    return (
      filteredItems.find((trade) => trade.tradeId === selectedTradeId) ??
      summary.data?.recentTrades.find((trade) => trade.tradeId === selectedTradeId) ??
      null
    );
  }, [filteredItems, summary.data, selectedTradeId]);

  const hasActiveFilters =
    !!search ||
    selectedSymbol !== "all" ||
    selectedTimeframe !== "all" ||
    selectedStrategy !== "all" ||
    selectedSide !== "all" ||
    selectedStatuses.length > 0 ||
    !!dateRange?.from;

  const handleClearAll = () => {
    setSearch("");
    setSelectedSymbol("all");
    setSelectedTimeframe("all");
    setSelectedStrategy("all");
    setSelectedSide("all");
    setSelectedStatuses([]);
    handleDateRangeChange(undefined);
    setPageIndex(0);
  };

  return (
    <AppShell>
      <PageHeader
        actions={
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/execution/promotions">
              <ExternalLink className="size-3.5" />
              Promotions
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <ExecutionKpis
          mode={mode}
          realizedPnl={trades.data?.realizedPnlUsd ?? null}
          filteredCount={trades.data?.totalCount ?? 0}
          loading={trades.isLoading}
        />

        <ExecutionFilters
          symbols={symbolOptions}
          selectedSymbol={selectedSymbol}
          onSymbolChange={(next) => {
            setSelectedSymbol(next);
            setPageIndex(0);
          }}
          timeframes={timeframeOptions}
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={(next) => {
            setSelectedTimeframe(next);
            setPageIndex(0);
          }}
          strategies={strategyOptions}
          selectedStrategy={selectedStrategy}
          onStrategyChange={(next) => {
            setSelectedStrategy(next);
            setPageIndex(0);
          }}
          selectedSide={selectedSide}
          onSideChange={(next) => {
            setSelectedSide(next);
            setPageIndex(0);
          }}
          selectedStatuses={selectedStatuses}
          onStatusesChange={(next) => {
            setSelectedStatuses(next);
            setPageIndex(0);
          }}
          dateRange={dateRange}
          onDateRangeChange={handleDateRangeChange}
          search={search}
          onSearchChange={(next) => {
            setSearch(next);
            setPageIndex(0);
          }}
          onClearAll={handleClearAll}
          hasActiveFilters={hasActiveFilters}
          topOffset={56}
        />

        {trades.isError ? (
          <ErrorState
            title="Failed to load trades"
            description="The control plane returned an error. Retry, or check the server logs."
            onRetry={() => trades.refetch()}
          />
        ) : (
          <ExecutionTradesTable
            trades={filteredItems}
            totalCount={trades.data?.totalCount ?? 0}
            pageIndex={pageIndex}
            pageSize={pageSize}
            onPaginationChange={(next) => {
              setPageIndex(next.pageIndex);
              setPageSize(next.pageSize);
            }}
            isLoading={trades.isLoading}
            sorting={sorting}
            onSortingChange={setSorting}
            onRowSelect={(trade) => setSelectedTradeId(trade.tradeId)}
          />
        )}
      </div>

      <TradeDetailSheet
        open={Boolean(selectedTrade)}
        onOpenChange={(open) => {
          if (!open) setSelectedTradeId("");
        }}
        trade={selectedTrade}
      />
    </AppShell>
  );
}
