'use client';

import * as React from 'react';

import { useBacktestsSummary } from '@/lib/hooks/use-backtests-summary';
import { formatPercent } from '@/lib/format';
import { SectionCard } from '@/components/layout/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScoreCell } from '@/components/shared/score-cell';
import { SymbolAvatar } from '@/components/shared/symbol-avatar';
import { splitSymbol } from '@/lib/backtesting/derive-rows';
import { usePreferences } from '@/components/providers/preferences-provider';

export function TopPerformers() {
  const { t } = usePreferences();
  const { data, isLoading, isError } = useBacktestsSummary();

  const top = React.useMemo(() => {
    return [...(data?.latestRuns ?? [])]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 8);
  }, [data]);

  return (
    <SectionCard
      title={t('overview.top_performers.title')}
      description={t('overview.top_performers.description')}
      padding="default"
      bodyClassName="p-0"
    >
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : isError || top.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12px] text-[var(--color-fg-subtle)]">
          {t('overview.top_performers.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {top.map((run) => {
            const { base, quote } = splitSymbol(run.symbol);
            return (
              <li
                key={`${run.symbol}-${run.timeframeCode}-${run.strategyName}`}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <SymbolAvatar baseAsset={base} quoteAsset={quote} size={26} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-[var(--color-fg)]">
                    {run.symbol}
                  </span>
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">
                    {run.timeframeCode} · {run.strategyName}
                  </span>
                </div>
                <span className="num text-right text-[12px] text-[var(--color-fg-muted)]">
                  {formatPercent(run.totalPnlPercent, { signed: true })}
                </span>
                <ScoreCell value={run.score} />
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
