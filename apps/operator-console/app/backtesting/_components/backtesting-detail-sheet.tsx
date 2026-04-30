"use client";

import * as React from "react";
import { ExternalLink, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPercent, formatScore, formatTimestamp } from "@/lib/format";
import type { BacktestRow } from "@/lib/backtesting/types";
import {
  evaluateThresholds,
  type PromotionThresholds,
} from "@/lib/backtesting/derive-thresholds";
import type { RecentBacktestRun } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DetailSheet } from "@/components/shared/detail-sheet";
import {
  MetricGate,
  MetricGateLegend,
} from "@/components/shared/metric-gate";
import { ReadinessBar } from "@/components/shared/readiness-bar";
import { ScoreCell } from "@/components/shared/score-cell";
import { SymbolAvatar } from "@/components/shared/symbol-avatar";
import { ProgressCell } from "@/components/shared/progress-cell";

interface BacktestingDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: BacktestRow | null;
  recentRuns: RecentBacktestRun[];
  thresholds: PromotionThresholds | undefined;
  onRunSelect: (run: RecentBacktestRun) => void;
}

export function BacktestingDetailSheet({
  open,
  onOpenChange,
  row,
  recentRuns,
  thresholds,
  onRunSelect,
}: BacktestingDetailSheetProps) {
  if (!row) return null;
  const evals = evaluateThresholds(row.latestRun, thresholds);

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={
        <div className="flex items-center gap-2">
          <SymbolAvatar baseAsset={row.baseAsset} quoteAsset={row.quoteAsset} size={28} />
          <div>
            <div>{row.symbol}</div>
            <div className="text-[12px] font-normal text-[var(--color-fg-muted)]">
              {row.timeframeCode} · {row.strategyName}
            </div>
          </div>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] text-[var(--color-fg-subtle)]">
            {row.latestRun
              ? `Last run ${formatTimestamp(row.latestRun.finishedAt, { style: "relative" })}`
              : "No completed runs yet"}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button type="button" variant="outline" size="sm" disabled className="gap-1.5">
                    <Lock className="size-3.5" />
                    Promote to paper
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Promotion endpoint is not wired up yet — automatic promotion runs server-side.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button type="button" size="sm" disabled className="gap-1.5">
                    <Lock className="size-3.5" />
                    Promote to live
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Live promotion behind a control-plane feature flag.</TooltipContent>
            </Tooltip>
          </div>
        </div>
      }
    >
      <Tabs defaultValue="summary" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="thresholds">Thresholds</TabsTrigger>
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <SummaryGrid row={row} />
          {row.latestRun && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
                Latest run highlights
              </p>
              <RunSummary run={row.latestRun} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs">
          <RunsList
            runs={recentRuns}
            onRunSelect={onRunSelect}
          />
        </TabsContent>

        <TabsContent value="thresholds" className="space-y-3">
          <MetricGateLegend />
          {evals.length === 0 ? (
            <p className="text-[12px] text-[var(--color-fg-subtle)]">
              No completed runs yet to evaluate thresholds.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {evals.map((evaluation) => (
                <MetricGate
                  key={evaluation.key}
                  label={evaluation.label}
                  status={evaluation.status}
                  actual={evaluation.actual}
                  threshold={evaluation.threshold}
                  hint={evaluation.hint}
                />
              ))}
            </div>
          )}
          {!thresholds && (
            <p className="text-[11px] text-[var(--color-fg-subtle)]">
              No promotion thresholds configured for strategy{" "}
              <span className="font-mono">{row.strategyName}</span>.
            </p>
          )}
        </TabsContent>

        <TabsContent value="readiness">
          <ReadinessPanel row={row} />
        </TabsContent>
      </Tabs>
    </DetailSheet>
  );
}

function SummaryGrid({ row }: { row: BacktestRow }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <SummaryCell
        label="Status"
        value={
          <Badge
            variant={
              row.status === "ready"
                ? "success"
                : row.status === "partial"
                  ? "warning"
                  : row.status === "error"
                    ? "danger"
                    : "default"
            }
          >
            {row.status}
          </Badge>
        }
      />
      <SummaryCell
        label="Latest score"
        value={<ScoreCell value={row.latestRun?.score ?? null} history={row.scoreHistory} />}
      />
      <SummaryCell
        label="Kline coverage"
        value={
          <ReadinessBar
            ratio={row.klineCoverage !== null ? row.klineCoverage / 100 : null}
            status={row.status}
          />
        }
      />
      <SummaryCell
        label="Job progress"
        value={
          <ProgressCell
            total={row.progress.total}
            completed={row.progress.completed}
            running={row.progress.running}
            failed={row.progress.failed}
            pending={row.progress.queued}
            showCounts
          />
        }
      />
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {label}
      </p>
      <div className="mt-2">{value}</div>
    </div>
  );
}

function RunSummary({ run }: { run: RecentBacktestRun }) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
      <RunStat label="Total PnL" value={formatPercent(run.totalPnlPercent, { signed: true })} />
      <RunStat label="Equity PnL" value={formatPercent(run.equityCurvePnlPercent, { signed: true })} />
      <RunStat label="Drawdown" value={formatPercent(run.maxDrawdownPercent)} />
      <RunStat label="Reversal ratio" value={run.reversalRatio.toFixed(2)} />
      <RunStat label="Trades" value={run.tradeCount.toLocaleString()} />
      <RunStat label="Signals" value={run.signalCount.toLocaleString()} />
    </dl>
  );
}

function RunStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--color-fg-subtle)]">{label}</dt>
      <dd className="num font-medium text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}

function RunsList({
  runs,
  onRunSelect,
}: {
  runs: RecentBacktestRun[];
  onRunSelect: (run: RecentBacktestRun) => void;
}) {
  if (runs.length === 0) {
    return (
      <p className="text-[12px] text-[var(--color-fg-subtle)]">
        No recent runs available for this row.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      {runs.map((run) => (
        <li key={run.backtestId}>
          <button
            type="button"
            onClick={() => onRunSelect(run)}
            className={cn(
              "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-2)]",
            )}
          >
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-[var(--color-fg)]">
                {formatTimestamp(run.finishedAt, { style: "compact" })}
              </span>
              <span className="text-[11px] text-[var(--color-fg-subtle)]">
                PnL {formatPercent(run.totalPnlPercent, { signed: true })} ·{" "}
                {run.tradeCount.toLocaleString()} trades
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="num text-[12px] text-[var(--color-fg-muted)]">
                score {formatScore(run.score)}
              </span>
              <ExternalLink className="size-3.5 text-[var(--color-fg-subtle)]" />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ReadinessPanel({ row }: { row: BacktestRow }) {
  const dimensions = row.readiness?.klineDimensions ?? [];
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
          Klines
        </p>
        {dimensions.length > 0 ? (
          <ul className="space-y-2">
            {dimensions.map((dim) => (
              <li
                key={`${dim.timeframeCode}-${dim.rowCount}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2"
              >
                <span className="font-mono text-[12px] text-[var(--color-fg-muted)]">
                  {dim.timeframeCode}
                </span>
                <ReadinessBar
                  ratio={(dim.coveragePercent ?? 0) / 100}
                  status={dim.complete ? "ready" : "partial"}
                  rowCount={dim.rowCount}
                  className="max-w-[180px]"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-[var(--color-fg-subtle)]">No kline data reported.</p>
        )}
      </div>
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
          Trades
        </p>
        {row.tradesCoverage !== null ? (
          <ReadinessBar
            ratio={(row.tradesCoverage ?? 0) / 100}
            status={row.status}
            rowCount={row.tradesRowCount ?? undefined}
            className="max-w-[260px]"
          />
        ) : (
          <p className="text-[12px] text-[var(--color-fg-subtle)]">No trade data reported.</p>
        )}
      </div>
      {row.readiness?.details && (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[12px] text-[var(--color-fg-muted)]">
          {row.readiness.details}
        </p>
      )}
    </div>
  );
}
