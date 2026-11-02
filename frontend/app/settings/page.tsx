"use client";

import * as React from "react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  AlertCircle,
  KeyRound,
  Languages,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Sun,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RiskBadge } from "@/components/ui/risk-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { LOCALES, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";
import { useAuthStore } from "@/store/useAuthStore";

const MIN_PASSWORD_LENGTH = 8;
const POLL_SECONDS = [3, 10, 30, 60, 300];

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { t, locale, setLocale, formatNumber } = useI18n();
  const { theme, setTheme } = useTheme();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const setPollInterval = useUIPrefsStore((s) => s.setPollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const setAutoRefresh = useUIPrefsStore((s) => s.setAutoRefresh);
  const changePassword = useAuthStore((s) => s.changePassword);

  // next-themes only knows the stored theme in the browser.
  const [mounted, setMounted] = useState(false);
  React.useEffect(() => setMounted(true), []);

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const clearPasswordForm = () => {
    setCurrentPw("");
    setNewPw("");
    setNewPw2("");
  };

  const mismatch = Boolean(newPw && newPw2 && newPw !== newPw2);
  const tooShort = Boolean(newPw && newPw.length < MIN_PASSWORD_LENGTH);

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPw || tooShort || mismatch || !newPw || !newPw2) return;
    setPwSubmitting(true);
    try {
      await changePassword({ current: currentPw, newPwd: newPw });
      toast.success(t("settings.security.changed"));
      setPasswordDialogOpen(false);
      clearPasswordForm();
    } catch {
      // The API client already showed the backend's message; the dialog stays open.
    } finally {
      setPwSubmitting(false);
    }
  };

  const themeOptions = [
    { val: "light", label: t("settings.theme.light"), icon: Sun },
    { val: "dark", label: t("settings.theme.dark"), icon: Moon },
    { val: "system", label: t("settings.theme.system"), icon: Monitor },
  ];

  return (
    <div className="space-y-3">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Settings className="h-4 w-4 text-muted-foreground" />
          {t("settings.title")}
        </h1>
        <p className="text-xs text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        <Section
          icon={Palette}
          title={t("settings.theme.title")}
          description={t("settings.theme.description")}
        >
          <div
            role="radiogroup"
            aria-label={t("settings.theme.title")}
            className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
          >
            {themeOptions.map((option) => {
              const active = mounted && theme === option.val;
              return (
                <button
                  key={option.val}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(option.val)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <option.icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          icon={Languages}
          title={t("settings.language.title")}
          description={t("settings.language.description")}
        >
          <Select value={locale} onValueChange={(v) => setLocale(v as typeof locale)}>
            <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("settings.language.title")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section
          icon={RefreshCw}
          title={t("settings.refresh.title")}
          description={t("settings.refresh.description")}
        >
          <div className="flex items-center gap-2">
            <RiskBadge riskLevel={autoRefresh ? "OK" : "WARNING"} size="sm" showIcon={false}>
              {autoRefresh ? t("settings.refresh.on") : t("settings.refresh.off")}
            </RiskBadge>
            <Switch
              checked={autoRefresh}
              onCheckedChange={(v) => setAutoRefresh(Boolean(v))}
              aria-label={t("settings.refresh.title")}
            />
          </div>
        </Section>

        <Section
          icon={RefreshCw}
          title={t("settings.refresh.pollTitle")}
          description={
            autoRefresh ? t("settings.refresh.pollDescription") : t("settings.refresh.pollDisabled")
          }
        >
          <Select
            value={String(pollInterval)}
            onValueChange={(v) => setPollInterval(Number(v))}
            disabled={!autoRefresh}
          >
            <SelectTrigger
              className="h-8 w-40 font-mono text-xs"
              aria-label={t("settings.refresh.pollTitle")}
            >
              <SelectValue placeholder={t("settings.refresh.pollPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {POLL_SECONDS.map((seconds) => (
                <SelectItem key={seconds} value={String(seconds * 1000)}>
                  {t("settings.refresh.seconds", { seconds: formatNumber(seconds) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section
          icon={Shield}
          title={t("settings.security.title")}
          description={t("settings.security.description")}
        >
          <Dialog
            open={passwordDialogOpen}
            onOpenChange={(open) => {
              setPasswordDialogOpen(open);
              if (!open) clearPasswordForm();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <KeyRound className="h-3.5 w-3.5" />
                {t("settings.security.change")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("settings.security.change")}</DialogTitle>
                <DialogDescription>{t("settings.security.dialogDescription")}</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmitPassword} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="current-password">{t("settings.security.current")}</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-password">{t("settings.security.new")}</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                  />
                  {tooShort && (
                    <p className="text-xs text-destructive">
                      {t("settings.security.tooShort", { min: MIN_PASSWORD_LENGTH })}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-password-2">{t("settings.security.repeat")}</Label>
                  <Input
                    id="new-password-2"
                    type="password"
                    autoComplete="new-password"
                    value={newPw2}
                    onChange={(e) => setNewPw2(e.target.value)}
                  />
                  {mismatch && (
                    <p className="flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {t("settings.security.mismatch")}
                    </p>
                  )}
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPasswordDialogOpen(false);
                      clearPasswordForm();
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={pwSubmitting || !currentPw || !newPw || !newPw2 || mismatch || tooShort}
                  >
                    {pwSubmitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {t("common.save")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </Section>
      </div>
    </div>
  );
}
