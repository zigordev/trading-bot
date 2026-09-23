import { beforeAll, describe, expect, it, vi } from 'vitest';

import { register } from './instrumentation';

vi.mock('@/observability/tracing', () => ({}));
vi.mock('@/observability/standard-events', () => ({
  logServiceStarted: vi.fn(),
  logServiceStopping: vi.fn(),
  observeProcessFailures: vi.fn(),
}));

async function exported(metric: string): Promise<string> {
  const { registry } = await import('@/observability/metrics.registry');
  return (await registry.getSingleMetricAsString(metric)) ?? '';
}

describe('register', () => {
  beforeAll(async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    await register();
  });

  it('declares the page allow-list at boot, not on the first beacon to /rum/events', async () => {
    const { pageLabel } = await import('@/observability/rum-metrics');

    expect(pageLabel('/execution/live')).toBe('/execution/live');
    expect(pageLabel('/configuration')).toBe('/configuration');
    expect(pageLabel('/not-a-console-page')).toBe('other');
  });

  it('exports the interaction series before any beacon has been sent', async () => {
    const interactions = await exported('rum_interactions_total');

    expect(interactions).toMatch(
      /rum_interactions_total(?:_total)?\{interaction_type="Click",page="\/",release="[^"]*"\} 0/
    );
    expect(interactions).toMatch(
      /rum_interactions_total(?:_total)?\{interaction_type="Form Submit",page="\/",release="[^"]*"\} 0/
    );
  });

  it('exports every rejection reason at zero before the first rejection', async () => {
    const rejected = await exported('rum_rejected_total');

    for (const reason of [
      'rate_limited',
      'malformed',
      'unknown_type',
      'bad_name',
      'unrecordable',
      'batch_too_large',
      'cross_origin',
      'csp_malformed',
      'csp_rate_limited',
    ]) {
      expect(rejected).toMatch(
        new RegExp(`rum_rejected_total(?:_total)?\\{reason="${reason}"\\} 0`)
      );
    }
  });
});
