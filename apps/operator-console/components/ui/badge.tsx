import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none num",
  {
    variants: {
      variant: {
        default:
          "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]",
        outline:
          "border-[var(--color-border)] bg-transparent text-[var(--color-fg-muted)]",
        accent:
          "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
        success:
          "border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success-fg)]",
        warning:
          "border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]",
        danger:
          "border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]",
        info: "border-[var(--color-info-border)] bg-[var(--color-info-bg)] text-[var(--color-info-fg)]",
        open:
          "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]",
        closed:
          "border-[var(--color-fg-subtle)]/30 bg-[var(--color-fg-subtle)]/15 text-[var(--color-fg)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
