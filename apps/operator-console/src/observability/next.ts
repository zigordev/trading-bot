// DO NOT EDIT. Vendored from platform-ops/packages/observability.
// Change it there and run: bash platform-ops/scripts/sync-observability.sh

import { clientKeyFrom, ingestRumBatch, MAX_BODY_BYTES } from './rum-ingest';
import { registry } from './metrics.registry';
import { allowCustomInteractions } from './rum-metrics';

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
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
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
  options: { allowedOrigin?: string; customInteractions?: readonly string[] } = {}
) {
  // Declared once, at module load, so the app's business-event names are known
  // before the first beacon arrives.
  if (options.customInteractions?.length) {
    allowCustomInteractions(options.customInteractions);
  }

  return async function POST(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (origin) {
      const expected = options.allowedOrigin ?? new URL(request.url).origin;
      if (origin !== expected) {
        return new Response(null, { status: 403 });
      }
    }

    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }

    let body: unknown;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) {
        return new Response(null, { status: 413 });
      }
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }

    const outcome = ingestRumBatch(body, clientKeyFrom(request.headers));
    if (!outcome.ok) {
      return new Response(null, { status: outcome.status });
    }

    // 204: nothing to say, and nothing for a prober to learn.
    return new Response(null, { status: 204 });
  };
}

export { initRum } from './rum-client';
export type { RumOptions } from './rum-client';
export { allowCustomInteractions, normalizePage } from './rum-metrics';
export { registry } from './metrics.registry';
