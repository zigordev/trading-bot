import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { resetCspReports } from './csp-reports';
import { createCspReportRoute, registry } from './next';

const POST = createCspReportRoute({ pages: ['/'] });

let nextAddress = 1;
const freshAddress = () => `198.51.100.${nextAddress++}`;

const logged: Record<string, unknown>[] = [];

beforeEach(() => {
  logged.length = 0;
  resetCspReports();
  const capture = (chunk: string | Uint8Array) => {
    logged.push(JSON.parse(String(chunk)) as Record<string, unknown>);
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const report = (body: unknown, contentType: string, address = freshAddress()) =>
  POST(
    new Request('http://0.0.0.0:3001/rum/csp', {
      method: 'POST',
      headers: { 'content-type': contentType, 'x-forwarded-for': address },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

const violations = async (directive: string) => {
  const metric = await registry.getSingleMetric('csp_violations_total')?.get();
  return metric?.values.find((value) => value.labels.directive === directive)?.value ?? 0;
};

const legacy = {
  'csp-report': {
    'document-uri': 'https://cv.zigordev.com/?utm=secret',
    'violated-directive': 'script-src-elem',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'inline',
    'source-file': 'https://cv.zigordev.com/_next/static/chunks/app.js',
    'line-number': 12,
    disposition: 'report',
  },
};

test('a report-uri report is counted by directive and logged without the query string', async () => {
  const before = await violations('script-src-elem');

  const response = await report(legacy, 'application/csp-report');

  assert.equal(response.status, 204);
  assert.equal(await violations('script-src-elem'), before + 1);
  assert.equal(logged.length, 1);
  assert.deepEqual(
    { ...logged[0], timestamp: undefined, service: undefined },
    {
      timestamp: undefined,
      level: 'warn',
      service: undefined,
      event: 'csp.violation',
      directive: 'script-src-elem',
      blocked: 'inline',
      source: '/_next/static/chunks/app.js',
      line: 12,
      page: '/',
      disposition: 'report',
    }
  );
});

test('a Reporting API batch keeps only the blocked origin and ignores other report types', async () => {
  const before = await violations('img-src');

  const response = await report(
    [
      {
        type: 'csp-violation',
        url: 'https://cv.zigordev.com/',
        body: {
          documentURL: 'https://cv.zigordev.com/private/token123',
          effectiveDirective: 'img-src',
          blockedURL: 'https://tracker.example/pixel.gif?id=42',
          disposition: 'enforce',
        },
      },
      { type: 'deprecation', body: { id: 'x' } },
    ],
    'application/reports+json'
  );

  assert.equal(response.status, 204);
  assert.equal(await violations('img-src'), before + 1);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].blocked, 'https://tracker.example');
  assert.equal(logged[0].page, 'other');
  assert.equal(logged[0].disposition, 'enforce');
});

test('the same violation is logged once and counted every time', async () => {
  const before = await violations('script-src-elem');

  await report(legacy, 'application/csp-report');
  await report(legacy, 'application/csp-report');

  assert.equal(await violations('script-src-elem'), before + 2);
  assert.equal(logged.length, 1);
});

test('an unknown directive and an odd blocked value are filed without echoing them', async () => {
  const before = await violations('other');

  await report(
    { 'csp-report': { 'effective-directive': 'made-up-src', 'blocked-uri': 'data:text/html,hi' } },
    'application/csp-report'
  );
  await report(
    { 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': '<svg>' } },
    'application/csp-report'
  );

  assert.equal(await violations('other'), before + 1);
  assert.deepEqual(
    logged.map((line) => line.blocked),
    ['data', 'unknown']
  );
});

test('a body that is not a report is refused, and so is one over the size cap', async () => {
  assert.equal((await report({ hello: 'world' }, 'application/json')).status, 400);
  assert.equal((await report('not json', 'application/csp-report')).status, 400);

  const oversized = await POST(
    new Request('http://0.0.0.0:3001/rum/csp', {
      method: 'POST',
      headers: { 'content-length': String(1024 * 1024), 'x-forwarded-for': freshAddress() },
      body: '{}',
    })
  );
  assert.equal(oversized.status, 413);
});

test('one client is rate limited', async () => {
  const address = freshAddress();
  let last = 0;
  for (let i = 0; i < 31; i += 1) {
    last = (await report(legacy, 'application/csp-report', address)).status;
  }

  assert.equal(last, 429);
});
