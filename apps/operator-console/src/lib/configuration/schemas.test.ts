import { describe, expect, it } from 'vitest';

import { configResources } from './schemas';

describe('configuration schemas', () => {
  it('defaults the free-form analysis settings record', () => {
    const parsed = configResources['analysis-settings'].schema.parse({
      name: 'a',
      strategyName: 's',
      enabled: true,
    });

    expect(parsed.technicalAnalysisSettings).toEqual({});
  });

  it('coerces the numeric risk profile fields the form submits as strings', () => {
    const parsed = configResources['risk-profiles'].schema.parse({
      name: 'r',
      description: '',
      maximumStopLoss: '2.5',
      minimumStopLoss: '1',
      swingGap: '0.5',
      rrr: '3',
      enabled: true,
    });

    expect(parsed).toMatchObject({
      maximumStopLoss: 2.5,
      minimumStopLoss: 1,
      swingGap: 0.5,
      rrr: 3,
    });
  });

  it('rejects a payload missing its required fields', () => {
    const parsed = configResources['analysis-settings'].schema.safeParse({ enabled: true });

    expect(parsed.success).toBe(false);
  });
});
