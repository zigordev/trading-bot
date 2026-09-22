import { describe, expect, it } from 'vitest';

import { API_BASE } from './api';
import { contentSecurityPolicy, nonceFrom } from './csp';

describe('contentSecurityPolicy', () => {
  it('vouches for scripts carrying the nonce and reports everything else', () => {
    const policy = contentSecurityPolicy('bm9uY2U=');

    expect(policy).toContain("script-src 'self' 'nonce-bm9uY2U='");
    expect(policy).toContain('report-uri /rum/csp');
  });

  it('lets the console call the control plane and open its ops socket', () => {
    expect(contentSecurityPolicy('n', 'https://control-plane.example.com/')).toContain(
      "connect-src 'self' https://control-plane.example.com wss://control-plane.example.com"
    );
  });

  it('follows the address the console itself calls', () => {
    const { origin } = new URL(API_BASE);

    expect(contentSecurityPolicy('n')).toContain(
      `connect-src 'self' ${origin} ${origin.replace(/^http/, 'ws')}`
    );
  });

  it('allows only its own origin when the address is empty or unreadable', () => {
    expect(contentSecurityPolicy('n', '')).toContain("connect-src 'self';");
  });

  it('lets the pair icons load from the CDN they come from', () => {
    expect(contentSecurityPolicy('n')).toContain("img-src 'self' data: https://cdn.jsdelivr.net");
  });

  it('gives back the nonce a policy carries, so a hand-written script can use it', () => {
    expect(nonceFrom(contentSecurityPolicy('bm9uY2U='))).toBe('bm9uY2U=');
    expect(nonceFrom("default-src 'self'")).toBeUndefined();
    expect(nonceFrom(null)).toBeUndefined();
  });
});
