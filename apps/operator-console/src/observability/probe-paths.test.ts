import assert from 'node:assert/strict';

import { test } from 'vitest';

import { isUnsampledPath, pathOfSpan } from './probe-paths';

test('probes, metrics scrapes, RUM beacons and static files are never sampled', () => {
  for (const path of [
    '/health',
    '/metrics',
    '/rum',
    '/rum/events',
    '/rum/csp',
    '/_next/static/chunks/a.js',
    '/health?probe=1',
  ]) {
    assert.equal(isUnsampledPath(path), true, path);
  }
});

test('everything else is sampled, including paths that merely start like a probe', () => {
  for (const path of [
    '/',
    '/api/contact',
    '/healthz',
    '/metrics-report',
    '/rumours',
    '/_next/image',
    undefined,
    '',
  ]) {
    assert.equal(isUnsampledPath(path), false, String(path));
  }
});

test('the path comes from the newest attribute a span carries', () => {
  assert.equal(pathOfSpan({ 'url.path': '/health', 'http.route': '/api/:id' }), '/health');
  assert.equal(pathOfSpan({ 'http.route': '/metrics' }), '/metrics');
  assert.equal(pathOfSpan({ 'http.target': '/rum/events?x=1' }), '/rum/events?x=1');
  assert.equal(pathOfSpan({ 'url.full': 'http://cv-web:3000/health?x=1' }), '/health');
  assert.equal(pathOfSpan({ 'http.url': 'http://gpool-api:3000/metrics' }), '/metrics');
});

test('a span with no usable path is sampled like any other', () => {
  assert.equal(pathOfSpan({}), undefined);
  assert.equal(pathOfSpan({ 'url.path': '' }), undefined);
  assert.equal(pathOfSpan({ 'url.full': 'not a url' }), undefined);
  assert.equal(pathOfSpan({ 'url.full': 42 }), undefined);
});
