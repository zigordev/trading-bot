import { createMetricsRoute } from '@/observability/next';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Prometheus scrape endpoint. Outside `/api`, like `/health`. */
export const GET = createMetricsRoute();
