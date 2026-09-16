'use client';

import { createContext, useContext, useMemo } from 'react';
import type { Locale } from './config';
import type { Messages } from './translator';
import { createTranslator } from './translator';

type I18nContextValue = {
  locale: Locale;
  messages: Messages;
  t: ReturnType<typeof createTranslator>;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: Readonly<{
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}>) {
  const t = useMemo(() => createTranslator(messages), [messages]);

  return <I18nContext.Provider value={{ locale, messages, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
