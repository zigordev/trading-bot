import * as React from "react";
import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  size?: "sm" | "md";
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  size = "md",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] text-center",
        size === "sm" ? "px-6 py-8" : "px-10 py-12",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-fg-subtle)]",
          size === "sm" ? "size-9" : "size-12",
        )}
      >
        {icon ?? <Inbox className={size === "sm" ? "size-4" : "size-5"} />}
      </div>
      <h3 className="mt-3 text-[14px] font-semibold text-[var(--color-fg)]">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-[12px] text-[var(--color-fg-muted)]">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
