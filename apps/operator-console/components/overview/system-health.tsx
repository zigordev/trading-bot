"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Clock, Cpu, Wifi } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWsStatus } from "@/components/providers/ops-realtime-bridge";
import { useBacktestsSummary } from "@/lib/hooks/use-backtests-summary";
import { SectionCard } from "@/components/layout/section-card";

type Health = "healthy" | "degraded" | "down" | "unknown";

const HEALTH_TEXT: Record<Health, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Offline",
  unknown: "Unknown",
};

const HEALTH_CLASS: Record<Health, string> = {
  healthy: "text-[var(--color-success)]",
  degraded: "text-[var(--color-warning)]",
  down: "text-[var(--color-danger)]",
  unknown: "text-[var(--color-fg-subtle)]",
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
  const Icon = status === "healthy" ? CheckCircle2 : AlertCircle;
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">{label}</span>
          {hint && (
            <span className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</span>
          )}
        </div>
      </div>
      <span className={cn("inline-flex items-center gap-1.5 text-[12px]", HEALTH_CLASS[status])}>
        <Icon className="size-3.5" />
        {HEALTH_TEXT[status]}
      </span>
    </div>
  );
}

export function SystemHealth() {
  const status = useWsStatus();
  const backtests = useBacktestsSummary();

  const wsHealth: Health =
    status === "open" ? "healthy" : status === "closed" ? "down" : "unknown";

  const cpHealth: Health = backtests.isError
    ? "down"
    : backtests.isLoading
      ? "unknown"
      : "healthy";

  const queueDepth =
    backtests.data?.jobs.filter((j) => j.status === "queued" || j.status === "running")
      .length ?? 0;
  const queueHealth: Health = queueDepth > 20 ? "degraded" : "healthy";

  return (
    <SectionCard title="System health" padding="default">
      <div className="divide-y divide-[var(--color-border)]">
        <HealthRow
          icon={<Wifi className="size-4" />}
          label="Realtime channel"
          status={wsHealth}
          hint={`/ws/ops · ${HEALTH_TEXT[wsHealth].toLowerCase()}`}
        />
        <HealthRow
          icon={<Cpu className="size-4" />}
          label="Control plane"
          status={cpHealth}
          hint="/v1/ops/* responding"
        />
        <HealthRow
          icon={<Clock className="size-4" />}
          label="Backtest queue"
          status={queueHealth}
          hint={`${queueDepth} job${queueDepth === 1 ? "" : "s"} pending`}
        />
      </div>
    </SectionCard>
  );
}
