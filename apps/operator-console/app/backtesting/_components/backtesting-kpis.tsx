"use client";

import * as React from "react";
import {
  CircleDot,
  GaugeCircle,
  Hourglass,
  Trophy,
} from "lucide-react";

import { formatPercent, formatScore, formatTimestamp } from "@/lib/format";
import type { BacktestRow } from "@/lib/backtesting/types";
import { KpiTile } from "@/components/shared/kpi-tile";
import { usePreferences } from "@/components/providers/preferences-provider";

interface BacktestingKpisProps {
  rows: BacktestRow[];
  loading?: boolean;
}

export function BacktestingKpis({ rows, loading }: BacktestingKpisProps) {
  const { t } = usePreferences();
  const total = rows.length;
  const ready = rows.filter((row) => (row.klineCoverage ?? 0) >= 99).length;
  const running = rows.reduce((sum, row) => sum + row.progress.running, 0);
  const queued = rows.reduce((sum, row) => sum + row.progress.queued, 0);

  const lastRunRow = React.useMemo(() => {
    return rows
      .filter((row) => row.latestRun)
      .sort(
        (a, b) =>
          new Date(b.latestRun!.finishedAt).getTime() -
          new Date(a.latestRun!.finishedAt).getTime(),
      )[0];
  }, [rows]);

  const recent = React.useMemo(() => {
    return rows
      .map((row) => row.latestRun)
      .filter((run): run is NonNullable<typeof run> => Boolean(run))
      .sort(
        (a, b) =>
          new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime(),
      )
      .slice(0, 20);
  }, [rows]);

  const avgScore =
    recent.length === 0
      ? null
      : recent.reduce((sum, run) => sum + (run.score ?? 0), 0) / recent.length;

  const spark = recent
    .map((run) => run.score)
    .reverse()
    .filter((value): value is number => typeof value === "number");

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        label={t("backtesting.kpis.rows_ready.label")}
        value={`${ready}/${total}`}
        hint={t("backtesting.kpis.rows_ready.hint")}
        tone={total === 0 ? "default" : ready === total ? "success" : "warning"}
        loading={loading}
        icon={<GaugeCircle className="size-4" />}
      />
      <KpiTile
        label={t("backtesting.kpis.running.label")}
        value={running.toLocaleString()}
        hint={t("backtesting.kpis.running.hint", { queued })}
        tone={running > 0 ? "accent" : "default"}
        loading={loading}
        icon={<CircleDot className="size-4" />}
      />
      <KpiTile
        label={t("backtesting.kpis.last_completed.label")}
        value={
          lastRunRow?.latestRun
            ? formatTimestamp(lastRunRow.latestRun.finishedAt, { style: "relative" })
            : "—"
        }
        hint={
          lastRunRow
            ? `${lastRunRow.symbol} · ${lastRunRow.timeframeCode}`
            : undefined
        }
        loading={loading}
        icon={<Hourglass className="size-4" />}
      />
      <KpiTile
        label={t("backtesting.kpis.avg_score.label", { count: 20 })}
        value={formatScore(avgScore)}
        hint={
          avgScore !== null && lastRunRow?.latestRun
            ? t("backtesting.kpis.avg_score.hint", {
                value: formatPercent(lastRunRow.latestRun.totalPnlPercent, { signed: true }),
              })
            : undefined
        }
        spark={spark.length > 1 ? spark : undefined}
        tone="accent"
        loading={loading}
        icon={<Trophy className="size-4" />}
      />
    </div>
  );
}
