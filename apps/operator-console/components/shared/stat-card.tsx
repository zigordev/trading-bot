import * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: {
    value: React.ReactNode;
    direction?: "up" | "down" | "flat";
  };
  icon?: React.ReactNode;
  loading?: boolean;
  className?: string;
}

const directionColor = {
  up: "text-[var(--color-success)]",
  down: "text-[var(--color-danger)]",
  flat: "text-[var(--color-fg-subtle)]",
} as const;

export function StatCard({
  label,
  value,
  hint,
  delta,
  icon,
  loading,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-subtle)]">
        <span>{label}</span>
        {icon && <span className="text-[var(--color-fg-subtle)]">{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20" />
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
  );
}
