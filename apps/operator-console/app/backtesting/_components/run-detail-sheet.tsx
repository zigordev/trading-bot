"use client";

import * as React from "react";

import { formatDuration, formatPercent, formatTimestamp } from "@/lib/format";
import type { RecentBacktestRun } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { DetailSheet } from "@/components/shared/detail-sheet";
import { IdCell } from "@/components/shared/id-cell";
import { ScoreCell } from "@/components/shared/score-cell";
import { SymbolAvatar } from "@/components/shared/symbol-avatar";
import { splitSymbol } from "@/lib/backtesting/derive-rows";

interface RunDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: RecentBacktestRun | null;
}

export function RunDetailSheet({ open, onOpenChange, run }: RunDetailSheetProps) {
  if (!run) return null;
  const { base, quote } = splitSymbol(run.symbol);
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={
        <div className="flex items-center gap-2">
          <SymbolAvatar baseAsset={base} quoteAsset={quote} size={24} />
          <div>
            <div className="text-[14px]">Backtest run</div>
            <div className="mt-0.5 text-[12px] font-normal text-[var(--color-fg-muted)]">
              {run.symbol} · {run.timeframeCode} · {run.strategyName}
            </div>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Score" value={<ScoreCell value={run.score} />} />
          <Stat label="Total PnL" value={<NumColored value={run.totalPnlPercent} suffix="%" signed />} />
          <Stat label="Equity PnL" value={<NumColored value={run.equityCurvePnlPercent} suffix="%" signed />} />
          <Stat label="Drawdown" value={<NumColored value={run.maxDrawdownPercent} suffix="%" />} />
          <Stat label="Trades" value={run.tradeCount.toLocaleString()} />
          <Stat label="Reversal ratio" value={run.reversalRatio.toFixed(2)} />
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
            Trade outcomes
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tag label="Stop loss" value={run.stopLossTradeCount} tone="danger" />
            <Tag label="Take profit" value={run.takeProfitTradeCount} tone="success" />
            <Tag label="Reversal" value={run.reversalTradeCount} tone="warning" />
            <Tag label="Window end" value={run.windowEndTradeCount} tone="default" />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
            Timing
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <Stat label="Finished" value={formatTimestamp(run.finishedAt, { style: "full" })} />
            <Stat label="Backtest duration" value={formatDuration(run.backtestDurationMs)} />
            <Stat label="Data fetch" value={formatDuration(run.dataRetrievalDurationMs)} />
            <Stat label="Replay klines" value={run.replayKlineCount.toLocaleString()} />
          </dl>
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
            Identifiers
          </h3>
          <dl className="space-y-2 text-[12px]">
            <Identifier label="Backtest ID" value={run.backtestId} />
            <Identifier label="Analysis setting" value={run.analysisSettingId} />
          </dl>
        </div>
      </div>
    </DetailSheet>
  );
}

function Stat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {label}
      </dt>
      <dd className="text-[13px] font-medium text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}

function NumColored({
  value,
  suffix,
  signed,
}: {
  value: number;
  suffix?: string;
  signed?: boolean;
}) {
  const tone =
    value > 0
      ? "text-[var(--color-success)]"
      : value < 0
        ? "text-[var(--color-danger)]"
        : "text-[var(--color-fg)]";
  const formatted = signed
    ? formatPercent(value, { signed: true, digits: 2 }).replace("%", "")
    : value.toFixed(2);
  return (
    <span className={`num ${tone}`}>{formatted}{suffix}</span>
  );
}

function Tag({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "success" | "warning" | "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
      <span className="text-[11px] text-[var(--color-fg-subtle)]">{label}</span>
      <Badge variant={tone === "default" ? "outline" : tone}>{value}</Badge>
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
