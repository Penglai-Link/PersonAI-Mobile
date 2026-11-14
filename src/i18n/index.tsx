import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { enMessages } from "./messages";

export type Language = "zh" | "en";

const LANGUAGE_KEY = "@personai/language/v1";

let currentLanguage: Language = "zh";

export function translate(source: string, context?: string): string {
  if (currentLanguage === "zh") return source;
  if (context) {
    const contextual = enMessages[`${source}#${context}`];
    if (contextual) return contextual;
  }
  return enMessages[source] ?? source;
}

/** Interpolates `{name}` placeholders after translation. */
export function formatMessage(
  source: string,
  values: Record<string, string | number>,
): string {
  return translate(source).replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

function detectLanguage(): Language {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? "";
    return locale.toLowerCase().startsWith("en") ? "en" : "zh";
  } catch {
    return "zh";
  }
}

function isLanguage(value: unknown): value is Language {
  return value === "zh" || value === "en";
}

interface I18nContextValue {
  ready: boolean;
  language: Language;
  setLanguage: (language: Language) => void;
  t: typeof translate;
  format: typeof formatMessage;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [language, setLanguageState] = useState<Language>(() => detectLanguage());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
        if (!cancelled && isLanguage(stored)) {
          currentLanguage = stored;
          setLanguageState(stored);
        }
      } catch {
        // Keep the detected language when storage is unavailable.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((next: Language) => {
    currentLanguage = next;
    setLanguageState(next);
    void AsyncStorage.setItem(LANGUAGE_KEY, next).catch(() => undefined);
  }, []);

  // Keep the module-level language in sync before children render.
  currentLanguage = language;

  const value = useMemo<I18nContextValue>(
    () => ({
      ready,
      language,
      setLanguage,
      t: translate,
      format: formatMessage,
    }),
    [language, ready, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside LanguageProvider");
  }
  return context;
}