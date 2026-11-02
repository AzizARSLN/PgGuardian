"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
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
import PggBackdrop from "@/components/pgg-backdrop";
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
    <div className="pgg-stage flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <PggBackdrop />

      <div className="dark absolute right-4 top-4 z-20">
        <LanguageSwitcher />
      </div>

      <div className="dark relative z-10 w-full max-w-[420px]">
        <div className="pgg-card p-7 sm:p-9">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-accent shadow-lg">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div className="space-y-1">
              <h1 className="text-xl font-bold tracking-tight text-guardian-white">PgGuardian</h1>
              <p className="text-[13px] text-muted-foreground">{t("login.subtitle")}</p>
            </div>
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
                      <Input
                        {...field}
                        autoComplete="username"
                        autoFocus
                        disabled={busy}
                        className="border-white/15 bg-white/5"
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
                          className="border-white/15 bg-white/5 pr-9"
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

        <p className="mt-5 text-center text-[11px] text-guardian-lavender-soft/45">
          {t("nav.tagline")}
        </p>
      </div>

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
