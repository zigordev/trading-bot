"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";
import { DataTable } from "@/components/data-table/data-table";
import { DetailSheet } from "@/components/shared/detail-sheet";
import { IdCell } from "@/components/shared/id-cell";
import { SymbolAvatar } from "@/components/shared/symbol-avatar";
import { useExecutionSummary } from "@/lib/hooks/use-execution-summary";
import { formatTimestamp } from "@/lib/format";
import { splitSymbol } from "@/lib/backtesting/derive-rows";
import { useEnumState, useSelectedRow } from "@/lib/url-state";
import type { ExecutionPromotion } from "@/lib/api";

export default function PromotionsPage() {
  return (
    <React.Suspense fallback={null}>
      <PromotionsPageInner />
    </React.Suspense>
  );
}

function PromotionsPageInner() {
  const summary = useExecutionSummary();
  const [filter, setFilter] = useEnumState(
    "view",
    ["active", "all"] as const,
    "active",
  );
  const [selectedId, setSelectedId] = useSelectedRow();

  const promotions = React.useMemo(() => {
    const list = summary.data?.activePromotions ?? [];
    if (filter === "active") {
      return list.filter((promotion) => promotion.status === "active");
    }
    return list;
  }, [summary.data, filter]);

  const selected = React.useMemo<ExecutionPromotion | null>(() => {
    if (!selectedId) return null;
    return (
      summary.data?.activePromotions.find((p) => p.promotionId === selectedId) ??
      null
    );
  }, [summary.data, selectedId]);

  const columns = React.useMemo<ColumnDef<ExecutionPromotion, unknown>[]>(
    () => [
      {
        id: "symbol",
        accessorKey: "symbolCode",
        header: "Pair",
        meta: { sticky: "left" },
        cell: ({ row }) => {
          const { base, quote } = splitSymbol(row.original.symbolCode);
          return (
            <div className="flex items-center gap-2">
              <SymbolAvatar baseAsset={base} quoteAsset={quote} size={22} />
              <div className="flex flex-col leading-tight">
                <span className="font-medium text-[var(--color-fg)]">
                  {row.original.symbolCode}
                </span>
                <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
                  {row.original.timeframeCode}
                </span>
              </div>
            </div>
          );
        },
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
        id: "mode",
        accessorKey: "mode",
        header: "Mode",
        cell: ({ row }) => (
          <Badge variant={row.original.mode === "live" ? "accent" : "outline"}>
            {row.original.mode}
          </Badge>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === "active" ? "success" : "default"}
          >
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "executionSettings",
        accessorKey: "executionSettingsName",
        header: "Execution settings",
        meta: { hideOnNarrow: true },
        cell: ({ row }) => (
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            {row.original.executionSettingsName}
          </span>
        ),
      },
      {
        id: "riskProfile",
        accessorKey: "riskProfileName",
        header: "Risk profile",
        meta: { hideOnNarrow: true },
        cell: ({ row }) => (
          <span className="text-[12px] text-[var(--color-fg-muted)]">
            {row.original.riskProfileName}
          </span>
        ),
      },
      {
        id: "selection",
        accessorKey: "selectionValue",
        header: "Selection",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="num text-[12px]">
            {row.original.selectionValue.toFixed(2)}
          </span>
        ),
      },
      {
        id: "promotedAt",
        accessorKey: "promotedAt",
        header: "Promoted",
        cell: ({ row }) => (
          <span className="num text-[12px] text-[var(--color-fg-muted)]">
            {formatTimestamp(row.original.promotedAt, { style: "compact" })}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        meta: { align: "right" },
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedId(row.original.promotionId);
            }}
            aria-label="Open promotion details"
            className="text-[var(--color-fg-subtle)]"
          >
            <ChevronRight />
          </Button>
        ),
      },
    ],
    [setSelectedId],
  );

  return (
    <AppShell>
      <PageHeader
        title="Promotions"
        actions={
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/execution">
              <ArrowLeft className="size-3.5" />
              Back to trades
            </Link>
          </Button>
        }
        meta={
          <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
            <FilterButton
              active={filter === "active"}
              onClick={() => setFilter("active")}
            >
              Active
            </FilterButton>
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
              All history
            </FilterButton>
          </div>
        }
      />

      {summary.isError ? (
        <ErrorState
          title="Failed to load promotions"
          description="The execution summary endpoint returned an error."
          onRetry={() => summary.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          data={promotions}
          rowKey={(row) => row.promotionId}
          isLoading={summary.isLoading}
          onRowClick={(row) => setSelectedId(row.promotionId)}
          empty="No promotions yet."
          pageSize={25}
        />
      )}

      <DetailSheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedId("");
        }}
        size="md"
        title={
          selected ? (
            <div className="flex items-center gap-2">
              <SymbolAvatar
                baseAsset={splitSymbol(selected.symbolCode).base}
                quoteAsset={splitSymbol(selected.symbolCode).quote}
                size={28}
              />
              <div>
                <div>{selected.symbolCode}</div>
                <div className="mt-0.5 text-[12px] font-normal text-[var(--color-fg-muted)]">
                  {selected.timeframeCode} · {selected.strategyName}
                </div>
              </div>
            </div>
          ) : (
            "Promotion"
          )
        }
        headerAccessory={
          selected ? (
            <div className="flex items-center gap-1.5">
              <Badge variant={selected.mode === "live" ? "accent" : "outline"}>
                {selected.mode}
              </Badge>
              <Badge
                variant={selected.status === "active" ? "success" : "default"}
              >
                {selected.status}
              </Badge>
            </div>
          ) : null
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Selection value" value={selected.selectionValue.toFixed(2)} />
              <Stat
                label="Promoted at"
                value={formatTimestamp(selected.promotedAt, { style: "full" })}
              />
              <Stat label="Execution settings" value={selected.executionSettingsName} />
              <Stat label="Risk profile" value={selected.riskProfileName} />
            </div>

            <div className="space-y-2">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
                Identifiers
              </h3>
              <dl className="space-y-2 text-[12px]">
                <Identifier label="Promotion ID" value={selected.promotionId} />
                <Identifier
                  label="Analysis setting"
                  value={selected.analysisSettingId}
                />
                {selected.sourceBacktestId && (
                  <Identifier
                    label="Source backtest"
                    value={selected.sourceBacktestId}
                  />
                )}
              </dl>
            </div>
          </div>
        )}
      </DetailSheet>
    </AppShell>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[var(--radius-sm)] px-2.5 py-1 text-[12px] ${
        active
          ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
          : "text-[var(--color-fg-subtle)]"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {label}
      </dt>
      <dd className="text-[13px] font-medium text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}

function Identifier({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-fg-subtle)]">{label}</dt>
      <dd>
        <IdCell value={value} head={8} tail={6} />
      </dd>
    </div>
  );
}
