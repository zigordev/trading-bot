"use client";

import { useQuery } from "@tanstack/react-query";

import { getExecutionTrades, type ExecutionTradesQuery } from "@/lib/api";

export const executionTradesKey = (q: ExecutionTradesQuery) =>
  ["ops", "execution", "trades", q] as const;

export function useExecutionTrades(query: ExecutionTradesQuery = {}) {
  return useQuery({
    queryKey: executionTradesKey(query),
    queryFn: () => getExecutionTrades(query),
    placeholderData: (prev) => prev,
  });
}
