"use client";

import * as React from "react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Settings,
  Shield,
  Palette,
  RefreshCw,
  KeyRound,
  Eye,
  EyeOff,
  Save,
  Loader2,
  Sun,
  Moon,
  Monitor,
  SaveAll,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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

import { useUIPrefsStore } from "@/store/useUIPrefsStore";
import { useAuthStore } from "@/store/useAuthStore";

const POLL_OPTIONS: { value: number; label: string }[] = [
  { value: 3_000, label: "3 saniye" },
  { value: 10_000, label: "10 saniye (varsayılan)" },
  { value: 30_000, label: "30 saniye" },
  { value: 60_000, label: "1 dakika" },
  { value: 300_000, label: "5 dakika" },
];

export default function SettingsPage() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const pollInterval = useUIPrefsStore((s) => s.pollInterval);
  const setPollInterval = useUIPrefsStore((s) => s.setPollInterval);
  const autoRefresh = useUIPrefsStore((s) => s.autoRefresh);
  const setAutoRefresh = useUIPrefsStore((s) => s.setAutoRefresh);

  const apiToken = useAuthStore((s) => s.apiToken);
  const setApiToken = useAuthStore((s) => s.setApiToken);
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);

  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const [newApiToken, setNewApiToken] = useState("");
  const [tokenSubmitting, setTokenSubmitting] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const displayToken = React.useMemo(() => {
    if (!apiToken) return "";
    const first4 = apiToken.slice(0, 4);
    const last4 = apiToken.slice(-4);
    return showToken ? apiToken : `${first4}${"*".repeat(Math.max(4, apiToken.length - 8))}${last4}`;
  }, [apiToken, showToken]);

  const handleSubmitToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newApiToken.trim()) {
      toast.error("API token boş olamaz");
      return;
    }
    setTokenSubmitting(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_token: newApiToken.trim() }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: "Geçersiz yanıt" }));
        throw new Error(data?.detail || "Token doğrulaması başarısız");
      }
      setApiToken(newApiToken.trim());
      setAuthenticated(true);
      toast.success("API token güncellendi");
      setTokenDialogOpen(false);
      setNewApiToken("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Hata";
      toast.error("Token ayarlanamadı", { description: msg });
    } finally {
      setTokenSubmitting(false);
    }
  };

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPw.trim() || !newPw2.trim()) {
      toast.error("Yeni şifre ve tekrarı zorunlu");
      return;
    }
    if (newPw !== newPw2) {
      toast.error("Yeni şifre ve tekrarı eşleşmiyor");
      return;
    }
    if (newPw.length < 6) {
      toast.error("Yeni şifre en az 6 karakter olmalı");
      return;
    }
    setPwSubmitting(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_token: newPw.trim(), old_api_token: currentPw.trim() }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: "Geçersiz yanıt" }));
        throw new Error(data?.detail || "Master parola doğrulaması başarısız");
      }
      setApiToken(newPw.trim());
      setAuthenticated(true);
      toast.success("Master parola başarıyla değiştirildi");
      setPasswordDialogOpen(false);
      setCurrentPw("");
      setNewPw("");
      setNewPw2("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Hata";
      toast.error("Parola değiştirilemedi", { description: msg });
    } finally {
      setPwSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Settings className="h-8 w-8 text-violet-400" />
            Ayarlar
          </h1>
          <p className="text-muted-foreground mt-1">
            Güvenlik · tema · canlı yenileme · API token
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          Ayarlar otomatik olarak kaydedilir
        </div>
      </div>

      {/* (a) Güvenlik: Master Password Değiştir */}
      <Card className="relative overflow-hidden border-red-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-violet-500/5 pointer-events-none" />
        <CardHeader className="pb-5 relative">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-lg">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-xl flex items-center gap-2 flex-wrap">
                Güvenlik
                <Badge variant="outline" className="text-[10px] font-mono bg-red-500/10 text-red-400 border-red-500/30">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  DÜZENLE: DANGEROUS
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Master parola ve API token yönetimi. Tüm değişiklikler POST /api/auth ile doğrulanır.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 relative space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="font-semibold flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-violet-400" />
                Master Parolayı Değiştir
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Mevcut master parolanızla birlikte yeni parolayı 2 kez girin.
              </div>
            </div>
            <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="h-12 bg-red-500 hover:bg-red-600 text-white"
                >
                  <SaveAll className="h-4 w-4 mr-2" />
                  Parolayı Değiştir
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-red-400">
                    <Shield className="h-6 w-6" />
                    Master Parolayı Değiştir — DANGEROUS
                  </DialogTitle>
                  <DialogDescription>
                    Eski parolanız ve yeni parolanız (2 kez) ile işlem doğrulanacaktır.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmitPassword} className="space-y-5 py-4">
                  <div className="space-y-2">
                    <Label>Mevcut Master Parola</Label>
                    <Input
                      type="password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Yeni Master Parola</Label>
                    <Input
                      type="password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      placeholder="en az 6 karakter"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Yeni Master Parola (Tekrar)</Label>
                    <Input
                      type="password"
                      value={newPw2}
                      onChange={(e) => setNewPw2(e.target.value)}
                      placeholder="aynı yeni parola"
                    />
                  </div>
                  {newPw && newPw2 && newPw !== newPw2 && (
                    <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-4">
                      <p className="text-xs text-red-400 flex items-center gap-1.5">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        Yeni parola ve tekrarı eşleşmiyor.
                      </p>
                    </div>
                  )}
                  <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                      İptal
                    </Button>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={pwSubmitting || !newPw || !newPw2 || newPw !== newPw2}
                      className="bg-red-500 hover:bg-red-600 text-white"
                    >
                      {pwSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      <Save className="h-4 w-4 mr-2" />
                      Kaydet
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* (b) Tema */}
      <Card className="relative overflow-hidden border-violet-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-indigo-500/5 pointer-events-none" />
        <CardHeader className="pb-5 relative">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-lg">
              <Palette className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-xl">Tema</CardTitle>
              <CardDescription className="mt-1">
                Arayüz renk temasını seçin. Tercihiniz tarayıcınızda saklanır.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 relative">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([
              { val: "light", label: "Açık", icon: Sun, color: "from-amber-400 to-orange-500" },
              { val: "dark", label: "Koyu (Glass)", icon: Moon, color: "from-indigo-500 to-violet-500" },
              { val: "system", label: "Sistem", icon: Monitor, color: "from-slate-400 to-slate-600" },
            ] as const).map((t) => {
              const active = theme === t.val;
              return (
                <button
                  type="button"
                  key={t.val}
                  onClick={() => setTheme(t.val)}
                  className={`group relative rounded-3xl border p-6 text-left transition-all ${
                    active
                      ? "border-white/40 bg-white/10 shadow-xl shadow-indigo-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-10 w-10 rounded-xl bg-gradient-to-br ${t.color} flex items-center justify-center shadow-md`}
                    >
                      <t.icon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <div className="font-semibold">{t.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {t.val === "system"
                          ? "OS tercihini izler"
                          : t.val === "dark"
                          ? "Glass/mor efekt aktif"
                          : "Açık arka plan"}
                      </div>
                    </div>
                  </div>
                  {active && (
                    <Badge variant="default" className="absolute top-4 right-4 text-[10px]">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Aktif
                    </Badge>
                  )}
                  <div className="mt-4 rounded-2xl h-20 bg-gradient-to-br from-white/5 to-white/10 border border-white/5 flex items-center justify-center">
                    {t.val === "light" ? (
                      <div className="w-12 h-12 rounded-xl bg-white shadow-lg shadow-black/10" />
                    ) : t.val === "dark" ? (
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/30 to-emerald-500/30 backdrop-blur-md border border-white/10 shadow-lg" />
                    ) : (
                      <div className="flex gap-2">
                        <div className="w-8 h-12 rounded-lg bg-white shadow-md" />
                        <div className="w-8 h-12 rounded-lg bg-gradient-to-br from-indigo-500/30 to-emerald-500/30 backdrop-blur-md border border-white/10" />
                      </div>
                    )}
                  </div>
                  <div className="mt-3 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                    {resolvedTheme === t.val && active ? `Uygulanan: ${t.label}` : `Seç: ${t.label}`}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* (c) Canlı Yenileme */}
      <Card className="relative overflow-hidden border-emerald-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-sky-500/5 pointer-events-none" />
        <CardHeader className="pb-5 relative">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg">
              <RefreshCw className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-xl">Canlı Yenileme</CardTitle>
              <CardDescription className="mt-1">
                Veri yenileme sıklığı ve otomatik yenileme anahtarı. Ayarlar useUIPrefsStore (Zustand) üzerinden kalıcıdır.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 relative space-y-6">
          <div className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 p-6 flex-wrap gap-4">
            <div>
              <div className="font-semibold flex items-center gap-2">
                Otomatik Yenileme
                <RiskBadge riskLevel={autoRefresh ? "OK" : "WARNING"} size="sm" className="ml-2">
                  {autoRefresh ? "AÇIK" : "KAPALI"}
                </RiskBadge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Kapalıysa, her sayfa için &quot;Yenile&quot; butonu ile manuel güncelleme gerekir.
              </div>
            </div>
            <Switch checked={autoRefresh} onCheckedChange={(v) => setAutoRefresh(Boolean(v))} />
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
              <div>
                <Label className="text-base font-semibold">Poll Sıklığı</Label>
                <div className="text-xs text-muted-foreground mt-1">
                  Mevcut: <span className="font-mono text-emerald-300">{pollInterval / 1000} sn</span>
                  {!autoRefresh && <span className="ml-2 text-amber-300">(otomatik yenileme kapalı)</span>}
                </div>
              </div>
            </div>
            <Select
              value={String(pollInterval)}
              onValueChange={(v) => setPollInterval(Number(v))}
              disabled={!autoRefresh}
            >
              <SelectTrigger className="h-14 rounded-2xl">
                <SelectValue placeholder="Poll aralığı seçin" />
              </SelectTrigger>
              <SelectContent>
                {POLL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* (d) API Token */}
      <Card className="relative overflow-hidden border-sky-500/20">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 via-transparent to-indigo-500/5 pointer-events-none" />
        <CardHeader className="pb-5 relative">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-500 flex items-center justify-center shadow-lg">
              <KeyRound className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-xl flex items-center gap-2 flex-wrap">
                API Token
                <Badge variant="outline" className="text-[10px] font-mono bg-sky-500/10 text-sky-400 border-sky-500/30">
                  Bearer auth
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Backend /api/v1/** istekleri için kullanılan Bearer token. Token Zustand useAuthStore ve sessionStorage&apos;da saklanır.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 relative space-y-4">
          {apiToken ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <Label className="text-base font-semibold">Mevcut API Token</Label>
                  <div className="text-xs text-muted-foreground mt-1">
                    Güvenlik nedeniyle maskelenmiştir, tam görüntülemek için göz simgesine tıklayın.
                  </div>
                </div>
                <RiskBadge riskLevel="OK" size="sm">
                  DOĞRULANDI
                </RiskBadge>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <Input
                    type="text"
                    value={displayToken}
                    readOnly
                    disabled
                    className="h-14 font-mono pr-14"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-muted-foreground hover:text-white transition-colors"
                    title={showToken ? "Gizle" : "Göster"}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="h-14">
                      <KeyRound className="h-4 w-4 mr-2" />
                      Tokeni Değiştir
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <KeyRound className="h-6 w-6 text-sky-400" />
                        API Token Ayarla
                      </DialogTitle>
                      <DialogDescription>
                        Yeni token /api/auth POST ile doğrulanacak ve başarılı ise saklanacaktır.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmitToken} className="space-y-5 py-4">
                      <div className="space-y-2">
                        <Label>Yeni API Token</Label>
                        <Input
                          type="text"
                          value={newApiToken}
                          onChange={(e) => setNewApiToken(e.target.value)}
                          placeholder="pg_xxx veya jwt token"
                          className="h-14 font-mono"
                          autoFocus
                        />
                      </div>
                      <DialogFooter className="gap-2">
                        <Button type="button" variant="outline" onClick={() => setTokenDialogOpen(false)}>
                          İptal
                        </Button>
                        <Button
                          type="submit"
                          disabled={tokenSubmitting || !newApiToken.trim()}
                          className="bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600"
                        >
                          {tokenSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          <Save className="h-4 w-4 mr-2" />
                          Kaydet
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-amber-500/30 bg-amber-500/5 p-6 space-y-4">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="h-10 w-10 shrink-0 rounded-xl bg-amber-500/15 flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-amber-300">API Tokeni Ayarla</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Oturum açma veya token doğrulaması yapılmadı. Aşağıdan token ayarlayın.
                  </div>
                </div>
              </div>
              <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    className="h-12 w-full bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600"
                  >
                    <KeyRound className="h-5 w-5 mr-2" />
                    API Tokeni Ayarla
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <KeyRound className="h-6 w-6 text-sky-400" />
                      API Token Ayarla
                    </DialogTitle>
                    <DialogDescription>
                      Token /api/auth POST endpointi ile doğrulanacaktır.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleSubmitToken} className="space-y-5 py-4">
                    <div className="space-y-2">
                      <Label>API Token</Label>
                      <Input
                        type="text"
                        value={newApiToken}
                        onChange={(e) => setNewApiToken(e.target.value)}
                        placeholder="Bearer token veya master parola"
                        className="h-14 font-mono"
                        autoFocus
                      />
                    </div>
                    <DialogFooter className="gap-2">
                      <Button type="button" variant="outline" onClick={() => setTokenDialogOpen(false)}>
                        İptal
                      </Button>
                      <Button
                        type="submit"
                        disabled={tokenSubmitting || !newApiToken.trim()}
                        className="bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600"
                      >
                        {tokenSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        <Save className="h-4 w-4 mr-2" />
                        Ayarla
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
