"use client";

import * as React from "react";
import { Activity, BarChart3, DollarSign, Gauge } from "lucide-react";

import { formatPercent, formatUsd } from "@/lib/format";
import { useBacktestsSummary } from "@/lib/hooks/use-backtests-summary";
import { useDataReadiness } from "@/lib/hooks/use-data-readiness";
import { useExecutionSummary } from "@/lib/hooks/use-execution-summary";
import { KpiTile } from "@/components/shared/kpi-tile";
import { PairLabel } from "@/components/shared/symbol-avatar";

function readinessRatio(items: { kline?: { coveragePercent?: number } | null }[] | undefined): number | null {
  if (!items || items.length === 0) return null;
  let total = 0;
  let count = 0;
  for (const item of items) {
    const pct = item.kline?.coveragePercent;
    if (typeof pct === "number") {
      total += pct;
      count += 1;
    }
  }
  return count === 0 ? null : total / count;
}

export function OverviewKpiStrip() {
  const execution = useExecutionSummary();
  const backtests = useBacktestsSummary();
  const readiness = useDataReadiness();

  const realizedPnl = execution.data?.totals.realizedPnlUsd ?? null;
  const openPositions = execution.data?.totals.openTradeCount ?? 0;
  const activePromotions = execution.data?.activePromotions.length ?? 0;
  const recentScores = backtests.data?.recentRuns.slice(0, 14).map((r) => r.score).reverse() ?? [];
  const readinessPct = readinessRatio(readiness.data?.items);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        label="Realized PnL"
        value={formatUsd(realizedPnl, { signed: true })}
        tone={realizedPnl !== null && realizedPnl >= 0 ? "success" : "danger"}
        loading={execution.isLoading}
        hint={`${execution.data?.totals.recentTradeCount ?? 0} trades · 24h`}
        icon={<DollarSign className="size-4" />}
      />
      <KpiTile
        label="Open positions"
        value={openPositions.toLocaleString()}
        hint={`${execution.data?.totals.closedTradeCount ?? 0} closed today`}
        loading={execution.isLoading}
        icon={<Activity className="size-4" />}
      />
      <KpiTile
        label="Active promotions"
        value={activePromotions.toLocaleString()}
        hint={
          execution.data?.activePromotion?.symbolCode ? (
            <PairLabel
              code={execution.data.activePromotion.symbolCode}
              size={16}
              textClassName="text-[12px] text-[var(--color-fg-subtle)]"
            />
          ) : (
            "—"
          )
        }
        tone="accent"
        loading={execution.isLoading}
        icon={<BarChart3 className="size-4" />}
        spark={recentScores.length > 1 ? recentScores : undefined}
      />
      <KpiTile
        label="Data readiness"
        value={readinessPct !== null ? formatPercent(readinessPct, { digits: 1 }) : "—"}
        hint={`${readiness.data?.items.length ?? 0} pair×timeframe`}
        tone={
          readinessPct === null
            ? "default"
            : readinessPct >= 99
              ? "success"
              : readinessPct >= 95
                ? "warning"
                : "danger"
        }
        loading={readiness.isLoading}
        icon={<Gauge className="size-4" />}
      />
    </div>
  );
}
