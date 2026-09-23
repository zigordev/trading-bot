import * as client from 'prom-client';

import { writeLogRecord } from './json-logger';
import { registry } from './metrics.registry';
import { RecentKeys } from './rum-details';
import { FixedWindowLimiter } from './rum-ingest';
import { pageLabel, rumRejectedTotal } from './rum-metrics';

const DIRECTIVES = [
  'default-src',
  'script-src',
  'script-src-elem',
  'script-src-attr',
  'style-src',
  'style-src-elem',
  'style-src-attr',
  'img-src',
  'font-src',
  'connect-src',
  'media-src',
  'object-src',
  'frame-src',
  'child-src',
  'worker-src',
  'manifest-src',
  'base-uri',
  'form-action',
  'frame-ancestors',
  'require-trusted-types-for',
  'trusted-types',
] as const;

const KNOWN_DIRECTIVES: ReadonlySet<string> = new Set(DIRECTIVES);
const KEYWORDS: ReadonlySet<string> = new Set([
  'inline',
  'eval',
  'wasm-eval',
  'self',
  'trusted-types-policy',
  'trusted-types-sink',
]);
const MAX_REPORTS = 20;
const ORIGIN_LIMIT = 100;
const PATH_LIMIT = 200;
const MAX_LINE = 10_000_000;

export const cspViolationsTotal = new client.Counter({
  name: 'csp_violations_total',
  help: 'Content Security Policy violations reported by browsers, by directive',
  labelNames: ['directive'] as const,
  registers: [registry],
});

for (const directive of [...DIRECTIVES, 'other']) cspViolationsTotal.inc({ directive }, 0);

const limiter = new FixedWindowLimiter(30, 60_000);
const recent = new RecentKeys(10 * 60_000, 500);

interface Violation {
  directive: string;
  blocked: string;
  source?: string;
  line?: number;
  page: string;
  disposition: 'enforce' | 'report';
}

function directiveOf(raw: unknown): string {
  if (typeof raw !== 'string') return 'other';
  const token = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return KNOWN_DIRECTIVES.has(token) ? token : 'other';
}

function blockedOf(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return 'unknown';

  const value = raw.trim();
  if (KEYWORDS.has(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin.slice(0, ORIGIN_LIMIT);
    }
    return url.protocol.replace(/:$/, '').slice(0, 40);
  } catch {
    return /^[a-z][a-z0-9+.-]{0,30}$/i.test(value) ? value.toLowerCase() : 'unknown';
  }
}

function sourceOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  try {
    const url = new URL(raw);
    if (url.pathname.startsWith('/_next/static/')) return url.pathname.slice(0, PATH_LIMIT);
    return url.origin.slice(0, ORIGIN_LIMIT);
  } catch {
    return undefined;
  }
}

function pageOf(raw: unknown): string {
  if (typeof raw !== 'string') return 'other';
  try {
    return pageLabel(new URL(raw).pathname);
  } catch {
    return 'other';
  }
}

function lineOf(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw <= MAX_LINE
    ? raw
    : undefined;
}

function violationFrom(fields: {
  directive: unknown;
  blocked: unknown;
  source: unknown;
  line: unknown;
  page: unknown;
  disposition: unknown;
}): Violation {
  const violation: Violation = {
    directive: directiveOf(fields.directive),
    blocked: blockedOf(fields.blocked),
    page: pageOf(fields.page),
    disposition: fields.disposition === 'enforce' ? 'enforce' : 'report',
  };
  const source = sourceOf(fields.source);
  const line = lineOf(fields.line);
  if (source) violation.source = source;
  if (line) violation.line = line;
  return violation;
}

function parseReports(body: unknown): Violation[] | null {
  if (Array.isArray(body)) {
    return body.slice(0, MAX_REPORTS).flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const { type, body: report, url } = item as Record<string, unknown>;
      if (type !== 'csp-violation' || typeof report !== 'object' || report === null) return [];

      const fields = report as Record<string, unknown>;
      return [
        violationFrom({
          directive: fields.effectiveDirective,
          blocked: fields.blockedURL,
          source: fields.sourceFile,
          line: fields.lineNumber,
          page: fields.documentURL ?? url,
          disposition: fields.disposition,
        }),
      ];
    });
  }

  if (typeof body === 'object' && body !== null && 'csp-report' in body) {
    const report = (body as Record<string, unknown>)['csp-report'];
    if (typeof report !== 'object' || report === null) return null;

    const fields = report as Record<string, unknown>;
    return [
      violationFrom({
        directive: fields['effective-directive'] ?? fields['violated-directive'],
        blocked: fields['blocked-uri'],
        source: fields['source-file'],
        line: fields['line-number'],
        page: fields['document-uri'],
        disposition: fields.disposition,
      }),
    ];
  }

  return null;
}

export type CspOutcome = { ok: true; recorded: number } | { ok: false; status: 400 | 429 };

export function recordCspReports(body: unknown, clientKey: string): CspOutcome {
  if (!limiter.take(clientKey)) {
    rumRejectedTotal.inc({ reason: 'csp_rate_limited' });
    return { ok: false, status: 429 };
  }

  const violations = parseReports(body);
  if (!violations) {
    rumRejectedTotal.inc({ reason: 'csp_malformed' });
    return { ok: false, status: 400 };
  }

  for (const violation of violations) {
    cspViolationsTotal.inc({ directive: violation.directive });
    const key = `${violation.directive}|${violation.blocked}|${violation.source ?? ''}|${violation.page}`;
    if (recent.firstSince(key)) writeLogRecord('warn', { event: 'csp.violation', ...violation });
  }

  return { ok: true, recorded: violations.length };
}

export function resetCspReports(): void {
  recent.clear();
}
