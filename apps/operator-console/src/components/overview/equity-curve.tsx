'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useExecutionSummary } from '@/lib/hooks/use-execution-summary';
import { formatTimestamp, formatUsd } from '@/lib/format';
import { SectionCard } from '@/components/layout/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePreferences } from '@/components/providers/preferences-provider';

export function EquityCurve() {
  const { t } = usePreferences();
  const { data, isLoading, isError } = useExecutionSummary();

  const points = React.useMemo(() => {
    const trades = data?.recentTrades.filter((t) => t.realizedPnlUsd !== null) ?? [];
    if (trades.length === 0) return [];
    const sorted = [...trades].sort(
      (a, b) =>
        new Date(a.closedAt ?? a.openedAt).getTime() - new Date(b.closedAt ?? b.openedAt).getTime()
    );
    let running = 0;
    return sorted.map((trade) => {
      running += trade.realizedPnlUsd ?? 0;
      return {
        t: new Date(trade.closedAt ?? trade.openedAt).getTime(),
        equity: running,
      };
    });
  }, [data]);

  return (
    <SectionCard
      title={t('overview.equity_curve.title')}
      description={t('overview.equity_curve.description')}
      padding="default"
    >
      {isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : isError || points.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-[12px] text-[var(--color-fg-subtle)]">
          {isError ? t('overview.equity_curve.failed_to_load') : t('overview.equity_curve.empty')}
        </div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value) => formatTimestamp(value, { style: 'compact' })}
                stroke="var(--color-fg-subtle)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(value) => formatUsd(value, { compact: true })}
                stroke="var(--color-fg-subtle)"
                fontSize={11}
                width={56}
                tickLine={false}
                axisLine={false}
              />
              <RechartsTooltip
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12,
                }}
                labelFormatter={(value) => formatTimestamp(value as number, { style: 'full' })}
                formatter={(value: number) => [
                  formatUsd(value, { signed: true }),
                  t('overview.equity_curve.tooltip_label'),
                ]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="var(--color-accent)"
                strokeWidth={1.5}
                fill="url(#equityFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}
