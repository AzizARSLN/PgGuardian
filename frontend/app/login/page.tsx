"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Activity, ArrowRight, Eye, EyeOff, Gauge, Loader2, ShieldCheck, Wrench } from "lucide-react";
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
      toast.error(error instanceof Error ? error.message : t("login.errors.failed"));
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
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-guardian-indigo p-10 text-guardian-lavender-soft lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-guardian-lime text-guardian-indigo">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold text-guardian-white">PgGuardian</span>
        </div>

        <div className="max-w-md space-y-6">
          <h1 className="text-3xl font-bold leading-tight text-guardian-white">
            {t("login.headline")}
          </h1>
          <ul className="space-y-4">
            {FEATURES.map(({ icon: Icon, key }) => (
              <li key={key} className="flex gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-guardian-lime" />
                <div>
                  <p className="text-sm font-semibold text-guardian-white">
                    {t(`login.features.${key}.title`)}
                  </p>
                  <p className="text-[13px] leading-relaxed text-guardian-lavender-soft/80">
                    {t(`login.features.${key}.desc`)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-guardian-lavender-soft/60">{t("nav.tagline")}</p>
      </aside>

      <section className="relative flex items-center justify-center p-6">
        <LanguageSwitcher className="absolute right-4 top-4" />

        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-accent">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <span className="font-bold">PgGuardian</span>
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold">{t("login.title")}</h2>
            <p className="text-[13px] text-muted-foreground">{t("login.subtitle")}</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onLogin)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("login.email")}</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="username" autoFocus disabled={busy} />
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
                          className="pr-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={t(showPassword ? "login.hidePassword" : "login.showPassword")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
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

              {lockedSeconds > 0 && (
                <p role="alert" className="text-[13px] font-medium text-warning">
                  {t("login.locked", { seconds: lockedSeconds })}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {form.formState.isSubmitting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ArrowRight />
                )}
                {t("login.submit")}
              </Button>
            </form>
          </Form>
        </div>
      </section>

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
