import { API_BASE } from '@/lib/api-base';

function controlPlaneOrigins(base: string = API_BASE): string[] {
  try {
    const { origin } = new URL(base);
    return [origin, origin.replace(/^http/, 'ws')];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy(nonce: string, base: string = API_BASE): string {
  const connect = ["'self'", ...controlPlaneOrigins(base)].join(' ');

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: https://cdn.jsdelivr.net",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}'`,
    `connect-src ${connect}`,
    'report-uri /rum/csp',
  ].join('; ');
}

export function nonceFrom(policy: string | null | undefined): string | undefined {
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}
