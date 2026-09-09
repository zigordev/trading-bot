export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly params?: Record<string, unknown>;

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    params?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code ?? defaultCodeFor(statusCode);
    this.params = params;
  }
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'HTTP.BAD_REQUEST',
  401: 'HTTP.UNAUTHORIZED',
  403: 'HTTP.FORBIDDEN',
  404: 'HTTP.NOT_FOUND',
  409: 'HTTP.CONFLICT',
  422: 'HTTP.UNPROCESSABLE_ENTITY',
  429: 'HTTP.TOO_MANY_REQUESTS',
  503: 'HTTP.SERVICE_UNAVAILABLE',
};

export const defaultCodeFor = (statusCode: number): string =>
  DEFAULT_CODES[statusCode] ?? (statusCode >= 500 ? 'HTTP.INTERNAL_ERROR' : 'HTTP.ERROR');
