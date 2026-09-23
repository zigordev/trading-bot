import assert from 'node:assert/strict';

import { test } from 'vitest';

import { registry } from './metrics.registry';
import { normalizePage, pageLabel, recordRumEvent, registerRumVocabulary } from './rum-metrics';

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

const rejections = async (reason: string) => {
  const metric = await registry.getSingleMetric('rum_rejected_total')?.get();
  return metric?.values.find((value) => value.labels.reason === reason)?.value;
};

const interactions = async (name: string) => {
  const metric = await registry.getSingleMetric('rum_interactions_total')?.get();
  return metric?.values.find(
    (value) => value.labels.interaction_type === name && value.labels.page === '/'
  )?.value;
};

test('every rejection reason is exported at zero before the first rejection', async () => {
  for (const reason of [
    'rate_limited',
    'malformed',
    'unknown_type',
    'bad_name',
    'unrecordable',
    'batch_too_large',
    'cross_origin',
    'csp_malformed',
    'csp_rate_limited',
  ]) {
    assert.equal(await rejections(reason), 0, reason);
  }
});

test('an app declares its vocabulary at startup, before any beacon has arrived', async () => {
  registerRumVocabulary({ customInteractions: ['pool-created'], pages: ['/', '/pools'] });

  assert.equal(await interactions('pool-created'), 0);
  assert.equal(pageLabel('/pools'), '/pools');
  assert.equal(pageLabel('/somewhere-else'), 'other');
});

test('declaring the same vocabulary twice keeps the counts already recorded', async () => {
  registerRumVocabulary({ customInteractions: ['team-created'], pages: ['/'] });
  recordRumEvent({ type: 'interaction', name: 'team-created', page: '/' });
  registerRumVocabulary({ customInteractions: ['team-created'], pages: ['/'] });

  assert.equal(await interactions('team-created'), 1);
});

test('a name the app never declared still collapses to other', async () => {
  registerRumVocabulary({ customInteractions: ['match-assigned'], pages: ['/'] });
  recordRumEvent({ type: 'interaction', name: 'match-assigned', page: '/' });
  recordRumEvent({ type: 'interaction', name: 'never-declared', page: '/' });

  assert.equal(await interactions('match-assigned'), 1);
  assert.equal(await interactions('other'), 1);
});
