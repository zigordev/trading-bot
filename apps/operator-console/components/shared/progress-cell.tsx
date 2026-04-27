"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface ProgressCellProps {
  total: number;
  completed: number;
  running?: number;
  failed?: number;
  pending?: number;
  className?: string;
  showCounts?: boolean;
}

export function ProgressCell({
  total,
  completed,
  running = 0,
  failed = 0,
  pending = 0,
  className,
  showCounts = true,
}: ProgressCellProps) {
  const safeTotal = Math.max(total, completed + running + failed + pending);
  const completedPct = safeTotal === 0 ? 0 : (completed / safeTotal) * 100;
  const runningPct = safeTotal === 0 ? 0 : (running / safeTotal) * 100;
  const failedPct = safeTotal === 0 ? 0 : (failed / safeTotal) * 100;

  return (
    <div className={cn("flex min-w-[140px] flex-col gap-1", className)}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        {completedPct > 0 && (
          <span
            className="h-full bg-[var(--color-success)]"
            style={{ width: `${completedPct}%` }}
          />
        )}
        {runningPct > 0 && (
          <span
            className={cn(
              "h-full bg-[var(--color-accent)]",
              running > 0 && "animate-pulse",
            )}
            style={{ width: `${runningPct}%` }}
          />
        )}
        {failedPct > 0 && (
          <span
            className="h-full bg-[var(--color-danger)]"
            style={{ width: `${failedPct}%` }}
          />
        )}
      </div>
      {showCounts && (
        <div className="num flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
          <span className="text-[var(--color-fg-muted)]">
            {completed}/{safeTotal}
          </span>
          {running > 0 && (
            <span className="inline-flex items-center gap-1 text-[var(--color-accent)]">
              <span className="size-1 animate-pulse rounded-full bg-[var(--color-accent)]" />
              {running} running
            </span>
          )}
          {failed > 0 && (
            <span className="text-[var(--color-danger)]">{failed} failed</span>
          )}
          {pending > 0 && (
            <span className="text-[var(--color-fg-subtle)]">{pending} queued</span>
          )}
        </div>
      )}
    </div>
  );
}
