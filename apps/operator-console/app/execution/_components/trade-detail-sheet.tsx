'use client';

import * as React from 'react';

import { ArrowDown, ArrowUp, Lock, LockOpen } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  formatDuration,
  formatPercent,
  formatPrice,
  formatTimestamp,
  formatUsd,
} from '@/lib/format';
import type { ExecutionTrade } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { DetailSheet } from '@/components/shared/detail-sheet';
import { IdCell } from '@/components/shared/id-cell';
import { SymbolAvatar } from '@/components/shared/symbol-avatar';
import { splitSymbol } from '@/lib/backtesting/derive-rows';
import { usePreferences } from '@/components/providers/preferences-provider';

interface TradeDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trade: ExecutionTrade | null;
}

const STATUS_LABEL_KEY: Record<ExecutionTrade['status'], string> = {
  open: 'status.trade_status.open',
  closed: 'status.trade_status.closed',
  cancelled: 'status.trade_status.cancelled',
  rejected: 'status.trade_status.rejected',
};

export function TradeDetailSheet({ open, onOpenChange, trade }: TradeDetailSheetProps) {
  const { t } = usePreferences();
  if (!trade) return null;
  const { base, quote } = splitSymbol(trade.symbolCode);

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={
        <div className="flex items-center gap-2">
          <SymbolAvatar baseAsset={base} quoteAsset={quote} size={28} />
          <div>
            <div>{trade.symbolCode}</div>
            <div className="mt-0.5 text-[12px] font-normal text-[var(--color-fg-muted)]">
              {trade.timeframeCode} · {trade.strategyName}
            </div>
          </div>
        </div>
      }
      headerAccessory={
        <div className="flex items-center gap-1.5">
          <Badge variant={trade.side === 'long' ? 'success' : 'danger'} className="gap-1">
            {trade.side === 'long' ? (
              <ArrowUp className="size-3" />
            ) : (
              <ArrowDown className="size-3" />
            )}
            {t(trade.side === 'long' ? 'status.trade_side.long' : 'status.trade_side.short')}
          </Badge>
          <Badge variant={statusVariant(trade.status)} className="gap-1">
            {trade.status === 'open' ? (
              <LockOpen className="size-3" />
            ) : trade.status === 'closed' ? (
              <Lock className="size-3" />
            ) : null}
            {t(STATUS_LABEL_KEY[trade.status])}
          </Badge>
          <Badge variant={trade.mode === 'live' ? 'accent' : 'outline'}>
            {t(trade.mode === 'live' ? 'status.trade_mode.live' : 'status.trade_mode.paper')}
          </Badge>
        </div>
      }
    >
      <div className="space-y-4">
        <Section label={t('execution.trade_detail.section_performance')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label={t('execution.trade_detail.realized_pnl_percent')}
              value={
                <PnlCell
                  value={trade.realizedPnlPercent}
                  format={(v) => formatPercent(v, { signed: true, digits: 2 })}
                />
              }
            />
            <Stat
              label={t('execution.trade_detail.realized_pnl_usd')}
              value={
                <PnlCell
                  value={trade.realizedPnlUsd}
                  format={(v) => formatUsd(v, { signed: true })}
                />
              }
            />
            <Stat label={t('execution.trade_detail.fees')} value={formatUsd(trade.feesUsd)} />
            <Stat
              label={t('execution.trade_detail.notional')}
              value={formatUsd(trade.notionalUsd)}
            />
            <Stat
              label={t('execution.trade_detail.quantity')}
              value={trade.quantity.toLocaleString()}
            />
            <Stat
              label={t('execution.trade_detail.duration')}
              value={trade.durationMs !== null ? formatDuration(trade.durationMs) : '—'}
            />
          </div>
        </Section>

        <Section label={t('execution.trade_detail.section_prices')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Stat label={t('execution.trade_detail.entry')} value={formatPrice(trade.entryPrice)} />
            <Stat
              label={t('execution.trade_detail.exit')}
              value={trade.exitPrice !== null ? formatPrice(trade.exitPrice) : '—'}
            />
            <Stat
              label={t('execution.trade_detail.stop_loss')}
              value={trade.stopLossPrice !== null ? formatPrice(trade.stopLossPrice) : '—'}
            />
            <Stat
              label={t('execution.trade_detail.take_profit')}
              value={trade.takeProfitPrice !== null ? formatPrice(trade.takeProfitPrice) : '—'}
            />
          </div>
        </Section>

        <Section label={t('execution.trade_detail.section_timing')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <Stat
              label={t('execution.trade_detail.opened')}
              value={formatTimestamp(trade.openedAt, { style: 'full' })}
            />
            <Stat
              label={t('execution.trade_detail.closed')}
              value={trade.closedAt ? formatTimestamp(trade.closedAt, { style: 'full' }) : '—'}
            />
            <Stat
              label={t('execution.trade_detail.close_reason')}
              value={trade.closeReason ?? '—'}
            />
            <Stat
              label={t('execution.trade_detail.execution_settings')}
              value={trade.executionSettingsName ?? '—'}
            />
          </dl>
        </Section>

        <Section label={t('execution.trade_detail.section_references')}>
          <dl className="space-y-2 text-[12px]">
            <Identifier label={t('execution.trade_detail.trade_id')} value={trade.tradeId} />
            {trade.externalOrderId && (
              <Identifier
                label={t('execution.trade_detail.external_order_id')}
                value={trade.externalOrderId}
              />
            )}
            {trade.positionId && (
              <Identifier
                label={t('execution.trade_detail.position_id')}
                value={trade.positionId}
              />
            )}
            <Identifier
              label={t('execution.trade_detail.analysis_setting')}
              value={trade.analysisSettingId}
            />
            {trade.sourceBacktestId && (
              <Identifier
                label={t('execution.trade_detail.source_backtest')}
                value={trade.sourceBacktestId}
              />
            )}
            <KeyValue
              label={t('execution.trade_detail.risk_profile')}
              value={trade.riskProfileName}
            />
          </dl>
        </Section>
      </div>
    </DetailSheet>
  );
}

function statusVariant(status: ExecutionTrade['status']): 'open' | 'closed' | 'default' | 'danger' {
  switch (status) {
    case 'open':
      return 'open';
    case 'closed':
      return 'closed';
    case 'rejected':
      return 'danger';
    default:
      return 'default';
  }
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {label}
      </h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">{label}</dt>
      <dd className="num text-[13px] font-medium text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}

function PnlCell({ value, format }: { value: number | null; format: (v: number) => string }) {
  if (value === null) return <span className="text-[var(--color-fg-subtle)]">—</span>;
  const tone =
    value > 0
      ? 'text-[var(--color-success-fg)]'
      : value < 0
        ? 'text-[var(--color-danger-fg)]'
        : 'text-[var(--color-fg)]';
  return <span className={cn('num', tone)}>{format(value)}</span>;
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

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-fg-subtle)]">{label}</dt>
      <dd className="text-[var(--color-fg)]">{value}</dd>
    </div>
  );
}
