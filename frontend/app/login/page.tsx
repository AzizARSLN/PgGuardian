"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandMark } from "@/components/brand-mark";
import { useT, type TFunction } from "@/lib/i18n";
import { useAuthStore } from "@/store/useAuthStore";

const loginSchema = (t: TFunction) =>
  z.object({
    email: z
      .string()
      .min(3, { message: t("login.errors.emailShort") })
      .regex(/^\S+@\S+$/, { message: t("login.errors.emailFormat") }),
    password: z.string().min(1, { message: t("login.errors.passwordRequired") }),
  });

const changePasswordSchema = (t: TFunction) =>
  z
    .object({
      current_password: z.string().min(1, { message: t("login.errors.currentRequired") }),
      new_password: z.string().min(8, { message: t("login.errors.newShort") }),
      confirm_password: z.string().min(8, { message: t("login.errors.newShort") }),
    })
    .refine((data) => data.new_password === data.confirm_password, {
      message: t("login.errors.mismatch"),
      path: ["confirm_password"],
    });

type LoginValues = z.infer<ReturnType<typeof loginSchema>>;
type ChangeValues = z.infer<ReturnType<typeof changePasswordSchema>>;

/** Only same-site paths: "//evil.example" would leave the application. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

/**
 * Backdrop texture: the real statements this console issues, rendered as a live
 * statement log so the backdrop reads as a working session, not decoration.
 */
type SqlLogLine = { prompt: string; text: string; meta?: boolean };

const SQL_LOG: SqlLogLine[] = [
  { prompt: "pg=#", text: "SELECT schemaname, relname, n_dead_tup, last_autovacuum FROM pg_stat_user_tables ORDER BY n_dead_tup DESC;" },
  { prompt: "pg=#", text: "SELECT pid, usename, state, wait_event_type, query_start FROM pg_stat_activity WHERE state <> 'idle';" },
  { prompt: "pg=#", text: "SELECT relname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) FROM pg_stat_user_indexes;" },
  { prompt: "pg=#", text: "CREATE INDEX CONCURRENTLY idx_orders_created_at ON public.orders (created_at);" },
  { prompt: "pg=#", text: "VACUUM (ANALYZE, VERBOSE) public.orders;" },
  { prompt: "pg=#", text: "REINDEX INDEX CONCURRENTLY public.idx_orders_created_at;" },
  { prompt: "pg=#", text: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.orders WHERE created_at >= now() - INTERVAL '7 days';" },
  { prompt: "pg=#", text: "SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;" },
  { prompt: "--", meta: true, text: "pg_locks · pg_stat_replication · pg_stat_statements · WAL · dead tuples · bloat · checkpoint" },
  { prompt: "--", meta: true, text: "autovacuum · shared_buffers · index scan · seq scan · replication lag · lock wait · pgbadger" },
];

const SQL_KEYWORD_ALT =
  "SELECT|FROM|WHERE|ORDER BY|GROUP BY|CREATE INDEX CONCURRENTLY|CREATE INDEX|CREATE|INDEX|CONCURRENTLY|VACUUM|ANALYZE|VERBOSE|REINDEX|EXPLAIN|BUFFERS|FORMAT JSON|FORMAT|JSON|DESC|ASC|AND|OR|ON|AS|INTERVAL";
const SQL_SPLIT_RE = new RegExp(`\\b(${SQL_KEYWORD_ALT})\\b`, "g");

/** Colour SQL keywords so the log is legible as SQL at a glance. */
function highlightSql(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  SQL_SPLIT_RE.lastIndex = 0;
  while ((match = SQL_SPLIT_RE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(
      <span key={`${match.index}-${match[0]}`} className="pgg-sql-kw">
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const BACKEND_ERRORS: Record<string, string> = {
  "Invalid credentials.": "login.errors.invalid",
  "Account disabled.": "login.errors.disabled",
};

export default function LoginPage() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = safeNext(searchParams.get("next"));

  const login = useAuthStore((s) => s.login);
  const changePassword = useAuthStore((s) => s.changePassword);

  const [showPassword, setShowPassword] = React.useState(false);
  const [mustChange, setMustChange] = React.useState(false);
  const [lockedSeconds, setLockedSeconds] = React.useState(0);
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const failures = React.useRef(0);

  React.useEffect(() => {
    if (lockedSeconds <= 0) return;
    const timer = setTimeout(() => setLockedSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockedSeconds]);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema(t)),
    defaultValues: { email: "", password: "" },
  });

  const changeForm = useForm<ChangeValues>({
    resolver: zodResolver(changePasswordSchema(t)),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  async function onLogin(values: LoginValues) {
    if (lockedSeconds > 0) return;
    setLoginError(null);
    try {
      await login(values);
      failures.current = 0;
      if (useAuthStore.getState().user?.password_must_change) {
        changeForm.setValue("current_password", values.password);
        setMustChange(true);
        return;
      }
      router.replace(destination);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      const known = BACKEND_ERRORS[detail];
      setLoginError(known ? t(known) : detail || t("login.errors.failed"));
      failures.current += 1;
      if (failures.current >= 3) {
        failures.current = 0;
        setLockedSeconds(5);
      }
    }
  }

  async function onChangePassword(values: ChangeValues) {
    try {
      await changePassword({ current: values.current_password, newPwd: values.new_password });
      toast.success(t("login.passwordChanged"));
      setMustChange(false);
      // The password change revokes sessions, so sign in with the new one.
      await login({ email: form.getValues("email"), password: values.new_password });
      router.replace(destination);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("login.errors.changeFailed"));
    }
  }

  const busy = form.formState.isSubmitting || lockedSeconds > 0;

  return (
    <div className="dark pgg-login relative flex min-h-screen items-center justify-center px-6 py-12 text-foreground">
      {/* Database-flavoured backdrop: a live statement log over a data-grid rhythm. */}
      <div className="pgg-db-backdrop" aria-hidden>
        <div className="pgg-db-grid" />
        <div className="pgg-db-log">
          {SQL_LOG.map((line, index) => (
            <p key={index} className="pgg-db-log-line">
              <span className="pgg-db-log-prompt">{line.prompt}</span>
              <span className={line.meta ? "pgg-db-log-meta" : "pgg-db-log-sql"}>
                {line.meta ? line.text : highlightSql(line.text)}
              </span>
            </p>
          ))}
        </div>
      </div>

      <main className="pgg-rise relative z-10 w-full max-w-[400px] rounded-xl border border-border bg-card p-7 shadow-2xl sm:p-9">
        <div className="flex items-center justify-between gap-4">
          <BrandMark />
          <LanguageSwitcher className="bg-background" />
        </div>

        <div className="mt-8">
          <h1 className="text-xl font-semibold tracking-tight">{t("login.title")}</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{t("login.subtitle")}</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onLogin)} className="mt-6 space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel>{t("login.email")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="username"
                      autoFocus
                      disabled={busy}
                      className="h-10"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel>{t("login.password")}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        disabled={busy}
                        className="h-10 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={t(showPassword ? "login.hidePassword" : "login.showPassword")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {(loginError || lockedSeconds > 0) && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
              >
                {lockedSeconds > 0 ? t("login.locked", { seconds: lockedSeconds }) : loginError}
              </p>
            )}

            <Button type="submit" className="h-10 w-full" disabled={busy}>
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
              {t("login.submit")}
            </Button>
          </form>
        </Form>

        <p className="mt-6 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
          {t("login.footnote")}
        </p>
      </main>

      {/* No way to dismiss: the API refuses everything until the password changes. */}
      <Dialog open={mustChange}>
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("login.changeTitle")}</DialogTitle>
            <DialogDescription>{t("login.changeDescription")}</DialogDescription>
          </DialogHeader>
          <Form {...changeForm}>
            <form onSubmit={changeForm.handleSubmit(onChangePassword)} className="space-y-3">
              {(
                [
                  ["current_password", "login.currentPassword", "current-password"],
                  ["new_password", "login.newPassword", "new-password"],
                  ["confirm_password", "login.confirmPassword", "new-password"],
                ] as const
              ).map(([name, label, autoComplete]) => (
                <FormField
                  key={name}
                  control={changeForm.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t(label)}</FormLabel>
                      <FormControl>
                        <Input {...field} type="password" autoComplete={autoComplete} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              <DialogFooter>
                <Button type="submit" disabled={changeForm.formState.isSubmitting}>
                  {t("login.changeSubmit")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
