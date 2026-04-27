"use client";

import * as React from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

import { cn } from "@/lib/utils";
import { formatScore } from "@/lib/format";

interface ScoreCellProps {
  value: number | null | undefined;
  history?: number[];
  threshold?: number;
  className?: string;
}

function toneFor(value: number | null | undefined, threshold?: number): "success" | "warning" | "danger" | "muted" {
  if (value === null || value === undefined || Number.isNaN(value)) return "muted";
  if (typeof threshold === "number") {
    if (value >= threshold) return "success";
    if (value >= threshold * 0.8) return "warning";
    return "danger";
  }
  if (value >= 1.5) return "success";
  if (value >= 0.5) return "warning";
  return "danger";
}

const TONE_COLOR = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  danger: "var(--color-danger)",
  muted: "var(--color-fg-subtle)",
} as const;

const TONE_TEXT = {
  success: "text-[var(--color-success)]",
  warning: "text-[var(--color-warning)]",
  danger: "text-[var(--color-danger)]",
  muted: "text-[var(--color-fg-subtle)]",
} as const;

export function ScoreCell({ value, history, threshold, className }: ScoreCellProps) {
  const tone = toneFor(value, threshold);
  const stroke = TONE_COLOR[tone];
  const data = React.useMemo(() => {
    if (!history) return undefined;
    return history.map((v, i) => ({ idx: i, value: v }));
  }, [history]);

  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      {data && data.length > 1 && (
        <div className="h-5 w-16">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <span className={cn("num text-[13px] font-semibold tabular-nums", TONE_TEXT[tone])}>
        {formatScore(value)}
      </span>
    </div>
  );
}
