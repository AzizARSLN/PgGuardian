"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Eye, EyeOff, ArrowRight, DatabaseZap, Shield, Activity, TerminalSquare } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

import { useAuthStore } from "@/store/useAuthStore";

const loginSchema = z.object({
  email: z
    .string()
    .min(3, { message: "E-posta en az 3 karakter olmalı" })
    .regex(/^\S+@\S+$/, { message: "Geçerli bir e-posta formatı girin (ör: admin@local)" }),
  password: z.string().min(6, { message: "Şifre en az 6 karakter olmalı" }),
  remember: z.boolean().optional(),
});

const changePasswordSchema = z
  .object({
    current_password: z
      .string()
      .min(1, { message: "Mevcut şifre boş olamaz" }),
    new_password: z
      .string()
      .min(8, { message: "Yeni şifre en az 8 karakter olmalı" }),
    confirm_password: z
      .string()
      .min(8, { message: "Şifre tekrarı en az 8 karakter olmalı" }),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Şifreler eşleşmiyor",
    path: ["confirm_password"],
  });

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const forceChange = searchParams.get("force_change") === "1";

  const login = useAuthStore((s) => s.login);
  const changePassword = useAuthStore((s) => s.changePassword);
  const user = useAuthStore((s) => s.user);

  const [showPwd, setShowPwd] = React.useState(false);
  const [showNewPwd, setShowNewPwd] = React.useState(false);
  const [failedAttempts, setFailedAttempts] = React.useState(0);
  const [throttleUntil, setThrottleUntil] = React.useState(0);
  const [now, setNow] = React.useState(Date.now());

  const [changeDialogOpen, setChangeDialogOpen] = React.useState(false);

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    if (forceChange) {
      setChangeDialogOpen(true);
    }
  }, [forceChange]);

  React.useEffect(() => {
    if (user?.password_must_change) {
      setChangeDialogOpen(true);
    }
  }, [user?.password_must_change]);

  const isThrottled = throttleUntil > now;
  const throttleRemaining = Math.max(0, Math.ceil((throttleUntil - now) / 1000));

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "admin@local",
      password: "",
      remember: true,
    },
  });

  const changeForm = useForm<z.infer<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: "",
    },
  });

  async function onSubmitLogin(values: z.infer<typeof loginSchema>) {
    if (isThrottled) return;

    try {
      await login({ email: values.email, password: values.password });
      toast.success("Giriş başarılı");
      const state = useAuthStore.getState();
      if (!state.user?.password_must_change) {
        router.push(next || "/dashboard");
      }
      setFailedAttempts(0);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Giriş başarısız";
      toast.error(msg);
      const newCount = failedAttempts + 1;
      setFailedAttempts(newCount);
      if (newCount >= 3) {
        const until = Date.now() + 5000;
        setThrottleUntil(until);
        toast.warning(
          "Çok fazla hatalı giriş. 5 saniye boyunca giriş devre dışı."
        );
        setTimeout(() => {
          setFailedAttempts(0);
          setThrottleUntil(0);
        }, 5000);
      }
    }
  }

  async function onSubmitChangePassword(
    values: z.infer<typeof changePasswordSchema>
  ) {
    try {
      await changePassword({
        current: values.current_password,
        newPwd: values.new_password,
      });
      toast.success("Şifreniz başarıyla değiştirildi");
      setChangeDialogOpen(false);
      changeForm.reset();
      router.push(next || "/dashboard");
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Şifre değiştirilemedi";
      toast.error(msg);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 items-center">
        <div className="space-y-8 order-2 lg:order-1 hidden lg:block">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-3 rounded-full bg-white/5 border border-white/10 backdrop-blur-md px-5 py-3">
              <div className="h-9 w-9 rounded-full bg-gradient-accent flex items-center justify-center">
                <DatabaseZap className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-gradient">PgGuardian</p>
                <p className="text-[11px] text-muted-foreground">v1.0.0</p>
              </div>
            </div>

            <h1 className="text-4xl lg:text-5xl font-bold leading-[1.05]">
              PostgreSQL{" "}
              <span className="text-gradient">Yönetim</span>
              <br />
              ve <span className="text-gradient">Teşhis</span> Merkezi
            </h1>

            <p className="text-base text-muted-foreground max-w-xl leading-relaxed">
              Bağlantı yönetimi, performans teşhisi, SQL düzenleyici,
              sorgu yönetimi, yedekleme ve bakım işlemleri için tek panel.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              {
                icon: Activity,
                title: "Gerçek Zamanlı Teşhis",
                desc: "Canlı sorgular, kilitler ve sağlık",
              },
              {
                icon: TerminalSquare,
                title: "SQL Editör",
                desc: "Syntax ve güvenlik sınıflandırması",
              },
              {
                icon: Shield,
                title: "Güvenli Profil",
                desc: "Şifreleri yerel AES-256 ile sakla",
              },
              {
                icon: DatabaseZap,
                title: "Bakım & Yedekleme",
                desc: "VACUUM, REINDEX, snapshot ve rapor",
              },
            ].map((f) => (
              <Card
                key={f.title}
                className="bg-white/5 backdrop-blur-md border-white/10 shadow-xl"
              >
                <CardContent className="p-4 space-y-2">
                  <div className="h-9 w-9 rounded-full bg-gradient-accent/20 flex items-center justify-center">
                    <f.icon className="h-4 w-4 text-gradient" />
                  </div>
                  <h3 className="font-semibold text-white text-sm">
                    {f.title}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {f.desc}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <Card className="order-1 lg:order-2 border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl w-full">
          <CardContent className="p-6 md:p-10 space-y-8">
            <div className="lg:hidden flex items-center gap-3 mb-2">
              <div className="h-9 w-9 rounded-full bg-gradient-accent flex items-center justify-center">
                <DatabaseZap className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-gradient">PgGuardian</p>
                <p className="text-[11px] text-muted-foreground">v1.0.0</p>
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-3xl font-bold text-white">Panele Giriş</h2>
              <p className="text-muted-foreground">
                Korumalı rotalara erişmek için lütfen giriş yapın.
              </p>
            </div>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmitLogin)}
                className="space-y-6"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-posta</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="admin@local"
                          autoComplete="email"
                          disabled={form.formState.isSubmitting || isThrottled}
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
                      <FormLabel>Şifre</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showPwd ? "text" : "password"}
                            placeholder="••••••••"
                            autoComplete="current-password"
                            disabled={
                              form.formState.isSubmitting || isThrottled
                            }
                          />
                          <button
                            type="button"
                            onClick={() => setShowPwd((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {showPwd ? (
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

                <div className="flex items-center justify-between">
                  <FormField
                    control={form.control}
                    name="remember"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={
                              form.formState.isSubmitting || isThrottled
                            }
                          />
                        </FormControl>
                        <Label
                          htmlFor="remember"
                          className="text-sm cursor-pointer font-normal"
                        >
                          Beni hatırla
                        </Label>
                      </FormItem>
                    )}
                  />
                </div>

                {isThrottled && (
                  <div className="text-sm text-amber-500 font-medium">
                    Giriş 5 saniye boyunca geçici olarak kilitlendi.{" "}
                    {throttleRemaining}sn kaldı.
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-14 text-base"
                  disabled={
                    form.formState.isSubmitting || isThrottled
                  }
                >
                  {form.formState.isSubmitting
                    ? "Giriş yapılıyor..."
                    : "Giriş Yap"}
                  <ArrowRight className="h-5 w-5 ml-1" />
                </Button>

                <div className="text-center text-xs text-muted-foreground space-y-1">
                  <div>
                    <Link
                      href="/dashboard"
                      className="text-gradient hover:underline"
                    >
                      Geliştirici moduna geç (dev API token)
                    </Link>
                  </div>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={changeDialogOpen}
        onOpenChange={(o) => {
          if (!changeForm.formState.isSubmitting) {
            setChangeDialogOpen(o);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zorunlu Şifre Değiştirme</DialogTitle>
            <DialogDescription>
              Hesabınızın güvenliği için şifrenizi değiştirmeniz gerekiyor.
            </DialogDescription>
          </DialogHeader>
          <Form {...changeForm}>
            <form
              onSubmit={changeForm.handleSubmit(onSubmitChangePassword)}
              className="space-y-4"
            >
              <FormField
                control={changeForm.control}
                name="current_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mevcut Şifre</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder="••••••••"
                        disabled={changeForm.formState.isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={changeForm.control}
                name="new_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Yeni Şifre</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showNewPwd ? "text" : "password"}
                          placeholder="••••••••"
                          disabled={changeForm.formState.isSubmitting}
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPwd((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                        >
                          {showNewPwd ? (
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
              <FormField
                control={changeForm.control}
                name="confirm_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Yeni Şifre (Tekrar)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type={showNewPwd ? "text" : "password"}
                        placeholder="••••••••"
                        disabled={changeForm.formState.isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={changeForm.formState.isSubmitting}
                >
                  {changeForm.formState.isSubmitting
                    ? "Değiştiriliyor..."
                    : "Şifreyi Değiştir"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
