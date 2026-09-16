import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LANGUAGE_COOKIE, SUPPORTED_LOCALES, type Locale } from './config';
import { loadMessages } from './messages';
import { createTranslator } from './translator';

function normalizeLocale(value: string | undefined): Locale | null {
  if (!value) return null;
  const base = value.toLowerCase().split('-')[0];
  if (SUPPORTED_LOCALES.includes(base as Locale)) {
    return base as Locale;
  }
  return null;
}

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const stored = cookieStore.get(LANGUAGE_COOKIE)?.value;
  const storedLocale = normalizeLocale(stored);
  if (storedLocale) return storedLocale;

  const headerStore = await headers();
  const header = headerStore.get('accept-language');
  if (header) {
    const candidates = header.split(',').map((part) => part.trim().split(';')[0]);
    for (const candidate of candidates) {
      const locale = normalizeLocale(candidate);
      if (locale) return locale;
    }
  }

  return DEFAULT_LOCALE;
}

export async function getMessages(locale?: Locale) {
  const resolved = locale ?? (await getLocale());
  return loadMessages(resolved);
}

export async function getTranslator(locale?: Locale) {
  const resolved = locale ?? (await getLocale());
  const messages = await loadMessages(resolved);
  return createTranslator(messages);
}
