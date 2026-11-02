"use client";

import * as React from "react";
import { messages, type Locale } from "@/messages";

export const LOCALES: { code: Locale; label: string; short: string }[] = [
  { code: "tr", label: "Türkçe", short: "TR" },
  { code: "en", label: "English", short: "EN" },
];
export const LOCALE_COOKIE = "pgg_locale";
export const DEFAULT_LOCALE: Locale = "tr";

type Vars = Record<string, string | number>;
export type TFunction = (key: string, vars?: Vars) => string;

let activeLocale: Locale = DEFAULT_LOCALE;

function lookup(locale: Locale, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      messages[locale]
    );
  return typeof value === "string" ? value : undefined;
}

function translate(locale: Locale, key: string, vars?: Vars): string {
  const fallback = locale === "tr" ? "en" : "tr";
  const text = lookup(locale, key) ?? lookup(fallback, key) ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`
  );
}

/** For code outside React, such as the API client and auth store. */
export const tGlobal: TFunction = (key, vars) => translate(activeLocale, key, vars);

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);
  activeLocale = locale;

  const setLocale = React.useCallback((next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    setLocaleState(next);
  }, []);

  const value = React.useMemo<I18nValue>(() => {
    const tag = locale === "tr" ? "tr-TR" : "en-US";
    return {
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
      formatNumber: (n, options) => new Intl.NumberFormat(tag, options).format(n),
      formatDate: (d, options) =>
        new Intl.DateTimeFormat(tag, options ?? { dateStyle: "short", timeStyle: "medium" }).format(
          new Date(d)
        ),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = React.useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

export function useT(): TFunction {
  return useI18n().t;
}
