'use client';

import * as React from 'react';
import { Activity, BarChart3, DollarSign, Gauge } from 'lucide-react';

import { formatPercent, formatUsd } from '@/lib/format';
import { useBacktestsSummary } from '@/lib/hooks/use-backtests-summary';
import { useDataReadiness } from '@/lib/hooks/use-data-readiness';
import { useExecutionSummary } from '@/lib/hooks/use-execution-summary';
import { KpiTile } from '@/components/shared/kpi-tile';
import { PairLabel } from '@/components/shared/symbol-avatar';
import { usePreferences } from '@/components/providers/preferences-provider';

function readinessRatio(
  items: { kline?: { coveragePercent?: number } | null }[] | undefined
): number | null {
  if (!items || items.length === 0) return null;
  let total = 0;
  let count = 0;
  for (const item of items) {
    const pct = item.kline?.coveragePercent;
    if (typeof pct === 'number') {
      total += pct;
      count += 1;
    }
  }
  return count === 0 ? null : total / count;
}

export function OverviewKpiStrip() {
  const { t } = usePreferences();
  const execution = useExecutionSummary();
  const backtests = useBacktestsSummary();
  const readiness = useDataReadiness();

  const realizedPnl = execution.data?.totals.realizedPnlUsd ?? null;
  const openPositions = execution.data?.totals.openTradeCount ?? 0;
  const activePromotions = execution.data?.activePromotions.length ?? 0;
  const recentScores =
    backtests.data?.recentRuns
      .slice(0, 14)
      .map((r) => r.score)
      .reverse() ?? [];
  const readinessPct = readinessRatio(readiness.data?.items);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        label={t('overview.kpi.realized_pnl')}
        value={formatUsd(realizedPnl, { signed: true })}
        tone={realizedPnl !== null && realizedPnl >= 0 ? 'success' : 'danger'}
        loading={execution.isLoading}
        hint={t('overview.kpi.trades_24h', {
          count: execution.data?.totals.recentTradeCount ?? 0,
        })}
        icon={<DollarSign className="size-4" />}
      />
      <KpiTile
        label={t('overview.kpi.open_positions')}
        value={openPositions.toLocaleString()}
        hint={t('overview.kpi.closed_today', {
          count: execution.data?.totals.closedTradeCount ?? 0,
        })}
        loading={execution.isLoading}
        icon={<Activity className="size-4" />}
      />
      <KpiTile
        label={t('overview.kpi.active_promotions')}
        value={activePromotions.toLocaleString()}
        hint={
          execution.data?.activePromotion?.symbolCode ? (
            <PairLabel
              code={execution.data.activePromotion.symbolCode}
              size={16}
              textClassName="text-[12px] text-[var(--color-fg-subtle)]"
            />
          ) : (
            '—'
          )
        }
        tone="accent"
        loading={execution.isLoading}
        icon={<BarChart3 className="size-4" />}
        spark={recentScores.length > 1 ? recentScores : undefined}
      />
      <KpiTile
        label={t('overview.kpi.data_readiness')}
        value={readinessPct !== null ? formatPercent(readinessPct, { digits: 1 }) : '—'}
        hint={t('overview.kpi.pair_timeframe', {
          count: readiness.data?.items.length ?? 0,
        })}
        tone={
          readinessPct === null
            ? 'default'
            : readinessPct >= 99
              ? 'success'
              : readinessPct >= 95
                ? 'warning'
                : 'danger'
        }
        loading={readiness.isLoading}
        icon={<Gauge className="size-4" />}
      />
    </div>
  );
}
