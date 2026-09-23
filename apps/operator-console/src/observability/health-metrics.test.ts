import { beforeEach, describe, expect, it } from 'vitest';
import { registry } from './metrics.registry';
import { recordHealth } from './health-metrics';

/**
 * These assertions are a contract with `docker/prometheus/alerts.yml`. The
 * alerts select on exact metric names, exact label names and exact numeric
 * values — `service_health_status == 0`, `== 1`, `service_component_up == 0` —
 * so a rename here silently disables three alerts rather than breaking a build.
 * That is the failure mode this file exists to prevent.
 */
const scrape = async () => registry.metrics();

describe('recordHealth', () => {
  beforeEach(() => {
    registry.resetMetrics();
  });

  it('publishes the metric names the alert rules select on', async () => {
    recordHealth('ok', { db: { status: 'up' } });
    const text = await scrape();

    expect(text).toContain('service_health_status');
    expect(text).toContain('service_component_up');
  });

  it('maps each status to the value its alert compares against', async () => {
    for (const [status, value] of [
      ['ok', 2],
      ['degraded', 1],
      ['error', 0],
    ] as const) {
      registry.resetMetrics();
      recordHealth(status, {});
      expect(await scrape()).toMatch(new RegExp(`^service_health_status ${value}$`, 'm'));
    }
  });

  it('labels each dependency by name', async () => {
    recordHealth('degraded', {
      db: { status: 'up' },
      kafka: { status: 'down' },
    });
    const text = await scrape();

    expect(text).toMatch(/^service_component_up\{component="db"\} 1$/m);
    expect(text).toMatch(/^service_component_up\{component="kafka"\} 0$/m);
  });

  it('leaves a never-probed dependency absent rather than reporting it down', async () => {
    // A service still starting up has not failed. Writing 0 here would page on
    // every deploy.
    recordHealth('ok', { kafka: { status: 'unknown' } });

    // The gauge is registered, so its HELP/TYPE header is always emitted. What
    // must be absent is a *sample* — that is what PromQL sees.
    expect(await scrape()).not.toMatch(/^service_component_up\{/m);
  });

  it('treats an unrecognised status as error rather than as healthy', async () => {
    // Failing closed: a typo in a health handler should alert, not reassure.
    recordHealth('sideways' as 'ok', {});

    expect(await scrape()).toMatch(/^service_health_status 0$/m);
  });
});
