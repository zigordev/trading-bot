import JSZip from 'jszip';
import type { Locale } from './config';
import type { Messages } from './translator';

type CacheEntry = {
  messages: Messages;
  etag?: string | null;
  lastModified?: string | null;
  updatedAt: number;
};

const CACHE_TTL_MS = 60_000;

/**
 * A dead Tolgee fails fast and falls back. A *slow* one is the dangerous case:
 * `fetch` has no default timeout, so a Tolgee that accepts connections but
 * cannot answer — a stalled database, for instance — would hang every uncached
 * server render for as long as it takes to give up.
 */
const FETCH_TIMEOUT_MS = 3_000;
const cacheKey = '__tolgeeMessagesCache';

function getCache(): Map<string, CacheEntry> {
  const globalAny = globalThis as typeof globalThis & {
    [cacheKey]?: Map<string, CacheEntry>;
  };
  globalAny[cacheKey] ??= new Map<string, CacheEntry>();
  return globalAny[cacheKey];
}

async function parseZip(buffer: ArrayBuffer): Promise<Messages | null> {
  const zip = await JSZip.loadAsync(buffer);
  const jsonFile = Object.values(zip.files).find((file) => file.name.endsWith('.json'));
  if (!jsonFile) return null;
  const content = await jsonFile.async('string');
  return JSON.parse(content) as Messages;
}

function tolgeeIsConfigured(): boolean {
  const apiUrl = process.env.TOLGEE_API_URL?.trim();
  const apiKey = process.env.TOLGEE_API_KEY?.trim();
  const projectId = process.env.TOLGEE_PROJECT_ID?.trim();
  return Boolean(apiUrl && apiKey && projectId);
}

export async function loadRemoteMessages(locale: Locale): Promise<Messages | null> {
  if (!tolgeeIsConfigured()) {
    return null;
  }

  const apiUrl = process.env.TOLGEE_API_URL!;
  const apiKey = process.env.TOLGEE_API_KEY!;
  const projectId = process.env.TOLGEE_PROJECT_ID!;

  const cache = getCache();
  const cached = cache.get(locale);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return cached.messages;
  }

  const url = new URL(`/v2/projects/${projectId}/export`, apiUrl);
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('languages', locale);
  url.searchParams.set('structureDelimiter', '');

  const headers: Record<string, string> = {
    'X-API-Key': apiKey,
  };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

  // Everything past this point is best-effort. Translations must never be the
  // reason a page fails to render: a connection error, a timeout or a malformed
  // body all fall back to the cached copy, and failing that to null, which
  // `loadMessages` resolves from the committed message files instead.
  try {
    const response = await fetch(url.toString(), {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status === 304 && cached) {
      cached.updatedAt = Date.now();
      return cached.messages;
    }
    if (!response.ok) {
      return cached?.messages ?? null;
    }

    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    const contentType = response.headers.get('content-type') ?? '';

    let messages: Messages | null = null;
    if (
      contentType.includes('application/zip') ||
      contentType.includes('application/octet-stream')
    ) {
      const buffer = await response.arrayBuffer();
      messages = await parseZip(buffer);
    } else {
      messages = (await response.json()) as Messages;
    }

    if (!messages) return cached?.messages ?? null;

    cache.set(locale, {
      messages,
      etag,
      lastModified,
      updatedAt: Date.now(),
    });

    return messages;
  } catch (error) {
    console.warn(
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
      `[i18n] Tolgee fetch failed for "${locale}"; using ${cached ? 'cached' : 'local'} messages.`,
      error instanceof Error ? error.message : error
    );
    return cached?.messages ?? null;
  }
}
