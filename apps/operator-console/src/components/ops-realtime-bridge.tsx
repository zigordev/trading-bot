import { useEffect, useState } from "react";

import { OPS_WS_URL } from "@/src/lib/api";
import {
  emitOpsRealtimeEvent,
  parseOpsRealtimeEvent,
} from "@/src/lib/ops-events";

export function OpsRealtimeBridge() {
  const [socket, setSocket] = useState<WebSocket | null>(null);

  useEffect(() => {
    const connection = new WebSocket(OPS_WS_URL);

    connection.onmessage = (event) => {
      const parsed = parseOpsRealtimeEvent(String(event.data ?? ""));
      if (parsed) {
        emitOpsRealtimeEvent(parsed);
      }
    };

    connection.onclose = () => {
      setSocket(null);
    };

    setSocket(connection);

    return () => {
      connection.close();
    };
  }, []);

  useEffect(() => {
    return () => {
      socket?.close();
    };
  }, [socket]);

  return null;
}
