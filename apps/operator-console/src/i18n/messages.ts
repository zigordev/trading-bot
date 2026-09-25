import { recordMessageSource } from '@/observability/app-metrics';
import { writeLogRecord } from '@/observability/json-logger';

import type { Locale } from './config';
import { DEFAULT_LOCALE } from './config';
import { loadLocalMessages } from './local';
import { loadRemoteMessages } from './remote';
import type { MessageValue, Messages } from './translator';

const REPORTED = Symbol.for('operator-console.i18n.listLengthReported');

function isMessageObject(value: MessageValue | undefined): value is Messages {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function reportedLists(): Set<string> {
  const shared = globalThis as typeof globalThis & { [REPORTED]?: Set<string> };
  shared[REPORTED] ??= new Set<string>();
  return shared[REPORTED];
}

function mergeList(base: MessageValue[], override: MessageValue[], path: string): MessageValue[] {
  if (base.length === override.length) {
    return base.map((item, index) => mergeValue(item, override[index], `${path}.${index}`));
  }

  const reported = reportedLists();
  if (!reported.has(path)) {
    reported.add(path);
    writeLogRecord('warn', {
      event: 'i18n.list_length_mismatch',
      key: path,
      committed: base.length,
      remote: override.length,
    });
  }

  return base;
}

function mergeValue(base: MessageValue, override: MessageValue, path: string): MessageValue {
  if (isMessageObject(base) && isMessageObject(override)) {
    return mergeMessages(base, override, path);
  }
  if (Array.isArray(base) && Array.isArray(override)) {
    return mergeList(base, override, path);
  }
  return override;
}

function mergeMessages(base: Messages, override: Messages, path = ''): Messages {
  const merged: Messages = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] =
      current === undefined ? value : mergeValue(current, value, path ? `${path}.${key}` : key);
  }

  return merged;
}

export async function loadMessages(locale: Locale): Promise<Messages> {
  const local = await loadLocalMessages(locale);
  const remote = await loadRemoteMessages(locale);
  if (local && remote) {
    recordMessageSource('merged');
    return mergeMessages(local, remote);
  }
  if (remote) {
    recordMessageSource('remote');
    return remote;
  }
  if (local) {
    recordMessageSource('local');
    return local;
  }

  // Fall back to the default locale when translations for the requested locale
  // are not yet available (e.g. 'en' while only 'es' files exist).
  if (locale !== DEFAULT_LOCALE) {
    recordMessageSource('default_locale');
    return loadMessages(DEFAULT_LOCALE);
  }

  throw new Error(
    `Translations not available for locale "${locale}". ` +
      'Provide local message files or configure Tolgee (TOLGEE_API_URL, TOLGEE_PROJECT_ID, TOLGEE_API_KEY).'
  );
}
