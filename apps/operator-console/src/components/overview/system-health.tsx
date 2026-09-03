'use client';

import * as React from 'react';
import { CheckCircle2, AlertCircle, Clock, Cpu, Wifi } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useWsStatus } from '@/components/providers/ops-realtime-bridge';
import { useBacktestsSummary } from '@/lib/hooks/use-backtests-summary';
import { SectionCard } from '@/components/layout/section-card';
import { usePreferences } from '@/components/providers/preferences-provider';

type Health = 'healthy' | 'degraded' | 'down' | 'unknown';

const HEALTH_TEXT_KEY: Record<Health, string> = {
  healthy: 'overview.health_status.healthy',
  degraded: 'overview.health_status.degraded',
  down: 'overview.health_status.down',
  unknown: 'overview.health_status.unknown',
};

const HEALTH_CLASS: Record<Health, string> = {
  healthy: 'text-[var(--color-success)]',
  degraded: 'text-[var(--color-warning)]',
  down: 'text-[var(--color-danger)]',
  unknown: 'text-[var(--color-fg-subtle)]',
};

function HealthRow({
  icon,
  label,
  status,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  status: Health;
  hint?: React.ReactNode;
}) {
  const { t } = usePreferences();
  const Icon = status === 'healthy' ? CheckCircle2 : AlertCircle;
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">{label}</span>
          {hint && <span className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</span>}
        </div>
      </div>
      <span className={cn('inline-flex items-center gap-1.5 text-[12px]', HEALTH_CLASS[status])}>
        <Icon className="size-3.5" />
        {t(HEALTH_TEXT_KEY[status])}
      </span>
    </div>
  );
}

export function SystemHealth() {
  const { t } = usePreferences();
  const status = useWsStatus();
  const backtests = useBacktestsSummary();

  const wsHealth: Health = status === 'open' ? 'healthy' : status === 'closed' ? 'down' : 'unknown';

  const cpHealth: Health = backtests.isError ? 'down' : backtests.isLoading ? 'unknown' : 'healthy';

  const queueDepth =
    backtests.data?.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length ?? 0;
  const queueHealth: Health = queueDepth > 20 ? 'degraded' : 'healthy';

  return (
    <SectionCard title={t('overview.system_health.title')} padding="default">
      <div className="divide-y divide-[var(--color-border)]">
        <HealthRow
          icon={<Wifi className="size-4" />}
          label={t('overview.system_health.realtime_channel')}
          status={wsHealth}
          hint={t('overview.system_health.realtime_hint', {
            status: t(HEALTH_TEXT_KEY[wsHealth]).toLowerCase(),
          })}
        />
        <HealthRow
          icon={<Cpu className="size-4" />}
          label={t('overview.system_health.control_plane')}
          status={cpHealth}
          hint={t('overview.system_health.control_plane_hint')}
        />
        <HealthRow
          icon={<Clock className="size-4" />}
          label={t('overview.system_health.backtest_queue')}
          status={queueHealth}
          hint={t(
            queueDepth === 1
              ? 'overview.system_health.queue_depth_one'
              : 'overview.system_health.queue_depth_other',
            { count: queueDepth }
          )}
        />
      </div>
    </SectionCard>
  );
}
