"use client";

import { useWsStatus } from "@/components/providers/ops-realtime-bridge";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/components/providers/preferences-provider";

export function WsStatusDot() {
  const { t } = usePreferences();
  const status = useWsStatus();
  const label =
    status === "open"
      ? t("shared.ws_status_dot.connected")
      : status === "closed"
        ? t("shared.ws_status_dot.disconnected")
        : t("shared.ws_status_dot.connecting");

  return (
    <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)]">
      <span className="relative flex size-2">
        {status === "open" ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-40" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            status === "open" && "bg-[var(--color-success)]",
            status === "closed" && "bg-[var(--color-danger)]",
            status === "connecting" && "bg-[var(--color-warning)]",
          )}
        />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
