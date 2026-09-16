import type { Locale } from './config';
import { DEFAULT_LOCALE } from './config';
import { loadLocalMessages } from './local';
import { loadRemoteMessages } from './remote';
import type { MessageValue, Messages } from './translator';

function isMessageObject(value: MessageValue | undefined): value is Messages {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function mergeMessages(base: Messages, override: Messages): Messages {
  const merged: Messages = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isMessageObject(current) && isMessageObject(value)) {
      merged[key] = mergeMessages(current, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export async function loadMessages(locale: Locale) {
  const local = await loadLocalMessages(locale);
  const remote = await loadRemoteMessages(locale);
  if (local && remote) return mergeMessages(local, remote);
  if (remote) return remote;
  if (local) return local;

  // Fall back to the default locale when translations for the requested locale
  // are not yet available (e.g. 'en' while only 'es' files exist).
  if (locale !== DEFAULT_LOCALE) return loadMessages(DEFAULT_LOCALE);

  throw new Error(
    `Translations not available for locale "${locale}". ` +
      'Provide local message files or configure Tolgee (TOLGEE_API_URL, TOLGEE_PROJECT_ID, TOLGEE_API_KEY).'
  );
}
