import * as React from "react";

import { cn } from "@/lib/utils";

interface SectionCardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  padding?: "none" | "default";
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  padding = "default",
}: SectionCardProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[14px] font-semibold text-[var(--color-fg)]">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-[12px] text-[var(--color-fg-muted)]">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(padding === "default" && "p-4", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
