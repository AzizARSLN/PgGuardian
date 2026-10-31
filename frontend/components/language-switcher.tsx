"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOCALES, useI18n } from "@/lib/i18n";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5",
        className
      )}
    >
      <Languages className="mx-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {LOCALES.map((option) => (
        <button
          key={option.code}
          type="button"
          title={option.label}
          aria-pressed={locale === option.code}
          onClick={() => setLocale(option.code)}
          className={cn(
            "h-6 rounded px-2 text-xs font-semibold transition-colors",
            locale === option.code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}
