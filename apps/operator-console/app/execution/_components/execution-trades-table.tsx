"use client";

import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronRight, Lock, LockOpen } from "lucide-react";
import * as React from "react";

import { DataTable } from "@/components/data-table/data-table";
import { SymbolAvatar } from "@/components/shared/symbol-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExecutionTrade } from "@/lib/api";
import { splitSymbol } from "@/lib/backtesting/derive-rows";
import { formatPercent, formatPrice, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/components/providers/preferences-provider";

const STATUS_VARIANT: Record<
  ExecutionTrade["status"],
  "open" | "closed" | "default" | "danger"
> = {
  open: "open",
  closed: "closed",
  cancelled: "default",
  rejected: "danger",
};

const STATUS_LABEL_KEY: Record<ExecutionTrade["status"], string> = {
  open: "status.trade_status.open",
  closed: "status.trade_status.closed",
  cancelled: "status.trade_status.cancelled",
  rejected: "status.trade_status.rejected",
};

const SIDE_VARIANT: Record<ExecutionTrade["side"], "success" | "danger"> = {
  long: "success",
  short: "danger",
};

interface ExecutionTradesTableProps {
  trades: ExecutionTrade[];
  totalCount: number;
  pageIndex: number;
  pageSize: number;
  onPaginationChange: (next: { pageIndex: number; pageSize: number }) => void;
  isLoading?: boolean;
  sorting: SortingState;
  onSortingChange: (next: SortingState) => void;
  onRowSelect: (trade: ExecutionTrade) => void;
  toolbar?: React.ReactNode;
}

export function ExecutionTradesTable({
  trades,
  totalCount,
  pageIndex,
  pageSize,
  onPaginationChange,
  isLoading,
  sorting,
  onSortingChange,
  onRowSelect,
  toolbar,
}: ExecutionTradesTableProps) {
  const { t } = usePreferences();
  const columns = React.useMemo<ColumnDef<ExecutionTrade, unknown>[]>(
    () => [
      {
        id: "symbolCode",
        accessorKey: "symbolCode",
        header: t("execution.trades_table.pair_header"),
        meta: { sticky: "left" },
        cell: ({ row }) => {
          const { base, quote } = splitSymbol(row.original.symbolCode);
          return (
            <div className="flex items-center gap-2">
              <SymbolAvatar baseAsset={base} quoteAsset={quote} size={22} />
              <div className="flex flex-col leading-tight">
                <span className="font-medium text-[var(--color-fg)]">{row.original.symbolCode}</span>
                <span className="text-[11px] font-mono text-[var(--color-fg-subtle)]">
                  {row.original.timeframeCode}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: "side",
        accessorKey: "side",
        header: t("execution.trades_table.side_header"),
        enableSorting: false,
        cell: ({ row }) => {
          const isLong = row.original.side === "long";
          const Icon = isLong ? ArrowUp : ArrowDown;
          return (
            <Badge variant={SIDE_VARIANT[row.original.side]} className="gap-1">
              <Icon className="size-3" />
              {t(isLong ? "status.trade_side.long" : "status.trade_side.short")}
            </Badge>
          );
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: t("execution.trades_table.status_header"),
        enableSorting: false,
        cell: ({ row }) => {
          const status = row.original.status;
          const Icon =
            status === "open" ? LockOpen : status === "closed" ? Lock : null;
          return (
            <Badge variant={STATUS_VARIANT[status]} className="gap-1">
              {Icon ? <Icon className="size-3" /> : null}
              {t(STATUS_LABEL_KEY[status])}
            </Badge>
          );
        },
      },
      {
        id: "strategy",
        accessorKey: "strategyName",
        header: t("execution.trades_table.strategy_header"),
        enableSorting: false,
        meta: { hideOnNarrow: true },
        cell: ({ row }) => (
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            {row.original.strategyName}
          </span>
        ),
      },
      {
        id: "openedAt",
        accessorKey: "openedAt",
        header: t("execution.trades_table.opened_header"),
        cell: ({ row }) => (
          <span className="num text-[12px] text-[var(--color-fg-muted)]">
            {formatTimestamp(row.original.openedAt, { style: "compact" })}
          </span>
        ),
      },
      {
        id: "closedAt",
        accessorKey: "closedAt",
        header: t("execution.trades_table.closed_header"),
        meta: { hideOnNarrow: true },
        cell: ({ row }) =>
          row.original.closedAt ? (
            <span className="num text-[12px] text-[var(--color-fg-muted)]">
              {formatTimestamp(row.original.closedAt, { style: "compact" })}
            </span>
          ) : (
            <span className="text-[12px] text-[var(--color-fg-subtle)]">—</span>
          ),
      },
      {
        id: "entryPrice",
        accessorKey: "entryPrice",
        header: t("execution.trades_table.entry_header"),
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="num text-[12px]">{formatPrice(row.original.entryPrice)}</span>
        ),
      },
      {
        id: "exitPrice",
        accessorKey: "exitPrice",
        header: t("execution.trades_table.exit_header"),
        enableSorting: false,
        meta: { align: "right", hideOnNarrow: true },
        cell: ({ row }) =>
          row.original.exitPrice !== null ? (
            <span className="num text-[12px]">{formatPrice(row.original.exitPrice)}</span>
          ) : (
            <span className="text-[12px] text-[var(--color-fg-subtle)]">—</span>
          ),
      },
      {
        id: "realizedPnlPercent",
        accessorKey: "realizedPnlPercent",
        header: t("execution.trades_table.pnl_percent_header"),
        meta: { align: "right" },
        cell: ({ row }) => {
          const pnl = row.original.realizedPnlPercent;
          if (pnl === null) {
            return <span className="text-[12px] text-[var(--color-fg-subtle)]">—</span>;
          }
          const tone =
            pnl > 0
              ? "text-[var(--color-success-fg)]"
              : pnl < 0
                ? "text-[var(--color-danger-fg)]"
                : "text-[var(--color-fg)]";
          return (
            <span className={cn("num text-[12px] font-medium", tone)}>
              {formatPercent(pnl, { signed: true, digits: 2 })}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={(event) => {
              event.stopPropagation();
              onRowSelect(row.original);
            }}
            aria-label={t("execution.trades_table.open_details_aria")}
            className="text-[var(--color-fg-subtle)]"
          >
            <ChevronRight />
          </Button>
        ),
      },
    ],
    [onRowSelect, t],
  );

  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <DataTable
      columns={columns}
      data={trades}
      rowKey={(row) => row.tradeId}
      isLoading={isLoading}
      onRowClick={onRowSelect}
      manualPagination
      pageCount={pageCount}
      pageIndex={pageIndex}
      pageSize={pageSize}
      onPaginationChange={onPaginationChange}
      state={{
        sorting,
        onSortingChange,
      }}
      toolbar={toolbar}
      empty={t("execution.trades_table.empty_state")}
    />
  );
}
