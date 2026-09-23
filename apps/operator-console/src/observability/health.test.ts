import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { health, reportComponent } from './health';
import { registry } from './metrics.registry';

const componentGauge = async (name: string) => {
  const metric = await registry.getSingleMetric('service_component_up')?.get();
  return metric?.values.find((value) => value.labels.component === name)?.value;
};

describe('health', () => {
  const tolgee = process.env.TOLGEE_API_URL;

  beforeEach(() => {
    reportComponent('tolgee', 'unknown');
  });

  afterEach(() => {
    if (tolgee === undefined) delete process.env.TOLGEE_API_URL;
    else process.env.TOLGEE_API_URL = tolgee;
  });

  it('lists no components while Tolgee is not configured', () => {
    delete process.env.TOLGEE_API_URL;

    const body = health();

    expect(body.status).toBe('ok');
    expect(body.service).toBe('trading-bot-operator-console');
    expect(body.components).toEqual({});
  });

  it('watches Tolgee once it is configured', () => {
    process.env.TOLGEE_API_URL = 'http://tolgee:8080';

    expect(health().components).toEqual({ tolgee: { status: 'unknown' } });
  });

  it('is degraded, never an error, when Tolgee is down: the page renders from its own copy', async () => {
    process.env.TOLGEE_API_URL = 'http://tolgee:8080';
    reportComponent('tolgee', 'down');

    expect(health().status).toBe('degraded');
    expect(await componentGauge('tolgee')).toBe(0);
  });

  it('comes back to ok when Tolgee does', async () => {
    process.env.TOLGEE_API_URL = 'http://tolgee:8080';
    reportComponent('tolgee', 'down');
    health();
    reportComponent('tolgee', 'up');

    expect(health().status).toBe('ok');
    expect(await componentGauge('tolgee')).toBe(1);
  });
});
