import { withRouteMetrics } from '@/observability/http-metrics';
import { createCspReportRoute } from '@/observability/next';
import { RUM_PAGES } from '@/observability/rum-pages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withRouteMetrics('/rum/csp', createCspReportRoute({ pages: RUM_PAGES }));
