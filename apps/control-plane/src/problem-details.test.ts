import { describe, expect, it } from 'vitest';
import { HttpError } from './http-error.js';
import { problemFrom } from './problem-details.js';

describe('problemFrom', () => {
  it('carries the code and params an HttpError supplies', () => {
    const problem = problemFrom(
      new HttpError(409, 'pair with symbol "BTCUSDT" already exists', 'CONFIGURATION.DUPLICATE', {
        entity: 'pair',
      }),
      '/v1/pairs'
    );

    expect(problem).toEqual({
      type: 'https://zigordev.com/problems/configuration-duplicate',
      title: 'Conflict',
      status: 409,
      detail: 'pair with symbol "BTCUSDT" already exists',
      instance: '/v1/pairs',
      code: 'CONFIGURATION.DUPLICATE',
      params: { entity: 'pair' },
    });
  });

  it('derives a code from the status when none is given', () => {
    const problem = problemFrom(new HttpError(404, 'pair 7 was not found'), '/v1/pairs/7');

    expect(problem.code).toBe('HTTP.NOT_FOUND');
    expect(problem.detail).toBe('pair 7 was not found');
  });

  it('names a schema rejection as a validation failure', () => {
    const problem = problemFrom(
      Object.assign(new Error('body must have required property name'), {
        statusCode: 400,
        validation: [{ message: 'must have required property name' }],
      }),
      '/v1/pairs'
    );

    expect(problem.status).toBe(400);
    expect(problem.code).toBe('VALIDATION.FAILED');
  });

  it('says nothing about why a 5xx happened', () => {
    const problem = problemFrom(new Error('relation "pairs" does not exist'), '/v1/pairs');

    expect(problem).toEqual({
      type: 'https://zigordev.com/problems/http-internal-error',
      title: 'Internal server error',
      status: 500,
      instance: '/v1/pairs',
      code: 'HTTP.INTERNAL_ERROR',
    });
  });
});
