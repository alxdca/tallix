import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES, getMonthNames, translate } from '../i18n';

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, any>) => string;
  monthNames: string[];
}

export const I18nContext = createContext<I18nContextType | null>(null);

const STORAGE_KEY = 'tallix_locale';

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) {
    return stored as Locale;
  }
  const browser = navigator.language?.slice(0, 2) as Locale | undefined;
  if (browser && SUPPORTED_LOCALES.includes(browser)) {
    return browser;
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => getInitialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('lang', locale);
  }, [locale]);

  const t = useCallback((key: string, params?: Record<string, any>) => translate(locale, key, params), [locale]);

  const monthNames = useMemo(() => getMonthNames(locale), [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t, monthNames }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
