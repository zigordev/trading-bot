'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';

import { getBinanceSymbolReferences } from '@/lib/api';

export const binanceSymbolsKey = (query: string) =>
  ['reference', 'binance-symbols', query] as const;

export function useBinanceSymbols(query: string) {
  return useQuery({
    queryKey: binanceSymbolsKey(query),
    queryFn: () => getBinanceSymbolReferences(query),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
