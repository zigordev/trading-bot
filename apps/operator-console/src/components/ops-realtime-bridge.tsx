import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { OPS_WS_URL } from "@/src/lib/api";

export function OpsRealtimeBridge() {
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<WebSocket | null>(null);

  useEffect(() => {
    const connection = new WebSocket(OPS_WS_URL);

    connection.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-backtests-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-data-readiness"] });
    };

    connection.onclose = () => {
      setSocket(null);
    };

    setSocket(connection);

    return () => {
      connection.close();
    };
  }, [queryClient]);

  useEffect(() => {
    return () => {
      socket?.close();
    };
  }, [socket]);

  return null;
}
