import { createRumIngestRoute } from '@/observability/next';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * RUM ingest. Unauthenticated by necessity — anonymous visitors report here,
 * often during page unload — so the handler carries the same-origin check, the
 * body-size cap, the per-client rate limit and the field validation.
 */
export const POST = createRumIngestRoute();
