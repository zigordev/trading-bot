import { randomUUID } from "node:crypto";

type OpsSocket = {
  readonly OPEN: number;
  readonly readyState: number;
  send(payload: string): void;
  close(): void;
  on(event: "close", listener: () => void): void;
};

type BaseOpsEvent<TType extends string, TPayload> = {
  eventId: string;
  type: TType;
  occurredAt: string;
  payload: TPayload;
};

export type OpsWebsocketEvent =
  | BaseOpsEvent<
      "config.resource.updated",
      {
        resource:
          | "symbols"
          | "timeframes"
          | "strategies"
          | "risk-profiles"
          | "analysis-settings"
          | "execution-settings";
        operation: "created" | "updated" | "deleted";
        id?: string;
      }
    >
  | BaseOpsEvent<
      "ops.backtests.updated",
      {
        symbols: string[];
        timeframeCodes: string[];
      }
    >
  | BaseOpsEvent<
      "ops.data-readiness.updated",
      {
        symbols: string[];
        timeframeCodes: string[];
      }
    >
  | BaseOpsEvent<
      "ops.execution.updated",
      {
        symbols: string[];
        timeframeCodes: string[];
      }
    >;

const sockets = new Set<OpsSocket>();

export const addOpsSocket = (socket: OpsSocket): void => {
  sockets.add(socket);
  socket.on("close", () => {
    sockets.delete(socket);
  });
};

export const closeOpsSockets = (): void => {
  for (const socket of sockets) {
    socket.close();
  }
  sockets.clear();
};

export const publishOpsEvent = (
  event: Omit<OpsWebsocketEvent, "eventId" | "occurredAt">,
): void => {
  const message = {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    ...event,
  } as OpsWebsocketEvent;
  const payload = JSON.stringify(message);

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
};
