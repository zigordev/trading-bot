'use client';

import { useQuery } from '@tanstack/react-query';

import { getRuntimeAnalyses } from '@/lib/api';

export const runtimeAnalysesKey = ['runtime', 'analysis-settings'] as const;

export function useRuntimeAnalyses() {
  return useQuery({
    queryKey: runtimeAnalysesKey,
    queryFn: getRuntimeAnalyses,
    staleTime: 60_000,
  });
}
