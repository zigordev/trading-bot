"use client";

import * as React from "react";

import { ArrowDown, ArrowUp, Lock, LockOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatDuration,
  formatPercent,
  formatPrice,
  formatTimestamp,
  formatUsd,
} from "@/lib/format";
import type { ExecutionTrade } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { DetailSheet } from "@/components/shared/detail-sheet";
import { IdCell } from "@/components/shared/id-cell";
import { SymbolAvatar } from "@/components/shared/symbol-avatar";
import { splitSymbol } from "@/lib/backtesting/derive-rows";

interface TradeDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade: ExecutionTrade | null;
}

export function TradeDetailSheet({ open, onOpenChange, trade }: TradeDetailSheetProps) {
  if (!trade) return null;
  const { base, quote } = splitSymbol(trade.symbolCode);

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={
        <div className="flex items-center gap-2">
          <SymbolAvatar baseAsset={base} quoteAsset={quote} size={28} />
          <div>
            <div>{trade.symbolCode}</div>
            <div className="mt-0.5 text-[12px] font-normal text-[var(--color-fg-muted)]">
              {trade.timeframeCode} · {trade.strategyName}
            </div>
          </div>
        </div>
      }
      headerAccessory={
        <div className="flex items-center gap-1.5">
          <Badge
            variant={trade.side === "long" ? "success" : "danger"}
            className="gap-1"
          >
            {trade.side === "long" ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )}
            {trade.side === "long" ? "Long" : "Short"}
          </Badge>
          <Badge variant={statusVariant(trade.status)} className="gap-1">
            {trade.status === "open" ? (
              <LockOpen className="size-3" />
            ) : trade.status === "closed" ? (
              <Lock className="size-3" />
            ) : null}
            {trade.status}
          </Badge>
          <Badge variant={trade.mode === "live" ? "accent" : "outline"}>{trade.mode}</Badge>
        </div>
      }
    >
      <div className="space-y-4">
        <Section label="Performance">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label="Realized PnL %"
              value={
                <PnlCell
                  value={trade.realizedPnlPercent}
                  format={(v) => formatPercent(v, { signed: true, digits: 2 })}
                />
              }
            />
            <Stat
              label="Realized PnL $"
              value={
                <PnlCell
                  value={trade.realizedPnlUsd}
                  format={(v) => formatUsd(v, { signed: true })}
                />
              }
            />
            <Stat label="Fees" value={formatUsd(trade.feesUsd)} />
            <Stat label="Notional" value={formatUsd(trade.notionalUsd)} />
            <Stat label="Quantity" value={trade.quantity.toLocaleString()} />
            <Stat
              label="Duration"
              value={trade.durationMs !== null ? formatDuration(trade.durationMs) : "—"}
            />
          </div>
        </Section>

        <Section label="Prices">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Stat label="Entry" value={formatPrice(trade.entryPrice)} />
            <Stat
              label="Exit"
              value={trade.exitPrice !== null ? formatPrice(trade.exitPrice) : "—"}
            />
            <Stat
              label="Stop loss"
              value={trade.stopLossPrice !== null ? formatPrice(trade.stopLossPrice) : "—"}
            />
            <Stat
              label="Take profit"
              value={trade.takeProfitPrice !== null ? formatPrice(trade.takeProfitPrice) : "—"}
            />
          </div>
        </Section>

        <Section label="Timing">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <Stat label="Opened" value={formatTimestamp(trade.openedAt, { style: "full" })} />
            <Stat
              label="Closed"
              value={
                trade.closedAt
                  ? formatTimestamp(trade.closedAt, { style: "full" })
                  : "—"
              }
            />
            <Stat label="Close reason" value={trade.closeReason ?? "—"} />
            <Stat
              label="Execution settings"
              value={trade.executionSettingsName ?? "—"}
            />
          </dl>
        </Section>

        <Section label="References">
          <dl className="space-y-2 text-[12px]">
            <Identifier label="Trade ID" value={trade.tradeId} />
            {trade.externalOrderId && (
              <Identifier label="External order ID" value={trade.externalOrderId} />
            )}
            {trade.positionId && (
              <Identifier label="Position ID" value={trade.positionId} />
            )}
            <Identifier label="Analysis setting" value={trade.analysisSettingId} />
            {trade.sourceBacktestId && (
              <Identifier label="Source backtest" value={trade.sourceBacktestId} />
            )}
            <KeyValue label="Risk profile" value={trade.riskProfileName} />
          </dl>
        </Section>
      </div>
    </DetailSheet>
  );
}

function statusVariant(
  status: ExecutionTrade["status"],
): "open" | "closed" | "default" | "danger" {
  switch (status) {
    case "open":
      return "open";
    case "closed":
      return "closed";
    case "rejected":
      return "danger";
    default:
      return "default";
  }
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {label}
      </h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">{label}</dt>
      <dd className="num text-[13px] font-medium text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}

function PnlCell({
  value,
  format,
}: {
  value: number | null;
  format: (v: number) => string;
}) {
  if (value === null) return <span className="text-[var(--color-fg-subtle)]">—</span>;
  const tone =
    value > 0
      ? "text-[var(--color-success-fg)]"
      : value < 0
        ? "text-[var(--color-danger-fg)]"
        : "text-[var(--color-fg)]";
  return <span className={cn("num", tone)}>{format(value)}</span>;
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

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-fg-subtle)]">{label}</dt>
      <dd className="text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}
