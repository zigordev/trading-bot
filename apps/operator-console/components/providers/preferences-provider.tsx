'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { translate, type Language } from '@/lib/i18n/messages';

export type ThemeMode = 'light' | 'dark';
export type Translate = (key: string, params?: Record<string, string | number>) => string;

interface PreferencesContextValue {
  language: Language;
  theme: ThemeMode;
  setLanguage: (language: Language) => void;
  setTheme: (theme: ThemeMode) => void;
  t: Translate;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

const initialLanguage = (): Language => {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem('operator-console-language');
  if (stored === 'en' || stored === 'es') return stored;
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
};

const initialTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('operator-console-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function PreferencesProvider({ children }: { children?: React.ReactNode }) {
  const [language, updateLanguage] = useState<Language>('en');
  const [theme, updateTheme] = useState<ThemeMode>('light');

  useEffect(() => {
    updateLanguage(initialLanguage());
    updateTheme(initialTheme());
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem('operator-console-language', language);
  }, [language]);

  useEffect(() => {
    // `data-theme="operator-console"` (set once in layout.tsx) is the
    // product-theme selector; `data-mode` is the orthogonal light/dark
    // selector — matching kini/gpool's own convention
    // (`:root[data-theme="X"][data-mode="dark"]` in design-system's theme
    // files), so the two never collide on the same attribute.
    document.documentElement.dataset.mode = theme;
    window.localStorage.setItem('operator-console-theme', theme);
  }, [theme]);

  const setLanguage = useCallback((next: Language) => updateLanguage(next), []);
  const setTheme = useCallback((next: ThemeMode) => updateTheme(next), []);
  const t = useCallback<Translate>((key, params) => translate(language, key, params), [language]);

  const value = useMemo(
    () => ({ language, theme, setLanguage, setTheme, t }),
    [language, setLanguage, setTheme, t, theme]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export const usePreferences = () => {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return value;
};
