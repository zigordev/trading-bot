"use client";

import * as React from "react";

import { ErrorState } from "@/components/shared/error-state";
import { usePreferences } from "@/components/providers/preferences-provider";
import { useBacktestsSummary } from "@/lib/hooks/use-backtests-summary";
import { useDataReadiness } from "@/lib/hooks/use-data-readiness";
import { useStrategies } from "@/lib/hooks/use-strategies";
import { deriveBacktestRows } from "@/lib/backtesting/derive-rows";
import { thresholdsFromStrategyRecords } from "@/lib/backtesting/derive-thresholds";
import {
  parseAsArrayOf,
  parseAsString,
  useArrayFilter,
  useEnumState,
  useSelectedRow,
  useStringFilter,
} from "@/lib/url-state";
import type { BacktestRow } from "@/lib/backtesting/types";
import type { RecentBacktestRun } from "@/lib/api";
import { useQueryState } from "nuqs";

import { BacktestingFilters } from "./_components/backtesting-filters";
import { BacktestingKpis } from "./_components/backtesting-kpis";
import { BacktestingTable } from "./_components/backtesting-table";
import { BacktestingDetailSheet } from "./_components/backtesting-detail-sheet";
import { RunDetailSheet } from "./_components/run-detail-sheet";

export default function BacktestingPage() {
  return (
    <React.Suspense fallback={null}>
      <BacktestingPageInner />
    </React.Suspense>
  );
}

function BacktestingPageInner() {
  const { t } = usePreferences();
  const summary = useBacktestsSummary();
  const readiness = useDataReadiness();
  const strategies = useStrategies();

  const rows = React.useMemo(
    () => deriveBacktestRows({ summary: summary.data, readiness: readiness.data }),
    [summary.data, readiness.data],
  );
  const thresholdsByStrategy = React.useMemo(
    () => thresholdsFromStrategyRecords(strategies.data),
    [strategies.data],
  );

  const symbols = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.symbol))).sort(),
    [rows],
  );
  const timeframes = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.timeframeCode))).sort(),
    [rows],
  );
  const strategyNames = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.strategyName))).sort(),
    [rows],
  );

  const [search, setSearch] = useStringFilter("q", "");
  const [selectedSymbols, setSelectedSymbols] = useArrayFilter("sym");
  const [selectedTimeframe, setSelectedTimeframe] = useEnumState(
    "tf",
    ["all", ...timeframes] as const,
    "all",
  );
  const [selectedStrategy, setSelectedStrategy] = useEnumState(
    "strategy",
    ["all", ...strategyNames] as const,
    "all",
  );
  const [selectedStatuses, setSelectedStatuses] = useQueryState(
    "status",
    parseAsArrayOf(parseAsString).withDefault([]).withOptions({
      history: "replace",
      shallow: true,
    }),
  );
  const [selectedRowId, setSelectedRowId] = useSelectedRow();
  const [selectedRunId, setSelectedRunId] = useQueryState(
    "run",
    parseAsString.withDefault("").withOptions({
      history: "push",
      shallow: true,
    }),
  );

  const [sorting, setSorting] = React.useState<
    React.ComponentProps<typeof BacktestingTable>["sorting"]
  >([{ id: "score", desc: true }]);
  const [columnVisibility, setColumnVisibility] = React.useState<
    Record<string, boolean>
  >({});

  const filteredRows = React.useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    const symbolSet = new Set(selectedSymbols);
    const statusSet = new Set(selectedStatuses);
    return rows.filter((row) => {
      if (lowerSearch) {
        const haystack = `${row.symbol} ${row.strategyName} ${row.timeframeCode}`.toLowerCase();
        if (!haystack.includes(lowerSearch)) return false;
      }
      if (symbolSet.size > 0 && !symbolSet.has(row.symbol)) return false;
      if (selectedTimeframe !== "all" && row.timeframeCode !== selectedTimeframe) return false;
      if (selectedStrategy !== "all" && row.strategyName !== selectedStrategy) return false;
      if (statusSet.size > 0 && !statusSet.has(row.status)) return false;
      return true;
    });
  }, [rows, search, selectedSymbols, selectedTimeframe, selectedStrategy, selectedStatuses]);

  const selectedRow = React.useMemo(
    () => rows.find((row) => row.id === selectedRowId) ?? null,
    [rows, selectedRowId],
  );

  const recentRunsForSelected = React.useMemo<RecentBacktestRun[]>(() => {
    if (!selectedRow) return [];
    return (
      summary.data?.recentRuns.filter(
        (run) =>
          run.symbol === selectedRow.symbol &&
          run.timeframeCode === selectedRow.timeframeCode &&
          run.strategyName === selectedRow.strategyName,
      ) ?? []
    );
  }, [summary.data, selectedRow]);

  const selectedRun = React.useMemo<RecentBacktestRun | null>(() => {
    if (!selectedRunId) return null;
    return recentRunsForSelected.find((run) => run.backtestId === selectedRunId) ?? null;
  }, [recentRunsForSelected, selectedRunId]);

  const isLoading = summary.isLoading || readiness.isLoading;
  const hasError = summary.isError || readiness.isError;
  const hasActiveFilters =
    !!search ||
    selectedSymbols.length > 0 ||
    selectedTimeframe !== "all" ||
    selectedStrategy !== "all" ||
    selectedStatuses.length > 0;

  const handleClearAll = () => {
    setSearch("");
    setSelectedSymbols([]);
    setSelectedTimeframe("all");
    setSelectedStrategy("all");
    setSelectedStatuses([]);
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <BacktestingKpis rows={rows} loading={isLoading} />

        <BacktestingFilters
          symbols={symbols}
          selectedSymbols={selectedSymbols}
          onSymbolsChange={setSelectedSymbols}
          timeframes={timeframes}
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={(value) =>
            setSelectedTimeframe(
              value as React.ComponentProps<typeof BacktestingFilters>["selectedTimeframe"],
            )
          }
          strategies={strategyNames}
          selectedStrategy={selectedStrategy}
          onStrategyChange={(value) =>
            setSelectedStrategy(
              value as React.ComponentProps<typeof BacktestingFilters>["selectedStrategy"],
            )
          }
          selectedStatuses={selectedStatuses}
          onStatusesChange={setSelectedStatuses}
          search={search}
          onSearchChange={setSearch}
          onClearAll={handleClearAll}
          hasActiveFilters={hasActiveFilters}
          topOffset={56}
        />

        {hasError ? (
          <ErrorState
            title={t("backtesting.error.title")}
            description={t("backtesting.error.description")}
            onRetry={() => {
              summary.refetch();
              readiness.refetch();
            }}
          />
        ) : (
          <BacktestingTable
            rows={filteredRows}
            isLoading={isLoading}
            sorting={sorting ?? []}
            onSortingChange={setSorting}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            onRowSelect={(row: BacktestRow) => setSelectedRowId(row.id)}
          />
        )}
      </div>

      <BacktestingDetailSheet
        open={Boolean(selectedRow)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRowId("");
            setSelectedRunId("");
          }
        }}
        row={selectedRow}
        recentRuns={recentRunsForSelected}
        thresholds={
          selectedRow
            ? thresholdsByStrategy.get(selectedRow.strategyName)
            : undefined
        }
        onRunSelect={(run) => setSelectedRunId(run.backtestId)}
      />

      <RunDetailSheet
        open={Boolean(selectedRun)}
        onOpenChange={(open) => {
          if (!open) setSelectedRunId("");
        }}
        run={selectedRun}
      />
    </>
  );
}

