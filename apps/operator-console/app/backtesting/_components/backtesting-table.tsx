"use client";

import * as React from "react";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { DataTable } from "@/components/data-table/data-table";
import { ProgressCell } from "@/components/shared/progress-cell";
import { ReadinessBar } from "@/components/shared/readiness-bar";
import { ScoreCell } from "@/components/shared/score-cell";
import { SymbolAvatar } from "@/components/shared/symbol-avatar";
import type { BacktestRow, RowStatus } from "@/lib/backtesting/types";

const STATUS_VARIANT: Record<RowStatus, "success" | "warning" | "default" | "danger"> = {
  ready: "success",
  partial: "warning",
  missing: "default",
  error: "danger",
};

const STATUS_LABEL: Record<RowStatus, string> = {
  ready: "Ready",
  partial: "Partial",
  missing: "Missing",
  error: "Error",
};

interface BacktestingTableProps {
  rows: BacktestRow[];
  isLoading?: boolean;
  sorting: SortingState;
  onSortingChange: (next: SortingState) => void;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (next: VisibilityState) => void;
  onRowSelect: (row: BacktestRow) => void;
  toolbar?: React.ReactNode;
}

export function BacktestingTable({
  rows,
  isLoading,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  onRowSelect,
  toolbar,
}: BacktestingTableProps) {
  const columns = React.useMemo<ColumnDef<BacktestRow, unknown>[]>(
    () => [
      {
        id: "symbol",
        accessorKey: "symbol",
        header: "Pair",
        meta: { sticky: "left" },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <SymbolAvatar
              baseAsset={row.original.baseAsset}
              quoteAsset={row.original.quoteAsset}
              size={24}
            />
            <span className="font-medium text-[var(--color-fg)]">{row.original.symbol}</span>
          </div>
        ),
      },
      {
        id: "timeframe",
        accessorKey: "timeframeCode",
        header: "TF",
        meta: { align: "right", cellClassName: "font-mono text-[12px]" },
      },
      {
        id: "strategy",
        accessorKey: "strategyName",
        header: "Strategy",
        cell: ({ row }) => (
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            {row.original.strategyName}
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]}>
            {STATUS_LABEL[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "kline",
        accessorFn: (row) => row.klineCoverage ?? 0,
        header: "Klines",
        meta: { hideOnNarrow: true },
        cell: ({ row }) => {
          const coverage = row.original.klineCoverage;
          const worst = row.original.klineWorstDimension;
          if (worst && row.original.readiness?.klineDimensions?.length) {
            return (
              <HoverCard>
                <HoverCardTrigger asChild>
                  <div>
                    <ReadinessBar
                      ratio={worst.coverage / 100}
                      status={row.original.status}
                      rowCount={row.original.klineRowCount ?? undefined}
                    />
                  </div>
                </HoverCardTrigger>
                <HoverCardContent align="start" className="w-72">
                  <p className="mb-2 text-[12px] font-medium text-[var(--color-fg)]">
                    Per-timeframe kline coverage
                  </p>
                  <ul className="space-y-1.5">
                    {row.original.readiness?.klineDimensions?.map((dim) => (
                      <li
                        key={`${dim.timeframeCode}-${dim.rowCount}`}
                        className="flex items-center justify-between gap-3 text-[12px]"
                      >
                        <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">
                          {dim.timeframeCode}
                        </span>
                        <span className="num text-[var(--color-fg)]">
                          {formatPercent(dim.coveragePercent ?? 0, { digits: 1 })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </HoverCardContent>
              </HoverCard>
            );
          }
          return (
            <ReadinessBar
              ratio={typeof coverage === "number" ? coverage / 100 : null}
              status={row.original.status}
              rowCount={row.original.klineRowCount ?? undefined}
            />
          );
        },
      },
      {
        id: "trades",
        accessorFn: (row) => row.tradesCoverage ?? 0,
        header: "Trades",
        meta: { hideOnNarrow: true },
        cell: ({ row }) => {
          const coverage = row.original.tradesCoverage;
          if (coverage === null || row.original.tradesRowCount === null) {
            return <span className="text-[var(--color-fg-subtle)]">—</span>;
          }
          return (
            <ReadinessBar
              ratio={coverage / 100}
              status={row.original.status}
              rowCount={row.original.tradesRowCount}
            />
          );
        },
      },
      {
        id: "progress",
        accessorFn: (row) => row.progress.progressPercent,
        header: "Progress",
        cell: ({ row }) => (
          <ProgressCell
            total={row.original.progress.total}
            completed={row.original.progress.completed}
            running={row.original.progress.running}
            failed={row.original.progress.failed}
            pending={row.original.progress.queued}
          />
        ),
      },
      {
        id: "score",
        accessorFn: (row) => row.latestRun?.score ?? 0,
        header: "Score",
        meta: { align: "right" },
        cell: ({ row }) => (
          <ScoreCell value={row.original.latestRun?.score ?? null} history={row.original.scoreHistory} />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={(event) => {
                event.stopPropagation();
                onRowSelect(row.original);
              }}
              aria-label="Open details"
              className="text-[var(--color-fg-subtle)]"
            >
              <ChevronRight />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={(event) => event.stopPropagation()}
              aria-label="More actions"
              className="text-[var(--color-fg-subtle)]"
            >
              <MoreHorizontal />
            </Button>
          </div>
        ),
      },
    ],
    [onRowSelect],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(row) => row.id}
      isLoading={isLoading}
      onRowClick={onRowSelect}
      rowClassName={(row) => cn(row.progress.running > 0 && "bg-[var(--color-accent-bg)]/30")}
      state={{
        sorting,
        onSortingChange,
        columnVisibility,
        onColumnVisibilityChange,
      }}
      toolbar={toolbar}
      empty="No backtests match the current filters."
      pageSize={25}
    />
  );
}
