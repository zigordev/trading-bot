'use client';

import { useQuery } from '@tanstack/react-query';

import { getExecutionSummary } from '@/lib/api';

export const executionSummaryKey = ['ops', 'execution', 'summary'] as const;

export function useExecutionSummary() {
  return useQuery({
    queryKey: executionSummaryKey,
    queryFn: getExecutionSummary,
    refetchInterval: 20_000,
  });
}
