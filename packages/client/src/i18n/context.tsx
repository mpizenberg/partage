/**
 * Internationalization (i18n) context for Partage
 *
 * Provides:
 * - Locale detection from browser with fallback to English
 * - Locale persistence in localStorage
 * - Translation function with interpolation support
 * - Reactive locale switching
 */

import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  type Component,
  type JSX,
  type Accessor,
} from 'solid-js';

// Supported locales
export type Locale = 'en' | 'fr' | 'es';

const SUPPORTED_LOCALES: Locale[] = ['en', 'fr', 'es'];
const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'partage-locale';

// Translation dictionary type (nested object with string values)
type TranslationDict = {
  [key: string]: string | TranslationDict;
};

// Context value interface
interface I18nContextValue {
  /** Current locale signal */
  locale: Accessor<Locale>;
  /** Change the current locale (persists to localStorage) */
  setLocale: (locale: Locale) => void;
  /** Translate a key with optional interpolation parameters */
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>();

/**
 * Detect browser locale with fallback
 */
function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

  const browserLang = navigator.language.split('-')[0];
  return SUPPORTED_LOCALES.includes(browserLang as Locale)
    ? (browserLang as Locale)
    : DEFAULT_LOCALE;
}

/**
 * Load stored locale from localStorage
 */
function loadStoredLocale(): Locale | null {
  if (typeof localStorage === 'undefined') return null;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) {
    return stored as Locale;
  }
  return null;
}

/**
 * Save locale to localStorage
 */
function saveLocale(locale: Locale): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, locale);
  }
}

/**
 * Get initial locale (stored > browser > default)
 */
function getInitialLocale(): Locale {
  return loadStoredLocale() ?? detectBrowserLocale();
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: TranslationDict, path: string): string | undefined {
  const keys = path.split('.');
  let value: TranslationDict | string | undefined = obj;

  for (const key of keys) {
    if (value === undefined || typeof value === 'string') {
      return undefined;
    }
    value = value[key];
  }

  return typeof value === 'string' ? value : undefined;
}

/**
 * Interpolate parameters into a string
 * Replaces {paramName} with the corresponding value
 */
function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value !== undefined ? String(value) : `{${key}}`;
  });
}

/**
 * I18n Provider Component
 */
export const I18nProvider: Component<{ children: JSX.Element }> = (props) => {
  const [locale, setLocaleSignal] = createSignal<Locale>(getInitialLocale());
  const [dictionary, setDictionary] = createSignal<TranslationDict>({});

  // Load dictionary when locale changes
  createEffect(() => {
    const currentLocale = locale();
    loadDictionary(currentLocale);
  });

  // Load dictionary dynamically
  async function loadDictionary(loc: Locale): Promise<void> {
    try {
      // Dynamic import for the locale file
      const module = await import(`./locales/${loc}.json`);
      setDictionary(module.default || module);
    } catch (error) {
      console.error(`Failed to load locale ${loc}:`, error);
      // Fallback to English if loading fails
      if (loc !== DEFAULT_LOCALE) {
        const fallback = await import(`./locales/${DEFAULT_LOCALE}.json`);
        setDictionary(fallback.default || fallback);
      }
    }
  }

  // Change locale and persist
  function setLocale(newLocale: Locale): void {
    setLocaleSignal(newLocale);
    saveLocale(newLocale);
  }

  // Translation function
  function t(key: string, params?: Record<string, string | number>): string {
    const dict = dictionary();
    const value = getNestedValue(dict, key);

    if (value === undefined) {
      // Return key as fallback (helps identify missing translations)
      console.warn(`Missing translation: ${key}`);
      return key;
    }

    return params ? interpolate(value, params) : value;
  }

  const contextValue: I18nContextValue = {
    locale,
    setLocale,
    t,
  };

  return <I18nContext.Provider value={contextValue}>{props.children}</I18nContext.Provider>;
};

/**
 * Hook to access i18n context
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
