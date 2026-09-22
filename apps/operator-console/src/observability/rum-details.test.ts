import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SourceMapGenerator } from 'source-map-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  logClientError,
  logPoorVital,
  RecentKeys,
  resetRumDetails,
  resolveFrame,
  sanitizeErrorDetail,
  sanitizeTarget,
  setSourceMapRoot,
} from './rum-details';

const lines: Record<string, unknown>[] = [];

beforeEach(() => {
  lines.length = 0;
  resetRumDetails();
  const capture = (chunk: string | Uint8Array) => {
    lines.push(JSON.parse(String(chunk)));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const withSourceMap = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rum-maps-'));
  mkdirSync(path.join(root, 'chunks'));
  const generator = new SourceMapGenerator({ file: 'app.js' });
  generator.addMapping({
    generated: { line: 1, column: 99 },
    original: { line: 42, column: 12 },
    source: 'turbopack:///[project]/apps/web/src/components/AskBar.tsx',
  });
  writeFileSync(path.join(root, 'chunks', 'app.js.map'), generator.toString());
  writeFileSync(path.join(root, 'secret.js.map'), generator.toString());
  return root;
};

describe('sanitizeErrorDetail', () => {
  it('keeps a known type, masks the message and keeps a frame inside the static chunks', () => {
    expect(
      sanitizeErrorDetail({
        type: 'TypeError',
        message: 'Cannot read 12 of null for ana@example.com',
        frame: { file: '/_next/static/chunks/app.js', line: 1, column: 100 },
      })
    ).toEqual({
      type: 'TypeError',
      message: 'Cannot read <n> of null for <email>',
      frame: { file: '/_next/static/chunks/app.js', line: 1, column: 100 },
    });
  });

  it('falls back to Error for a type that is not a plain error name', () => {
    expect(sanitizeErrorDetail({ type: '<script>', message: 'x' })?.type).toBe('Error');
  });

  it('drops frames outside the static chunks, climbing out of them or with bad positions', () => {
    for (const frame of [
      { file: 'https://evil.example/x.js', line: 1, column: 1 },
      { file: '/_next/static/../../etc/passwd.js', line: 1, column: 1 },
      { file: '/_next/static/chunks/app.js', line: 0, column: 1 },
      { file: '/_next/static/chunks/app.js', line: 1.5, column: 1 },
    ]) {
      expect(sanitizeErrorDetail({ type: 'Error', message: 'm', frame })?.frame).toBeUndefined();
    }
  });

  it('refuses anything that is not an object', () => {
    expect(sanitizeErrorDetail('boom')).toBeUndefined();
  });
});

describe('sanitizeTarget', () => {
  it('keeps a css selector and drops markup', () => {
    expect(sanitizeTarget('html>body>div.cv-ask>span.cv-ask-caret')).toBe(
      'html>body>div.cv-ask>span.cv-ask-caret'
    );
    expect(sanitizeTarget('<img src=x onerror=alert(1)>')).toBeUndefined();
    expect(sanitizeTarget(42)).toBeUndefined();
  });
});

describe('resolveFrame', () => {
  it('maps a minified position back to the source line', async () => {
    const root = withSourceMap();
    setSourceMapRoot(root);

    await expect(
      resolveFrame({ file: '/_next/static/chunks/app.js', line: 1, column: 100 })
    ).resolves.toBe('src/components/AskBar.tsx:42:13');
  });

  it('never reads a map outside the static root, even when the path is encoded', async () => {
    const root = withSourceMap();
    setSourceMapRoot(path.join(root, 'chunks'));

    await expect(
      resolveFrame({ file: '/_next/static/%2e%2e/secret.js', line: 1, column: 100 })
    ).resolves.toBe('/_next/static/%2e%2e/secret.js:1:100');
  });

  it('returns the minified position when there is no map', async () => {
    setSourceMapRoot(mkdtempSync(path.join(tmpdir(), 'rum-empty-')));

    await expect(
      resolveFrame({ file: '/_next/static/chunks/missing.js', line: 3, column: 4 })
    ).resolves.toBe('/_next/static/chunks/missing.js:3:4');
  });
});

describe('logClientError', () => {
  it('logs the first of each error once per ten minutes, with its source line', async () => {
    const root = withSourceMap();
    setSourceMapRoot(root);
    const detail = {
      type: 'TypeError',
      message: 'boom <n>',
      frame: { file: '/_next/static/chunks/app.js', line: 1, column: 100 },
    };

    await logClientError(detail, '/', 0);
    await logClientError(detail, '/', 60_000);
    await logClientError(detail, '/', 11 * 60_000);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      level: 'warn',
      event: 'rum.client_error',
      page: '/',
      error: { name: 'TypeError', message: 'boom <n>' },
      source: 'src/components/AskBar.tsx:42:13',
    });
  });
});

describe('logPoorVital', () => {
  it('logs a poor vital with the element behind it, once per window', () => {
    logPoorVital('INP', 612.4, 'button.cv-ask-button', '/', 0);
    logPoorVital('INP', 700, 'button.cv-ask-button', '/', 1000);
    logPoorVital('CLS', 0.31234, undefined, '/', 1000);

    expect(lines).toEqual([
      expect.objectContaining({
        level: 'info',
        event: 'rum.vital_poor',
        metric: 'INP',
        value: 612,
        target: 'button.cv-ask-button',
      }),
      expect.objectContaining({ event: 'rum.vital_poor', metric: 'CLS', value: 0.312 }),
    ]);
  });
});

describe('RecentKeys', () => {
  it('forgets the oldest key when it is full', () => {
    const keys = new RecentKeys(60_000, 2);

    expect(keys.firstSince('a', 0)).toBe(true);
    expect(keys.firstSince('b', 0)).toBe(true);
    expect(keys.firstSince('c', 0)).toBe(true);
    expect(keys.firstSince('a', 1)).toBe(true);
    expect(keys.firstSince('c', 1)).toBe(false);
  });
});
