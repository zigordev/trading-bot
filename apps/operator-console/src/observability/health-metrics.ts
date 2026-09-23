import * as client from 'prom-client';
import { registry } from './metrics.registry';

/**
 * Health, as a metric.
 *
 * The `/health` endpoint returns JSON, which no alerting rule can read. That
 * left a real hole: the `degraded` state was built, tested and documented, and
 * then nothing consumed it — Docker sees a 200 and calls the container healthy,
 * Caddy would route to it, and Prometheus's `up` only says whether `/metrics`
 * answered. A service could fail to send a single email for a week silently.
 *
 * These two gauges are what close it. They are written by the health handler on
 * every probe, so they carry the same judgement the endpoint does rather than a
 * second opinion computed somewhere else.
 */

/** 2 = ok, 1 = degraded, 0 = error. Ordered so `< 2` means "not fully well"
 *  and `== 0` means "cannot serve", which reads naturally in a PromQL rule. */
const serviceHealth = new client.Gauge({
  name: 'service_health_status',
  help: 'Service health: 2 = ok, 1 = degraded, 0 = error',
  registers: [registry],
});

/** One series per dependency. 1 = up, 0 = down, absent = never probed. */
const componentUp = new client.Gauge({
  name: 'service_component_up',
  help: 'Whether a named dependency is reachable: 1 = up, 0 = down',
  labelNames: ['component'] as const,
  registers: [registry],
});

const STATUS_VALUE: Record<string, number> = { ok: 2, degraded: 1, error: 0 };

/**
 * Records the result of a health probe.
 *
 * Call it from the health handler with exactly what the handler is about to
 * return, so the metric and the endpoint can never disagree.
 */
export function recordHealth(
  status: 'degraded' | 'error' | 'ok',
  components: Record<string, { status: string }>
): void {
  serviceHealth.set(STATUS_VALUE[status] ?? 0);

  for (const [name, component] of Object.entries(components)) {
    // `unknown` means no connection has been attempted yet. Leaving the series
    // absent is honest; writing 0 would alert on a service that has simply not
    // finished starting.
    if (component.status === 'unknown') continue;
    componentUp.set({ component: name }, component.status === 'up' ? 1 : 0);
  }
}
