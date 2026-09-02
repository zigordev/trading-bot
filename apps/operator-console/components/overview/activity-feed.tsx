'use client';

import * as React from 'react';
import { Activity, Database, PlayCircle, Settings2, Wallet } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatTimestamp } from '@/lib/format';
import { subscribeOpsRealtimeEvent, type OpsRealtimeEvent } from '@/lib/ops-events';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/empty-state';
import { SymbolAvatar } from '@/components/shared/symbol-avatar';
import { splitSymbol } from '@/lib/backtesting/derive-rows';
import { usePreferences } from '@/components/providers/preferences-provider';

type FeedEntry = OpsRealtimeEvent & { receivedAt: number };

const TYPE_META: Record<
  OpsRealtimeEvent['type'],
  { labelKey: string; icon: React.ReactNode; tone: 'default' | 'accent' | 'warning' }
> = {
  'ops.backtests.updated': {
    labelKey: 'overview.activity_feed.type_backtests',
    icon: <PlayCircle className="size-3.5" />,
    tone: 'accent',
  },
  'ops.execution.updated': {
    labelKey: 'overview.activity_feed.type_execution',
    icon: <Wallet className="size-3.5" />,
    tone: 'default',
  },
  'ops.data-readiness.updated': {
    labelKey: 'overview.activity_feed.type_data',
    icon: <Database className="size-3.5" />,
    tone: 'warning',
  },
  'config.resource.updated': {
    labelKey: 'overview.activity_feed.type_config',
    icon: <Settings2 className="size-3.5" />,
    tone: 'default',
  },
};

function PairList({ symbols }: { symbols: string[] }) {
  if (symbols.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {symbols.slice(0, 4).map((sym) => {
        const { base, quote } = splitSymbol(sym);
        return (
          <span key={sym} className="inline-flex items-center gap-1">
            <SymbolAvatar baseAsset={base} quoteAsset={quote} size={14} />
            <span className="text-[12px] text-[var(--color-fg-muted)]">{sym}</span>
          </span>
        );
      })}
      {symbols.length > 4 && (
        <span className="text-[11px] text-[var(--color-fg-subtle)]">+{symbols.length - 4}</span>
      )}
    </span>
  );
}

function describeEvent(
  event: OpsRealtimeEvent,
  t: (key: string, params?: Record<string, string | number>) => string
): React.ReactNode {
  switch (event.type) {
    case 'ops.backtests.updated':
    case 'ops.execution.updated':
      return event.payload.symbols.length ? (
        <PairList symbols={event.payload.symbols} />
      ) : (
        t('overview.activity_feed.summary_refresh')
      );
    case 'ops.data-readiness.updated':
      return event.payload.symbols.length ? (
        <PairList symbols={event.payload.symbols} />
      ) : (
        t('overview.activity_feed.readiness_refresh')
      );
    case 'config.resource.updated':
      return `${event.payload.resource} · ${event.payload.operation}`;
  }
}

const MAX_ENTRIES = 20;

export function ActivityFeed() {
  const { t } = usePreferences();
  const [entries, setEntries] = React.useState<FeedEntry[]>([]);

  React.useEffect(() => {
    return subscribeOpsRealtimeEvent((event) => {
      setEntries((prev) => [{ ...event, receivedAt: Date.now() }, ...prev].slice(0, MAX_ENTRIES));
    });
  }, []);

  return (
    <SectionCard
      title={t('overview.activity_feed.title')}
      description={t('overview.activity_feed.description')}
      padding="default"
      bodyClassName="p-0"
    >
      {entries.length === 0 ? (
        <div className="p-4">
          <EmptyState
            size="sm"
            title={t('overview.activity_feed.empty_title')}
            description={t('overview.activity_feed.empty_description')}
            icon={<Activity className="size-4" />}
          />
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {entries.map((entry) => {
            const meta = TYPE_META[entry.type];
            return (
              <li key={entry.eventId} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                    meta.tone === 'accent'
                      ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)]'
                      : meta.tone === 'warning'
                        ? 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]'
                        : 'bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]'
                  )}
                >
                  {meta.icon}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {t(meta.labelKey)}
                    </Badge>
                    <span className="min-w-0 flex-1 text-[12px] text-[var(--color-fg-muted)]">
                      {describeEvent(entry, t)}
                    </span>
                  </div>
                  <span className="text-[11px] text-[var(--color-fg-subtle)]">
                    {formatTimestamp(entry.occurredAt, { style: 'relative' })}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
