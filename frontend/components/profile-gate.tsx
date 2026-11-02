"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronRight,
  Database,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { endpoints, type Profile } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useRole } from "@/lib/hooks/use-role";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

const SEARCH_THRESHOLD = 6;

function connectionLabel(profile: Profile): string {
  return `${profile.username}@${profile.host}:${profile.port}/${profile.database}`;
}

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
  const { isDBA } = useRole();
  const [pending, setPending] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: profiles, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: qk.profiles.all(),
    queryFn: () => endpoints.listProfiles(),
    retry: 1,
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return profiles ?? [];
    return (profiles ?? []).filter((profile) =>
      `${profile.name} ${connectionLabel(profile)}`.toLowerCase().includes(term)
    );
  }, [profiles, search]);

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
    <div className="dark pgg-stage flex min-h-screen flex-col text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-6">
        <BrandMark />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          {user && (
            <span className="hidden max-w-[200px] truncate text-xs text-muted-foreground md:inline">
              {user.email}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            aria-label={t("profileGate.logout")}
            className="text-muted-foreground"
          >
            <LogOut />
            <span className="hidden sm:inline">{t("profileGate.logout")}</span>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 pb-10 pt-[12vh]">
        <div className="pgg-rise w-full max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">{t("profileGate.title")}</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {t("profileGate.subtitle")}
          </p>

          <div className="mt-6">
            {isLoading ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-5 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("profileGate.loading")}
              </div>
            ) : isError ? (
              <div className="rounded-lg border border-destructive/40 bg-card p-4">
                <p className="flex items-center gap-2 text-[13px] font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  {t("profileGate.error")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {t("profileGate.retry")}
                </Button>
              </div>
            ) : !profiles || profiles.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-10 text-center">
                <Database className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-semibold">{t("profileGate.empty")}</p>
                <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                  {t(isDBA ? "profileGate.emptyHint" : "profileGate.emptyViewerHint")}
                </p>
                {isDBA && (
                  <Button asChild className="mt-5">
                    <Link href="/connections">
                      <Plus /> {t("profileGate.createProfile")}
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <>
                {profiles.length >= SEARCH_THRESHOLD && (
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("profileGate.searchPlaceholder")}
                      aria-label={t("profileGate.searchPlaceholder")}
                      autoFocus
                      className="pl-8"
                    />
                  </div>
                )}

                {visible.length === 0 ? (
                  <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
                    {t("profileGate.noMatch")}
                  </p>
                ) : (
                  <ul className="max-h-[52vh] divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card">
                    {visible.map((profile) => (
                      <li key={profile.name}>
                        <button
                          type="button"
                          onClick={() => handleSelect(profile)}
                          disabled={pending !== null}
                          className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                            <Database className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold">{profile.name}</span>
                              {profile.is_default && (
                                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  {t("profileGate.default")}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                              {connectionLabel(profile)}
                            </span>
                          </span>
                          {pending === profile.name ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {isDBA && (
                  <Link
                    href="/connections"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    {t("profileGate.manageProfiles")}
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
