import { recordCspReports } from './csp-reports';
import { clientKeyFrom, ingestRumBatch, MAX_BODY_BYTES } from './rum-ingest';
import { registry } from './metrics.registry';
import { allowCustomInteractions, allowPages, rumRejectedTotal } from './rum-metrics';

/** The Next.js adapter, mirroring `nest.ts` and `fastify.ts`. */

/**
 * The Prometheus scrape endpoint, for `src/app/metrics/route.ts`.
 *
 * Outside `/api` for the same reason `/health` is: one probe address per
 * concern across the whole estate, whatever framework a service happens to use.
 */
export function createMetricsRoute() {
  return async function GET(): Promise<Response> {
    return new Response(await registry.metrics(), {
      headers: { 'Content-Type': registry.contentType },
    });
  };
}

/**
 * The RUM ingest endpoint, for `src/app/rum/events/route.ts`.
 *
 * This is the estate's only unauthenticated write endpoint, and it cannot be
 * anything else: it is called by anonymous visitors, often as the page is being
 * unloaded. The protections are therefore all in the handler —
 *
 * - **Same-origin only.** A cross-origin `Origin` header is refused, and no
 *   CORS headers are ever returned, so a browser will not let another site
 *   post here. It is not a hard boundary (a non-browser client sends whatever
 *   it likes) but it removes the drive-by case.
 * - **A body-size cap**, enforced from `content-length` before the body is read.
 * - **A per-client rate limit**, and validation of every field.
 *
 * The response is deliberately uninformative. Reporting which events were
 * rejected and why would turn the endpoint into an oracle for probing the
 * allow-lists.
 */
export function createRumIngestRoute(
  options: {
    allowedOrigin?: string;
    customInteractions?: readonly string[];
    pages?: readonly string[];
  } = {}
) {
  // Declared once, at module load, so the app's business-event names are known
  // before the first beacon arrives.
  if (options.customInteractions?.length) {
    allowCustomInteractions(options.customInteractions);
  }
  if (options.pages?.length) allowPages(options.pages);

  return async function POST(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin && !isSameOrigin(origin, request.headers.get('host'), options.allowedOrigin)) {
      rumRejectedTotal.inc({ reason: 'cross_origin' });
      return new Response(null, { status: 403 });
    }

    const read = await readJsonBody(request);
    if (!read.ok) return new Response(null, { status: read.status });

    const outcome = ingestRumBatch(read.body, clientKeyFrom(request.headers));
    if (!outcome.ok) {
      return new Response(null, { status: outcome.status });
    }
    await Promise.allSettled(outcome.details);

    // 204: nothing to say, and nothing for a prober to learn.
    return new Response(null, { status: 204 });
  };
}

export function createCspReportRoute(options: { pages?: readonly string[] } = {}) {
  if (options.pages?.length) allowPages(options.pages);

  return async function POST(request: Request): Promise<Response> {
    const read = await readJsonBody(request);
    if (!read.ok) {
      if (read.status === 400) rumRejectedTotal.inc({ reason: 'csp_malformed' });
      return new Response(null, { status: read.status });
    }

    const outcome = recordCspReports(read.body, clientKeyFrom(request.headers));
    return new Response(null, { status: outcome.ok ? 204 : outcome.status });
  };
}

async function readJsonBody(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413 };
  }

  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413 };
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}

function isSameOrigin(origin: string, host: string | null, allowedOrigin?: string): boolean {
  if (allowedOrigin) return origin === allowedOrigin;
  if (!host) return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

export { initRum } from './rum-client';
export type { RumOptions } from './rum-client';
export { allowCustomInteractions, allowPages, normalizePage } from './rum-metrics';
export { traceServerTiming, withServerTiming } from './server-timing';
export { registry } from './metrics.registry';
