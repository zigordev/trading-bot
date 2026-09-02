'use client';

import { useQuery } from '@tanstack/react-query';

import { getConfigResourceRecords } from '@/lib/api';

export const strategiesKey = ['config', 'strategies'] as const;

export function useStrategies() {
  return useQuery({
    queryKey: strategiesKey,
    queryFn: () => getConfigResourceRecords('strategies'),
    staleTime: 60_000,
  });
}
