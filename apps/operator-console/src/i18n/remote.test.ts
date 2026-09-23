import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { health, reportComponent } from '@/observability/health';

import { loadRemoteMessages } from './remote';

describe('loadRemoteMessages', () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).__tolgeeMessagesCache;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('returns null when Tolgee is not configured, without calling fetch', async () => {
    delete process.env.TOLGEE_API_URL;
    delete process.env.TOLGEE_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(loadRemoteMessages('en')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back rather than throwing when the fetch rejects', async () => {
    process.env.TOLGEE_API_URL = 'http://tolgee.invalid';
    process.env.TOLGEE_API_KEY = 'test-key';
    process.env.TOLGEE_PROJECT_ID = '1';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'));

    await expect(loadRemoteMessages('en')).resolves.toBeNull();
  });

  it('falls back rather than throwing when Tolgee answers with an error status', async () => {
    process.env.TOLGEE_API_URL = 'http://tolgee.invalid';
    process.env.TOLGEE_API_KEY = 'test-key';
    process.env.TOLGEE_PROJECT_ID = '1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 500 }) as Response
    );

    await expect(loadRemoteMessages('en')).resolves.toBeNull();
  });

  describe('health', () => {
    const configure = () => {
      process.env.TOLGEE_API_URL = 'http://tolgee.invalid';
      process.env.TOLGEE_API_KEY = 'test-key';
      process.env.TOLGEE_PROJECT_ID = '1';
    };

    const logged = (stdout: { mock: { calls: unknown[][] } }) =>
      stdout.mock.calls.map(([line]) => JSON.parse(String(line)));

    beforeEach(() => {
      reportComponent('tolgee', 'unknown');
    });

    it('reports Tolgee down when it answers with an error status, and says why', async () => {
      configure();
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));

      await loadRemoteMessages('en');

      expect(health().components.tolgee).toEqual({ status: 'down' });
      expect(logged(stdout)).toContainEqual(
        expect.objectContaining({
          event: 'i18n.fallback',
          error: { name: 'HttpError', message: 'Tolgee answered 401' },
        })
      );
    });

    it('keeps Tolgee up when it has nothing to export for a language, and says so', async () => {
      configure();
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ code: 'no_exported_result', params: null }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      );

      await expect(loadRemoteMessages('es')).resolves.toBeNull();

      expect(health().components.tolgee).toEqual({ status: 'up' });
      expect(logged(stdout)).toContainEqual(
        expect.objectContaining({
          event: 'i18n.fallback',
          locale: 'es',
          error: { name: 'NoExport', message: 'Tolgee has no es translations to export' },
        })
      );
    });

    it('reports Tolgee down for any other rejected request', async () => {
      configure();
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 'validation_error' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        )
        .mockResolvedValueOnce(new Response('not json', { status: 400 }));

      await loadRemoteMessages('es');
      expect(health().components.tolgee).toEqual({ status: 'down' });

      reportComponent('tolgee', 'unknown');
      await loadRemoteMessages('es');
      expect(health().components.tolgee).toEqual({ status: 'down' });
    });

    it('reports Tolgee down when the export comes back empty', async () => {
      configure();
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })
      );

      await loadRemoteMessages('en');

      expect(health().components.tolgee).toEqual({ status: 'down' });
    });

    it('reports Tolgee up when it answers, including a 304 for copy it already sent', async () => {
      configure();
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ greeting: 'hello' }), {
            status: 200,
            headers: { 'content-type': 'application/json', etag: '"v1"' },
          })
        )
        .mockResolvedValueOnce(new Response(null, { status: 304 }));

      await expect(loadRemoteMessages('en')).resolves.toEqual({ greeting: 'hello' });
      expect(health().components.tolgee).toEqual({ status: 'up' });

      reportComponent('tolgee', 'unknown');
      const cache = (globalThis as unknown as Record<string, Map<string, { updatedAt: number }>>)
        .__tolgeeMessagesCache;
      cache.get('en')!.updatedAt = 0;

      await expect(loadRemoteMessages('en')).resolves.toEqual({ greeting: 'hello' });
      expect(health().components.tolgee).toEqual({ status: 'up' });
    });
  });
});
