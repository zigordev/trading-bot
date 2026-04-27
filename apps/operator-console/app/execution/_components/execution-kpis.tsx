"use client";

import * as React from "react";
import { Activity, Coins, Repeat, Target } from "lucide-react";

import { formatPercent, formatUsd } from "@/lib/format";
import type { ExecutionTrade } from "@/lib/api";
import { useExecutionSummary } from "@/lib/hooks/use-execution-summary";
import { KpiTile } from "@/components/shared/kpi-tile";

function pickRecentTrades(trades: ExecutionTrade[], mode: "paper" | "live"): ExecutionTrade[] {
  return trades.filter((trade) => trade.mode === mode);
}

function winRate(trades: ExecutionTrade[]): number | null {
  const closed = trades.filter((t) => t.realizedPnlUsd !== null);
  if (closed.length === 0) return null;
  const wins = closed.filter((t) => (t.realizedPnlUsd ?? 0) > 0).length;
  return (wins / closed.length) * 100;
}

interface ExecutionKpisProps {
  mode: "paper" | "live";
  realizedPnl: number | null;
  filteredCount: number;
  loading?: boolean;
}

export function ExecutionKpis({ mode, realizedPnl, filteredCount, loading }: ExecutionKpisProps) {
  const summary = useExecutionSummary();
  const recent = pickRecentTrades(summary.data?.recentTrades ?? [], mode);
  const win = winRate(recent.slice(0, 50));
  const open = summary.data?.totals.openTradeCount ?? 0;
  const recent24 = summary.data?.totals.recentTradeCount ?? 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        label="Realized PnL (filtered)"
        value={formatUsd(realizedPnl, { signed: true })}
        tone={
          realizedPnl === null ? "default" : realizedPnl >= 0 ? "success" : "danger"
        }
        loading={loading}
        hint={`${filteredCount.toLocaleString()} trades`}
        icon={<Coins className="size-4" />}
      />
      <KpiTile
        label="Open positions"
        value={open.toLocaleString()}
        loading={summary.isLoading}
        icon={<Activity className="size-4" />}
        tone={open > 0 ? "accent" : "default"}
      />
      <KpiTile
        label="Recent trades · 24h"
        value={recent24.toLocaleString()}
        loading={summary.isLoading}
        icon={<Repeat className="size-4" />}
      />
      <KpiTile
        label="Win rate · last 50"
        value={win === null ? "—" : formatPercent(win, { digits: 1 })}
        loading={summary.isLoading}
        icon={<Target className="size-4" />}
        tone={win === null ? "default" : win >= 50 ? "success" : "warning"}
      />
    </div>
  );
}
