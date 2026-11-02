"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Activity, ArrowRight, Eye, EyeOff, Gauge, Loader2, Wrench } from "lucide-react";
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

const FEATURES = [
  { icon: Gauge, key: "statements" },
  { icon: Activity, key: "diagnostics" },
  { icon: Wrench, key: "operations" },
] as const;

// Illustrative rows for the marketing panel, not data from any server.
const PREVIEW_ROWS = [
  { query: "SELECT * FROM orders WHERE customer_id = $1", calls: "48.201", load: 62 },
  { query: "SELECT id, status FROM invoices WHERE id = ANY($1)", calls: "12.940", load: 21 },
  { query: "UPDATE sessions SET seen_at = now() WHERE id = $1", calls: "9.312", load: 11 },
];

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
    <div className="dark pgg-stage grid min-h-screen text-foreground lg:grid-cols-[minmax(440px,1fr)_minmax(0,1.3fr)]">
      <section className="flex min-h-screen flex-col px-6 py-5 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <BrandMark />
          <LanguageSwitcher />
        </div>

        <div className="pgg-rise mx-auto flex w-full max-w-[360px] flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{t("login.title")}</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{t("login.subtitle")}</p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onLogin)} className="mt-7 space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
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
                  <FormItem>
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
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px]"
                >
                  {lockedSeconds > 0
                    ? t("login.locked", { seconds: lockedSeconds })
                    : loginError}
                </p>
              )}

              <Button type="submit" className="h-10 w-full" disabled={busy}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
                {t("login.submit")}
                {!form.formState.isSubmitting && <ArrowRight />}
              </Button>
            </form>
          </Form>
        </div>

        <p className="text-[11px] text-muted-foreground">{t("nav.tagline")}</p>
      </section>

      <aside
        aria-hidden
        className="pgg-panel hidden flex-col justify-center gap-8 border-l border-border/70 px-12 py-10 lg:flex xl:px-20"
      >
        <h2 className="max-w-xl text-3xl font-semibold leading-tight tracking-tight">
          {t("login.headline")}
        </h2>

        <div className="max-w-2xl overflow-hidden rounded-xl border border-border bg-card/80 shadow-2xl shadow-black/40">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-xs font-semibold">{t("nav.items.statements")}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t("login.previewLabel")}
            </span>
          </div>
          <div className="divide-y divide-border/70">
            {PREVIEW_ROWS.map((row) => (
              <div key={row.query} className="flex items-center gap-4 px-4 py-2.5">
                <code className="min-w-0 flex-1 truncate text-[11px]">{row.query}</code>
                <span className="w-14 text-right font-mono text-[11px] text-muted-foreground">
                  {row.calls}
                </span>
                <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                  <span
                    className={`block h-full rounded-full ${row.load > 40 ? "bg-guardian-amber" : "bg-guardian-lavender"}`}
                    style={{ width: `${row.load}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-border bg-muted/30 px-4 py-3">
            <p className="text-xs font-semibold text-success">
              {t("statements.rules.MISSING_INDEX.title")}
            </p>
            <code className="mt-1 block truncate text-[11px] text-muted-foreground">
              CREATE INDEX CONCURRENTLY ON orders (customer_id);
            </code>
          </div>
        </div>

        <ul className="flex max-w-2xl flex-wrap gap-x-6 gap-y-2">
          {FEATURES.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="h-3.5 w-3.5 text-guardian-lavender" />
              {t(`login.features.${key}.title`)}
            </li>
          ))}
        </ul>
      </aside>

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
