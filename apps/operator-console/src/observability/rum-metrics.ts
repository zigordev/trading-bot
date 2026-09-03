// DO NOT EDIT. Vendored from platform-ops/packages/observability.
// Change it there and run: bash platform-ops/scripts/sync-observability.sh

import * as client from 'prom-client';
import { registry } from './metrics.registry';

/**
 * Real User Monitoring metrics, shared by every UI in the estate.
 *
 * Everything here is defensive, because every value arrives from a browser. A
 * label whose value an anonymous visitor controls is a Prometheus time series
 * an anonymous visitor controls, and enough of them take the server down. The
 * rules that follow are not stylistic:
 *
 * - **Event names are allow-listed.** They become label values, so an unknown
 *   name collapses to `other` rather than creating a new series.
 * - **Pages are normalised to route patterns.** `/pools/<uuid>` is one series,
 *   not one per pool.
 * - **Nothing per-session is ever a label.** Session and user ids stay on the
 *   client; the distribution of a session's depth is a histogram.
 */

/** Timing metrics, in seconds. Buckets sit on the Core Web Vitals thresholds
 *  so a quantile reads against the grade: INP good at 0.2s and poor past 0.5s,
 *  TTFB good at 0.8s and poor past 1.8s, LCP good at 2.5s and poor past 4s. */
const performanceSeconds = new client.Histogram({
  name: 'rum_performance_seconds',
  help: 'RUM timing metrics in seconds (LCP, INP, TTFB, FCP, Load)',
  labelNames: ['metric_name', 'page'] as const,
  buckets: [0.05, 0.1, 0.2, 0.5, 0.8, 1, 1.8, 2.5, 4, 6, 10],
  registers: [registry],
});

/** CLS is a unitless score, not a duration. Sharing a `_seconds` histogram with
 *  the timings — and being divided by 1000 with them — is what made this metric
 *  silently useless before. Thresholds: good at 0.1, poor past 0.25. */
const layoutShiftScore = new client.Histogram({
  name: 'rum_layout_shift_score',
  help: 'Cumulative Layout Shift score (unitless)',
  labelNames: ['page'] as const,
  buckets: [0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1],
  registers: [registry],
});

const errorsTotal = new client.Counter({
  name: 'rum_errors_total',
  help: 'Client-side errors reported by the browser',
  labelNames: ['error_type', 'page'] as const,
  registers: [registry],
});

const interactionsTotal = new client.Counter({
  name: 'rum_interactions_total',
  help: 'User interactions reported by the browser',
  labelNames: ['interaction_type', 'page'] as const,
  registers: [registry],
});

const navigationsTotal = new client.Counter({
  name: 'rum_navigations_total',
  help: 'Page views and route changes',
  labelNames: ['navigation_type', 'page'] as const,
  registers: [registry],
});

const frustrationsTotal = new client.Counter({
  name: 'rum_frustrations_total',
  help: 'Rage clicks, dead clicks and other frustration signals',
  labelNames: ['frustration_type', 'page'] as const,
  registers: [registry],
});

/** How deep a session got. A histogram rather than a gauge labelled by session:
 *  one series per anonymous visitor is unbounded cardinality, and a gauge would
 *  only ever show the most recent session's depth anyway. */
const navigationPathLength = new client.Histogram({
  name: 'rum_navigation_path_length',
  help: 'Number of pages visited in a session',
  buckets: [1, 2, 3, 5, 8, 13, 21, 34],
  registers: [registry],
});

/** Beacons rejected before they reached a metric, by reason. The one metric
 *  here whose labels the server controls, so it is safe to alert on. */
export const rumRejectedTotal = new client.Counter({
  name: 'rum_rejected_total',
  help: 'RUM beacons rejected, by reason',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export type RumEventType = 'performance' | 'error' | 'interaction' | 'navigation' | 'frustration';

export interface RumEvent {
  type: RumEventType;
  name: string;
  value?: number;
  page?: string;
  navigationDepth?: number;
}

/**
 * Every event name that may become a label value.
 *
 * Anything not listed collapses to `other`. This is the single most important
 * control in the file: `trackEvent(name)` puts the name straight into a
 * label, and the ingest endpoint is public, so without an allow-list one loop
 * against it creates unlimited time series.
 */
const ALLOWED_NAMES: Record<RumEventType, ReadonlySet<string>> = {
  performance: new Set(['LCP', 'INP', 'CLS', 'TTFB', 'FCP', 'DOMContentLoaded', 'Load']),
  error: new Set(['JavaScript Error', 'Unhandled Promise Rejection', 'Custom Error']),
  interaction: new Set(['Click', 'Form Submit']),
  navigation: new Set(['Page View', 'Route Change']),
  frustration: new Set([
    'Rage Click',
    'Dead Click',
    'Slow Page Load',
    'Excessive Scrolling',
    'Long Time on Page',
  ]),
};

/** Timing metrics arrive in milliseconds; CLS is already unitless. */
const UNITLESS_METRICS = new Set(['CLS']);

/**
 * Product-specific interaction names, added by the app at startup.
 *
 * Business events — "Pool Created", "Invitation Accepted" — are worth counting,
 * but their names still have to be an allow-list rather than free text, because
 * they end up as label values on a public endpoint. An app declares its own
 * once; anything not declared collapses to `other` like everything else.
 */
const customInteractions = new Set<string>();

export function allowCustomInteractions(names: readonly string[]): void {
  for (const name of names) {
    if (typeof name === 'string' && name.length > 0 && name.length <= 64) {
      customInteractions.add(name);
    }
  }
}

function labelFor(type: RumEventType, name: string): string {
  if (ALLOWED_NAMES[type].has(name)) return name;
  if (type === 'interaction' && customInteractions.has(name)) return name;
  return 'other';
}

/**
 * Collapses a path to a route pattern.
 *
 * The browser chooses this string, so an unnormalised path is a label whose
 * cardinality a visitor controls. Segments that look like identifiers — a uuid,
 * a bare number, a long slug with digits in it — become `:id`, and anything
 * beyond a handful of segments is truncated so a deep crafted path cannot
 * become its own series.
 */
export function normalizePage(rawPage: string): string {
  if (typeof rawPage !== 'string' || !rawPage.startsWith('/')) return 'other';

  // Query strings and fragments can carry tokens and personal data. They are
  // never wanted in a label, and are dropped before anything else happens.
  const pathname = rawPage.split(/[?#]/)[0] ?? '/';

  const segments = pathname.split('/').slice(0, 6);
  const normalized = segments
    .map((segment) => {
      if (segment === '') return segment;
      if (segment.length > 64) return ':id';
      if (/^\d+$/.test(segment)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
        return ':id';
      }
      if (segment.length > 20 && /\d/.test(segment)) return ':id';
      // `.` and `..` are not routes. They match the character test below
      // (dots are legal in a route segment), so they need their own check —
      // without it `/../../etc/passwd` reaches a label verbatim.
      if (segment === '.' || segment === '..') return ':id';
      // Anything with characters a route would not contain is not a route.
      if (!/^[\w.-]+$/.test(segment)) return ':id';
      return segment;
    })
    .join('/');

  // A final cap. Every segment is already bounded, but the label as a whole is
  // what lands in Prometheus, and it should never be long enough to matter.
  const capped = normalized.length > 128 ? `${normalized.slice(0, 128)}…` : normalized;
  return capped === '' ? '/' : capped;
}

/**
 * Records one validated event. Returns false when the event was dropped, so
 * the caller can count rejections.
 */
export function recordRumEvent(event: RumEvent): boolean {
  const page = normalizePage(event.page ?? '/');
  const { type, name } = event;

  switch (type) {
    case 'performance': {
      if (typeof event.value !== 'number' || !Number.isFinite(event.value) || event.value < 0) {
        return false;
      }
      const metricName = labelFor('performance', name);
      if (metricName === 'other') return false;

      if (UNITLESS_METRICS.has(metricName)) {
        layoutShiftScore.observe({ page }, event.value);
      } else {
        performanceSeconds.observe({ metric_name: metricName, page }, event.value / 1000);
      }
      return true;
    }

    case 'error':
      errorsTotal.inc({ error_type: labelFor('error', name), page });
      return true;

    case 'interaction':
      interactionsTotal.inc({ interaction_type: labelFor('interaction', name), page });
      return true;

    case 'navigation':
      navigationsTotal.inc({ navigation_type: labelFor('navigation', name), page });
      if (
        typeof event.navigationDepth === 'number' &&
        Number.isFinite(event.navigationDepth) &&
        event.navigationDepth > 0
      ) {
        // Clamped: the browser supplies this, and an absurd value would skew
        // the histogram's sum for everyone.
        navigationPathLength.observe(Math.min(event.navigationDepth, 1000));
      }
      return true;

    case 'frustration':
      frustrationsTotal.inc({
        frustration_type: labelFor('frustration', name).toLowerCase().replace(/\s+/g, '_'),
        page,
      });
      return true;

    default:
      return false;
  }
}
