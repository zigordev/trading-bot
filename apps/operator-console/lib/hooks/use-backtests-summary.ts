"use client";

import { useQuery } from "@tanstack/react-query";

import { getBacktestsSummary } from "@/lib/api";

export const backtestsSummaryKey = ["ops", "backtests", "summary"] as const;

export function useBacktestsSummary() {
  return useQuery({
    queryKey: backtestsSummaryKey,
    queryFn: getBacktestsSummary,
    refetchInterval: 30_000,
  });
}
