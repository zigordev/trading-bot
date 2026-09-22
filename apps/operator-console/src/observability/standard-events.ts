import { writeLogRecord } from './json-logger';

export type ProcessFailureOptions = { rejections?: 'crash' | 'observe' };

export type RequestFailure = { method: string; route: string; status: number; error: unknown };

let observing = false;

function describe(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'NonError', message: String(error) };
}

export function logServiceStarted(details: Readonly<Record<string, unknown>> = {}): void {
  writeLogRecord('info', {
    event: 'service.started',
    runtime: `node ${process.version}`,
    ...details,
  });
}

export function logServiceStopping(signal: string): void {
  writeLogRecord('info', { event: 'service.stopping', signal });
}

export function logRequestFailed({ method, route, status, error }: RequestFailure): void {
  writeLogRecord(
    'error',
    { event: 'request.failed', method, route, status, error: describe(error) },
    undefined,
    error instanceof Error ? error.stack : undefined
  );
}

export function observeProcessFailures(options: ProcessFailureOptions = {}): void {
  if (observing) return;
  observing = true;

  process.on('uncaughtExceptionMonitor', (error: unknown, origin: string) => {
    writeLogRecord(
      'error',
      {
        event:
          origin === 'unhandledRejection'
            ? 'process.unhandled_rejection'
            : 'process.uncaught_exception',
        error: describe(error),
      },
      undefined,
      error instanceof Error ? error.stack : undefined
    );
  });

  if (options.rejections === 'observe') {
    process.on('unhandledRejection', (reason: unknown) => {
      writeLogRecord('warn', { event: 'process.unhandled_rejection', error: describe(reason) });
    });
  }
}
