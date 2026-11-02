"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Database,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import PggBackdrop from "@/components/pgg-backdrop";
import { useT } from "@/lib/i18n";
import { endpoints, type Profile } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

/**
 * Blocks the whole application until a connection profile is chosen. Without a
 * profile the API has no server to talk to, so nothing else may run first.
 */
export default function ProfileGate() {
  const t = useT();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setSelectedProfileName = useProfileStore((s) => s.setSelectedProfileName);
  const [pending, setPending] = useState<string | null>(null);

  const { data: profiles, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: qk.profiles.all(),
    queryFn: () => endpoints.listProfiles(),
    retry: 1,
  });

  const handleSelect = (profile: Profile) => {
    if (pending) return;
    setPending(profile.name);
    // Rows loaded from the previous server must not survive the switch.
    queryClient.resetQueries({ predicate: (q) => q.queryKey[0] !== "profiles" });
    setSelectedProfileName(profile.name);
  };

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    window.location.assign("/login");
  };

  return (
    <div className="pgg-stage flex min-h-screen flex-col overflow-hidden">
      <PggBackdrop />

      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="dark flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-accent">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="text-sm font-bold text-guardian-white">PgGuardian</span>
        </div>
        <div className="dark flex items-center gap-2">
          <LanguageSwitcher className="hidden sm:inline-flex" />
          {user && (
            <span className="hidden max-w-[180px] truncate text-xs text-guardian-lavender-soft/70 md:inline">
              {user.email}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="border-white/15 bg-white/5 text-guardian-white hover:bg-white/10 hover:text-guardian-white"
          >
            <LogOut /> {t("profileGate.logout")}
          </Button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        <div className="dark w-full max-w-3xl">
          <div className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-guardian-white">
              {t("profileGate.title")}
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-guardian-lavender-soft/70">
              {t("profileGate.subtitle")}
            </p>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <Loader2 className="h-6 w-6 animate-spin text-guardian-lime" />
              <p className="text-[13px] text-guardian-lavender-soft/60">
                {t("profileGate.loading")}
              </p>
            </div>
          ) : isError ? (
            <div className="pgg-card mx-auto max-w-md p-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-warning" />
              <p className="mb-4 text-sm text-muted-foreground">{t("profileGate.error")}</p>
              <Button onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {t("profileGate.retry")}
              </Button>
            </div>
          ) : !profiles || profiles.length === 0 ? (
            <div className="pgg-card mx-auto max-w-md p-8 text-center">
              <Database className="mx-auto mb-3 h-7 w-7 text-guardian-lavender" />
              <p className="text-sm font-semibold text-guardian-white">{t("profileGate.empty")}</p>
              <p className="mb-5 mt-1 text-[13px] text-muted-foreground">
                {t("profileGate.emptyHint")}
              </p>
              <Button asChild>
                <Link href="/connections">
                  <Plus /> {t("profileGate.createProfile")}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {profiles.map((profile) => (
                <button
                  key={profile.name}
                  type="button"
                  onClick={() => handleSelect(profile)}
                  disabled={pending !== null}
                  className="pgg-tile group flex flex-col gap-3 rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-left backdrop-blur-md disabled:opacity-60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                      <Database className="h-4 w-4 text-guardian-lime" />
                    </span>
                    {profile.is_default && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                        <Star className="h-3 w-3 fill-warning" />
                        {t("profileGate.default")}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-guardian-white">
                      {profile.name}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-guardian-lavender-soft/60">
                      {profile.username}@{profile.host}:{profile.port}/{profile.database}
                    </p>
                  </div>

                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-guardian-lime opacity-0 transition-opacity group-hover:opacity-100">
                    {pending === profile.name ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ArrowRight className="h-3 w-3" />
                    )}
                    {t("profileGate.connect")}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-7 text-center">
            <Link
              href="/connections"
              className="text-xs font-medium text-guardian-lavender-soft/60 underline-offset-4 transition hover:text-guardian-lime hover:underline"
            >
              {t("profileGate.manageProfiles")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
