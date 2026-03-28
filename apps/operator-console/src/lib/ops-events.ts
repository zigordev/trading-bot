export type OpsRealtimeEvent =
  | {
      eventId: string;
      occurredAt: string;
      type: "config.resource.updated";
      payload: {
        resource: "symbols" | "timeframes" | "strategies" | "risk-profiles" | "analysis-settings";
        operation: "created" | "updated" | "deleted";
        id?: string;
      };
    }
  | {
      eventId: string;
      occurredAt: string;
      type: "ops.backtests.updated";
      payload: {
        symbols: string[];
        timeframeCodes: string[];
      };
    }
  | {
      eventId: string;
      occurredAt: string;
      type: "ops.data-readiness.updated";
      payload: {
        symbols: string[];
        timeframeCodes: string[];
      };
    };

type Listener = (event: OpsRealtimeEvent) => void;

const listeners = new Set<Listener>();

export const subscribeOpsRealtimeEvent = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export const parseOpsRealtimeEvent = (raw: string): OpsRealtimeEvent | null => {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.eventId !== "string" || typeof parsed.occurredAt !== "string") {
    return null;
  }

  const payload =
    typeof parsed.payload === "object" && parsed.payload !== null && !Array.isArray(parsed.payload)
      ? (parsed.payload as Record<string, unknown>)
      : null;
  if (!payload) {
    return null;
  }

  if (parsed.type === "config.resource.updated") {
    if (
      (payload.resource === "symbols" ||
        payload.resource === "timeframes" ||
        payload.resource === "strategies" ||
        payload.resource === "risk-profiles" ||
        payload.resource === "analysis-settings") &&
      (payload.operation === "created" ||
        payload.operation === "updated" ||
        payload.operation === "deleted")
    ) {
      return {
        eventId: parsed.eventId,
        occurredAt: parsed.occurredAt,
        type: "config.resource.updated",
        payload: {
          resource: payload.resource,
          operation: payload.operation,
          id: typeof payload.id === "string" ? payload.id : undefined,
        },
      };
    }
    return null;
  }

  if (parsed.type === "ops.backtests.updated" || parsed.type === "ops.data-readiness.updated") {
    if (!isStringArray(payload.symbols) || !isStringArray(payload.timeframeCodes)) {
      return null;
    }
    return {
      eventId: parsed.eventId,
      occurredAt: parsed.occurredAt,
      type: parsed.type,
      payload: {
        symbols: payload.symbols,
        timeframeCodes: payload.timeframeCodes,
      },
    };
  }

  return null;
};

export const emitOpsRealtimeEvent = (event: OpsRealtimeEvent): void => {
  for (const listener of listeners) {
    listener(event);
  }
};
