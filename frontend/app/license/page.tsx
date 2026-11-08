"use client";

import * as React from "react";
import { toast } from "sonner";
import { BadgeCheck, BadgeX, KeyRound, Loader2, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RiskBadge } from "@/components/ui/risk-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { IfAdmin } from "@/components/role-guard";
import { useI18n } from "@/lib/i18n";
import { licenseApi, type LicenseStatus } from "@/lib/api/license";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm text-foreground">{value}</p>
    </div>
  );
}

export default function LicensePage() {
  const { t, formatDate } = useI18n();
  const [status, setStatus] = React.useState<LicenseStatus | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [key, setKey] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setStatus(await licenseApi.status());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleActivate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      setStatus(await licenseApi.activate(trimmed));
      setKey("");
      toast.success(t("license.toast.activated"));
    } catch {
      // The API client already surfaced the backend's message.
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await licenseApi.remove();
      await load();
      toast.success(t("license.toast.removed"));
    } catch {
      // Handled by the API client toast.
    } finally {
      setRemoving(false);
    }
  };

  const licensed = Boolean(status?.licensed);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            {t("license.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{t("license.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t("license.refresh")}
        </Button>
      </div>

      <section className="space-y-3 rounded-md border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">{t("license.status.title")}</h2>
          <div className="flex items-center gap-2">
            <RiskBadge riskLevel="INFO" size="sm" showIcon={false}>
              {status?.enforced ? t("license.enforced") : t("license.notEnforced")}
            </RiskBadge>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <RiskBadge riskLevel={licensed ? "OK" : "WARNING"} size="sm">
                {licensed ? t("license.status.licensed") : t("license.status.unlicensed")}
              </RiskBadge>
            )}
          </div>
        </div>

        {failed ? (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            {t("common.loadFailed")}
          </p>
        ) : licensed && status ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("license.status.plan")} value={status.plan ?? t("license.perpetual")} />
            <Field label={t("license.status.email")} value={status.email ?? "—"} />
            <Field
              label={t("license.status.issuedAt")}
              value={status.issued_at ? formatDate(status.issued_at) : "—"}
            />
            <Field
              label={t("license.status.expiresAt")}
              value={
                status.expires_at
                  ? formatDate(status.expires_at)
                  : t("license.status.perpetual")
              }
            />
            <Field
              label={t("license.status.activatedAt")}
              value={status.activated_at ? formatDate(status.activated_at) : "—"}
            />
          </div>
        ) : (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <BadgeX className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium text-foreground">{t("license.empty.title")}</p>
              <p className="text-xs">{status?.message ?? t("license.empty.hint")}</p>
            </div>
          </div>
        )}

        <IfAdmin>
          {licensed && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={removing}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("license.remove.action")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("license.remove.title")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("license.remove.description")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleRemove()}>
                    {t("license.remove.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </IfAdmin>
      </section>

      <IfAdmin
        fallback={
          <p className="flex items-center gap-2 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            {t("license.adminOnly")}
          </p>
        }
      >
        <section className="space-y-3 rounded-md border border-border bg-card p-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <BadgeCheck className="h-3.5 w-3.5 text-muted-foreground" />
              {t("license.activate.title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("license.activate.description")}
            </p>
          </div>
          <form onSubmit={handleActivate} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="license-key">{t("license.activate.label")}</Label>
              <Input
                id="license-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={t("license.activate.placeholder")}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>
            <Button type="submit" size="sm" disabled={submitting || !key.trim()}>
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              {submitting ? t("license.activate.activating") : t("license.activate.submit")}
            </Button>
          </form>
        </section>
      </IfAdmin>
    </div>
  );
}
