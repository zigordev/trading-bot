import type { FastifyInstance } from 'fastify';

import { defaultCodeFor, HttpError } from './http-error.js';

export const PROBLEM_TYPE_BASE = 'https://zigordev.com/problems';
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  params?: Record<string, unknown>;
}

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  422: 'Unprocessable entity',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

export const problemTypeFor = (code: string): string =>
  `${PROBLEM_TYPE_BASE}/${code.toLowerCase().replace(/[._]/g, '-')}`;

const hasStatusCode = (error: unknown): error is { statusCode: number } =>
  typeof error === 'object' &&
  error !== null &&
  'statusCode' in error &&
  typeof (error as { statusCode: unknown }).statusCode === 'number';

const isValidationError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'validation' in error &&
  Array.isArray((error as { validation: unknown }).validation);

export const problemFrom = (error: unknown, instance: string): ProblemDetails => {
  const status =
    error instanceof HttpError ? error.statusCode : hasStatusCode(error) ? error.statusCode : 500;

  const code =
    error instanceof HttpError
      ? error.code
      : isValidationError(error)
        ? 'VALIDATION.FAILED'
        : defaultCodeFor(status);

  const problem: ProblemDetails = {
    type: problemTypeFor(code),
    title: TITLES[status] ?? 'Error',
    status,
    instance,
    code,
  };

  // A 5xx says what failed and nothing about why: a driver message reaching a
  // client is how internals leak.
  if (status < 500) {
    if (error instanceof Error && error.message.trim()) {
      problem.detail = error.message;
    }
    if (error instanceof HttpError && error.params) {
      problem.params = error.params;
    }
  }

  return problem;
};

export const registerProblemErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler((error, request, reply) => {
    const problem = problemFrom(error, request.url);

    if (problem.status >= 500) {
      app.log.error(error, 'Unhandled control-plane error');
    } else {
      app.log.warn({ err: error, statusCode: problem.status }, 'Control-plane request failed');
    }

    reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
  });
};
