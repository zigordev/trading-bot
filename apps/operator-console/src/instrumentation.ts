import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/observability/tracing');
    const { logServiceStarted, logServiceStopping, observeProcessFailures } =
      await import('@/observability/standard-events');

    observeProcessFailures({ rejections: 'observe' });
    process.once('SIGTERM', () => logServiceStopping('SIGTERM'));
    process.once('SIGINT', () => logServiceStopping('SIGINT'));

    logServiceStarted({ port: process.env.PORT ?? '3000' });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { writeLogRecord } = await import('@/observability/json-logger');
    const failure = error as Error & { digest?: string };

    writeLogRecord(
      'error',
      {
        event: 'request.failed',
        route: context.routePath,
        routeType: context.routeType,
        method: request.method,
        path: request.path,
        renderSource: context.renderSource,
        revalidateReason: context.revalidateReason,
        digest: failure.digest,
        error: { name: failure.name, message: failure.message },
      },
      undefined,
      failure.stack
    );
  }
};
