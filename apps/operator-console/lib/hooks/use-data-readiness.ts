"use client";

import { useQuery } from "@tanstack/react-query";

import { getDataReadiness, type DataReadinessQuery } from "@/lib/api";

export const dataReadinessKey = (q: DataReadinessQuery = {}) =>
  ["ops", "data-readiness", q] as const;

export function useDataReadiness(query: DataReadinessQuery = {}) {
  return useQuery({
    queryKey: dataReadinessKey(query),
    queryFn: () => getDataReadiness(query),
    refetchInterval: 60_000,
  });
}
