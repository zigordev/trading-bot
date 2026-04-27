"use client";

import { Toaster as SonnerToaster } from "sonner";

import { cn } from "@/lib/utils";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

export function Toaster({ className, ...props }: ToasterProps) {
  return (
    <SonnerToaster
      theme="light"
      richColors={false}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[13px] shadow-lg",
          title: "text-[var(--color-fg)] font-medium",
          description: "text-[var(--color-fg-muted)]",
          actionButton:
            "bg-[var(--color-accent)] text-white text-[12px] rounded-[var(--radius-sm)] px-2 py-1",
          cancelButton:
            "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] text-[12px] rounded-[var(--radius-sm)] px-2 py-1",
          success: "border-[var(--color-success)]/40",
          error: "border-[var(--color-danger)]/40",
          info: "border-[var(--color-info)]/40",
          warning: "border-[var(--color-warning)]/40",
        },
      }}
      className={cn(className)}
      {...props}
    />
  );
}
