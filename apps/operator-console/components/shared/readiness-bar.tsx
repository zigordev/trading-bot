"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import { usePreferences } from "@/components/providers/preferences-provider";

export type ReadinessStatus = "ready" | "partial" | "missing" | "error";

export interface ReadinessSegment {
  label: string;
  status: ReadinessStatus;
  ratio?: number;
  rowCount?: number;
}

interface ReadinessBarProps {
  ratio: number | null | undefined;
  status: ReadinessStatus;
  rowCount?: number | null;
  segments?: ReadinessSegment[];
  className?: string;
  showLabel?: boolean;
}

const STATUS_COLOR: Record<ReadinessStatus, string> = {
  ready: "bg-[var(--color-success)]",
  partial: "bg-[var(--color-warning)]",
  missing: "bg-[var(--color-fg-subtle)]/40",
  error: "bg-[var(--color-danger)]",
};

const STATUS_TEXT_KEY: Record<ReadinessStatus, string> = {
  ready: "shared.readiness_bar.ready",
  partial: "shared.readiness_bar.partial",
  missing: "shared.readiness_bar.missing",
  error: "shared.readiness_bar.error",
};

export function ReadinessBar({
  ratio,
  status,
  rowCount,
  segments,
  className,
  showLabel = true,
}: ReadinessBarProps) {
  const { t } = usePreferences();
  const pct = ratio ?? 0;
  return (
    <div className={cn("flex min-w-[120px] flex-col gap-1", className)}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        {segments && segments.length > 0 ? (
          segments.map((seg, idx) => (
            <span
              key={`${seg.label}-${idx}`}
              className={cn("h-full", STATUS_COLOR[seg.status])}
              style={{
                width: `${Math.max(0, Math.min(100, ((seg.ratio ?? 0) * 100) / segments.length))}%`,
              }}
            />
          ))
        ) : (
          <span
            className={cn("h-full", STATUS_COLOR[status])}
            style={{ width: `${Math.max(0, Math.min(100, pct * 100))}%` }}
          />
        )}
      </div>
      {showLabel && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--color-fg-subtle)]">
          <span className="num">
            {ratio !== null && ratio !== undefined
              ? formatPercent(ratio * 100, { digits: 1 })
              : t(STATUS_TEXT_KEY[status])}
          </span>
          {typeof rowCount === "number" && (
            <span className="num">{rowCount.toLocaleString()}</span>
          )}
        </div>
      )}
    </div>
  );
}
