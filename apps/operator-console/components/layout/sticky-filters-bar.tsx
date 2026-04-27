"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface StickyFiltersBarProps {
  children: React.ReactNode;
  chips?: React.ReactNode;
  className?: string;
  topOffset?: number;
}

export function StickyFiltersBar({
  children,
  chips,
  className,
  topOffset = 56,
}: StickyFiltersBarProps) {
  return (
    <div
      className={cn(
        "sticky z-20 -mx-6 mb-4 flex flex-col gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/85 px-6 py-3 backdrop-blur",
        className,
      )}
      style={{ top: topOffset }}
    >
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {chips && (
        <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
      )}
    </div>
  );
}
