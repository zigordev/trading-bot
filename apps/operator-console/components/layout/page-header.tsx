import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  tabs?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  meta,
  tabs,
  className,
}: PageHeaderProps) {
  const hasLeftColumn = Boolean(title || description || meta);
  return (
    <header
      className={cn(
        "mb-4 flex flex-col gap-3 border-b border-[var(--color-border)] pb-5",
        className,
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        {hasLeftColumn ? (
          <div className="flex min-w-0 flex-col gap-1">
            {title ? (
              <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-fg)]">
                {title}
              </h1>
            ) : null}
            {description ? (
              <p className="max-w-2xl text-[13px] text-[var(--color-fg-muted)]">
                {description}
              </p>
            ) : null}
            {meta ? (
              <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-[var(--color-fg-subtle)]">
                {meta}
              </div>
            ) : null}
          </div>
        ) : null}
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">{actions}</div>
        ) : null}
      </div>
      {tabs ? <div>{tabs}</div> : null}
    </header>
  );
}
