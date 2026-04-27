"use client";

import * as React from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface KpiTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: {
    value: React.ReactNode;
    direction?: "up" | "down" | "flat";
  };
  hint?: React.ReactNode;
  spark?: number[];
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  loading?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

const TONE_COLOR = {
  default: "var(--color-fg-muted)",
  accent: "var(--color-accent)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
} as const;

const TONE_BORDER = {
  default: "border-[var(--color-border)]",
  accent: "border-[var(--color-accent)]/30",
  success: "border-[var(--color-success)]/30",
  warning: "border-[var(--color-warning)]/30",
  danger: "border-[var(--color-danger)]/30",
} as const;

const directionColor = {
  up: "text-[var(--color-success)]",
  down: "text-[var(--color-danger)]",
  flat: "text-[var(--color-fg-subtle)]",
} as const;

export function KpiTile({
  label,
  value,
  delta,
  hint,
  spark,
  tone = "default",
  loading,
  icon,
  className,
}: KpiTileProps) {
  const sparkData = React.useMemo(() => {
    if (!spark) return undefined;
    return spark.map((v, i) => ({ idx: i, value: v }));
  }, [spark]);

  const stroke = TONE_COLOR[tone];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-4",
        TONE_BORDER[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
            {icon && (
              <span className="text-[var(--color-fg-subtle)]">{icon}</span>
            )}
            {label}
          </span>
          {loading ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="num text-[22px] font-semibold leading-none text-[var(--color-fg)]">
                {value}
              </span>
              {delta && (
                <span
                  className={cn(
                    "num text-[12px] font-medium",
                    directionColor[delta.direction ?? "flat"],
                  )}
                >
                  {delta.value}
                </span>
              )}
            </div>
          )}
          {hint && (
            <span className="text-[12px] text-[var(--color-fg-subtle)]">{hint}</span>
          )}
        </div>
        {sparkData && sparkData.length > 1 && (
          <div className="h-12 w-24">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`sparkfill-${tone}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={stroke}
                  strokeWidth={1.5}
                  fill={`url(#sparkfill-${tone})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
