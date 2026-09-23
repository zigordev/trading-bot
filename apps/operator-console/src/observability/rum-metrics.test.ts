import assert from 'node:assert/strict';

import { test } from 'vitest';

import { normalizePage } from './rum-metrics';

/**
 * `normalizePage` turns a browser-supplied path into a Prometheus label. It is
 * the single control standing between an anonymous visitor and unbounded
 * cardinality, so it gets the tests.
 *
 * The `..` case is here because it shipped broken: `..` matches the
 * route-character test (dots are legal in a segment), so `/../../etc/passwd`
 * reached a label verbatim until a probe caught it.
 */

test('keeps real routes intact', () => {
  assert.equal(normalizePage('/'), '/');
  assert.equal(normalizePage('/pools'), '/pools');
  assert.equal(normalizePage('/settings/notifications'), '/settings/notifications');
});

test('collapses identifiers', () => {
  assert.equal(
    normalizePage('/pools/2f8c1e4a-9b3d-4f21-8e77-1a2b3c4d5e6f/accept'),
    '/pools/:id/accept'
  );
  assert.equal(normalizePage('/pools/42'), '/pools/:id');
  assert.equal(normalizePage('/u/aVeryLongOpaqueToken123456'), '/u/:id');
});

test('collapses dot segments', () => {
  assert.equal(normalizePage('/../../etc/passwd'), '/:id/:id/etc/passwd');
  assert.equal(normalizePage('/./x'), '/:id/x');
});

test('drops query strings and fragments, which carry tokens', () => {
  assert.equal(normalizePage('/pools?token=secret'), '/pools');
  assert.equal(normalizePage('/pools#section'), '/pools');
});

test('rejects anything that is not a path', () => {
  assert.equal(normalizePage('https://evil.example/x'), 'other');
  assert.equal(normalizePage(''), 'other');
  assert.equal(normalizePage('pools'), 'other');
});

test('bounds depth and total length', () => {
  assert.equal(normalizePage('/a/b/c/d/e/f/g/h/i'), '/a/b/c/d/e');
  const long = normalizePage(`/${'x'.repeat(200)}`);
  assert.ok(long.length <= 130, long);
});

test('collapses characters a route would not contain', () => {
  assert.equal(normalizePage('/pools/<script>'), '/pools/:id');
  assert.equal(normalizePage('/pools/a b'), '/pools/:id');
});
