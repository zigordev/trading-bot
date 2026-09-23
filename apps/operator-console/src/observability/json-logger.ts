import { trace, TraceFlags } from '@opentelemetry/api';

export type LogLevel = 'debug' | 'error' | 'info' | 'warn';

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase();
  return SEVERITY[configured as LogLevel] ?? SEVERITY.info;
}

export function currentRelease(): string | undefined {
  return (
    process.env.OTEL_SERVICE_VERSION?.trim() ||
    process.env.APP_RELEASE?.trim() ||
    process.env.NEXT_PUBLIC_RELEASE?.trim() ||
    undefined
  );
}

function isFieldBag(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Error)
  );
}

function errorFields(error: Error, withStack: boolean): Record<string, unknown> {
  const fields: Record<string, unknown> = { name: error.name, message: error.message };
  if (withStack && error.stack) fields.stack = error.stack;
  return fields;
}

/**
 * One JSON object per line, on stdout — the format Alloy ships to Loki.
 *
 * The point of it is `traceId`. Every line emitted inside an active span
 * carries the trace it belongs to, which is what turns Loki and Jaeger from two
 * separate tools into one: click a slow trace, get its logs; find an error log,
 * get the trace that produced it. Unstructured `console.log` is collected just
 * as faithfully and tells you nothing.
 *
 * Framework-free on purpose. `JsonLogger` below adapts it to Nest; anything
 * else can call `writeLogRecord` directly.
 */
export function writeLogRecord(
  level: LogLevel,
  message: unknown,
  context?: string,
  stack?: string
): void {
  if (SEVERITY[level] < threshold()) return;

  const spanContext = trace.getActiveSpan()?.spanContext();
  const version = currentRelease();

  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    // The same string as the health endpoint's `service` and the OTel resource
    // attribute, so a service is named identically everywhere it appears.
    service: process.env.OTEL_SERVICE_NAME?.trim() || 'unknown-service',
  };

  if (version) record.release = version;

  if (isFieldBag(message)) {
    Object.assign(record, message);
    if (record.error instanceof Error) record.error = errorFields(record.error, false);
  } else if (message instanceof Error) {
    record.message = message.message;
    record.error = errorFields(message, true);
  } else {
    record.message = message;
  }

  if (context) record.context = context;
  if (
    spanContext?.traceId &&
    (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED
  ) {
    record.traceId = spanContext.traceId;
    record.spanId = spanContext.spanId;
  }
  if (stack) record.stack = stack;

  const output = `${JSON.stringify(record)}\n`;
  if (level === 'error') process.stderr.write(output);
  else process.stdout.write(output);
}

/**
 * Routes kafkajs's own logging through `writeLogRecord`.
 *
 * kafkajs has an internal logger that writes its own JSON shape —
 * `{"level":"ERROR","logger":"kafkajs","message":...}` — with no `service`
 * field and no trace context. Those lines are the ones you actually want when
 * a broker goes away, and they were the only ones in the estate that a
 * dashboard filtering on `app` could not find.
 *
 * Pass as `logCreator` when constructing the `Kafka` client. Typed loosely on
 * purpose: the kit does not depend on kafkajs, and this is the whole of its
 * `logCreator` contract.
 */
export function kafkaLogCreator(): (
  level: number
) => (entry: {
  namespace: string;
  level: number;
  label: string;
  log: Record<string, unknown> & { message: string };
}) => void {
  // kafkajs numeric levels: 1 ERROR, 2 WARN, 4 INFO, 5 DEBUG.
  const levels: Record<number, LogLevel> = {
    1: 'error',
    2: 'warn',
    4: 'info',
    5: 'debug',
  };

  return () =>
    ({ level, log, namespace }) => {
      const { message, timestamp, logger, stack, ...rest } = log;
      const mapped = level === 1 && rest.restarting === true ? 'warn' : (levels[level] ?? 'info');

      writeLogRecord(
        mapped,
        { message, ...rest },
        `kafkajs${namespace ? `:${namespace}` : ''}`,
        typeof stack === 'string' ? stack : undefined
      );
    };
}
