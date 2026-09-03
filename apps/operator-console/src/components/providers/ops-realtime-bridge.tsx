'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { OPS_WS_URL } from '@/lib/api';
import {
  emitOpsRealtimeEvent,
  parseOpsRealtimeEvent,
  subscribeOpsRealtimeEvent,
} from '@/lib/ops-events';

export type WsStatus = 'connecting' | 'open' | 'closed';

const RECONNECT_DELAY_MS = 2_000;

const WsStatusContext = createContext<WsStatus>('connecting');

export function useWsStatus() {
  return useContext(WsStatusContext);
}

export function OpsRealtimeBridge({ children }: { children?: React.ReactNode }) {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');
      socket = new WebSocket(OPS_WS_URL);

      socket.onopen = () => {
        if (!cancelled) setStatus('open');
      };

      socket.onmessage = (event) => {
        const parsed = parseOpsRealtimeEvent(String(event.data ?? ''));
        if (parsed) {
          emitOpsRealtimeEvent(parsed);
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setStatus('closed');
        timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      socket?.close();
    };
  }, []);

  useEffect(() => {
    return subscribeOpsRealtimeEvent((event) => {
      switch (event.type) {
        case 'ops.backtests.updated':
          queryClient.invalidateQueries({
            queryKey: ['ops', 'backtests'],
          });
          break;
        case 'ops.execution.updated':
          queryClient.invalidateQueries({
            queryKey: ['ops', 'execution'],
          });
          break;
        case 'ops.data-readiness.updated':
          queryClient.invalidateQueries({
            queryKey: ['ops', 'data-readiness'],
          });
          break;
        case 'config.resource.updated':
          queryClient.invalidateQueries({
            queryKey: ['config', event.payload.resource],
          });
          queryClient.invalidateQueries({
            queryKey: ['runtime', 'analysis-settings'],
          });
          break;
      }
    });
  }, [queryClient]);

  return <WsStatusContext.Provider value={status}>{children}</WsStatusContext.Provider>;
}
