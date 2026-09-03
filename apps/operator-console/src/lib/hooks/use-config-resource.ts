'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deleteConfigResource, getConfigResourceRecords, saveConfigResource } from '@/lib/api';

export const configResourceKey = (resource: string) => ['config', resource] as const;

export function useConfigResource(resource: string) {
  return useQuery({
    queryKey: configResourceKey(resource),
    queryFn: () => getConfigResourceRecords(resource),
  });
}

export function useSaveConfigResource(resource: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, id }: { payload: Record<string, unknown>; id?: string | null }) =>
      saveConfigResource(resource, payload, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configResourceKey(resource) });
      queryClient.invalidateQueries({ queryKey: ['runtime', 'analysis-settings'] });
    },
  });
}

export function useDeleteConfigResource(resource: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConfigResource(resource, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: configResourceKey(resource) });
      queryClient.invalidateQueries({ queryKey: ['runtime', 'analysis-settings'] });
    },
  });
}
