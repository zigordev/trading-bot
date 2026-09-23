import { NextResponse, type NextRequest } from 'next/server';

import { contentSecurityPolicy } from '@/lib/csp';

const POLICY_HEADER = 'Content-Security-Policy-Report-Only';

export function proxy(request: NextRequest): NextResponse {
  const policy = contentSecurityPolicy(Buffer.from(crypto.randomUUID()).toString('base64'));
  const headers = new Headers(request.headers);
  headers.set(POLICY_HEADER, policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(POLICY_HEADER, policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|api|rum|health|metrics|.*\\..*).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
