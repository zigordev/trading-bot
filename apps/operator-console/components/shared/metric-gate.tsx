"use client";

import * as React from "react";
import { Check, Minus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePreferences } from "@/components/providers/preferences-provider";

export type MetricGateStatus = "pass" | "fail" | "skip";

interface MetricGateProps {
  label: React.ReactNode;
  status: MetricGateStatus;
  actual?: React.ReactNode;
  threshold?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}

const STATUS_BADGE: Record<MetricGateStatus, string> = {
  pass: "bg-[var(--color-success-bg)] text-[var(--color-success)]",
  fail: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
  skip: "bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]",
};

const STATUS_ICON: Record<MetricGateStatus, React.ReactNode> = {
  pass: <Check className="size-3" />,
  fail: <X className="size-3" />,
  skip: <Minus className="size-3" />,
};

const STATUS_TEXT_KEY: Record<MetricGateStatus, string> = {
  pass: "shared.metric_gate.pass",
  fail: "shared.metric_gate.fail",
  skip: "shared.metric_gate.na",
};

export function MetricGate({
  label,
  status,
  actual,
  threshold,
  hint,
  className,
}: MetricGateProps) {
  const { t } = usePreferences();
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
            STATUS_BADGE[status],
          )}
          aria-label={t(STATUS_TEXT_KEY[status])}
        >
          {STATUS_ICON[status]}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">{label}</span>
          {hint && (
            <span className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="num text-[13px] font-semibold text-[var(--color-fg)]">
          {actual ?? "—"}
        </span>
        {threshold !== undefined && (
          <span className="num text-[11px] text-[var(--color-fg-subtle)]">
            {t("shared.metric_gate.target_prefix")} {threshold}
          </span>
        )}
      </div>
    </div>
  );
}

export function MetricGateLegend({ className }: { className?: string }) {
  const { t } = usePreferences();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-4 text-[11px] text-[var(--color-fg-subtle)]",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("flex size-4 items-center justify-center rounded-full", STATUS_BADGE.pass)}>
          <Check className="size-2.5" />
        </span>
        {t(STATUS_TEXT_KEY.pass)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("flex size-4 items-center justify-center rounded-full", STATUS_BADGE.fail)}>
          <X className="size-2.5" />
        </span>
        {t(STATUS_TEXT_KEY.fail)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("flex size-4 items-center justify-center rounded-full", STATUS_BADGE.skip)}>
          <Minus className="size-2.5" />
        </span>
        {t(STATUS_TEXT_KEY.skip)}
      </span>
    </div>
  );
}
