"use client";

import * as React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  description?: React.ReactNode;
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
  size?: "sm" | "md";
}

function describeError(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return undefined;
}

export function ErrorState({
  title = "Something went wrong",
  description,
  error,
  onRetry,
  retryLabel = "Retry",
  className,
  size = "md",
}: ErrorStateProps) {
  const message = describeError(error);
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-danger)]/40 bg-[var(--color-danger-bg)] text-center",
        size === "sm" ? "px-6 py-8" : "px-10 py-12",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-[var(--color-danger)]/15 text-[var(--color-danger)]">
        <AlertTriangle className="size-5" />
      </div>
      <h3 className="mt-3 text-[14px] font-semibold text-[var(--color-fg)]">{title}</h3>
      {(description || message) && (
        <p className="mt-1 max-w-md text-[12px] text-[var(--color-fg-muted)]">
          {description ?? message}
        </p>
      )}
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4 gap-1.5"
          onClick={onRetry}
        >
          <RotateCw className="size-3.5" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
