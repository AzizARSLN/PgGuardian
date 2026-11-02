"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Database,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Star,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useT } from "@/lib/i18n";
import { endpoints, type Profile } from "@/lib/api/types";
import { qk } from "@/lib/api/queryKeys";
import { useUIStore } from "@/store/use-ui-store";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

export default function Header() {
  const t = useT();
  const { setTheme, resolvedTheme } = useTheme();
  const { setSidebarOpen } = useUIStore();
  const { user, logout, isAuthenticated } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const selectedProfileName = useProfileStore((s) => s.selectedProfileName);
  const setSelectedProfileName = useProfileStore((s) => s.setSelectedProfileName);

  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: qk.profiles.all(),
    queryFn: () => endpoints.listProfiles(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: isAuthenticated,
  });

  // The profile gate owns the first choice. Here we only drop a stored name
  // that no longer exists, which sends the user back to the gate.
  useEffect(() => {
    if (!profiles) return;
    if (selectedProfileName && !profiles.some((p) => p.name === selectedProfileName)) {
      setSelectedProfileName(null);
    }
  }, [profiles, selectedProfileName, setSelectedProfileName]);

  const selectedProfile: Profile | undefined = profiles?.find(
    (p) => p.name === selectedProfileName
  );

  const handleSelectProfile = (name: string) => {
    if (name === selectedProfileName) return;
    setSelectedProfileName(name);
    // Drop the previous server's rows right away: acting on stale data from
    // another database is how the wrong backend gets terminated.
    queryClient.resetQueries({
      predicate: (q) => q.queryKey[0] !== "profiles",
    });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    router.push("/login");
  };

  const section = pathname?.split("/")[1] ?? "";
  const sectionKey = section.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

  return (
    <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b border-border bg-background/95 px-3 md:px-5">
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="rounded-md p-1.5 transition-colors hover:bg-muted lg:hidden"
        aria-label={t("nav.menu")}
      >
        <Menu className="h-4 w-4" />
      </button>

      <p className="truncate text-sm font-semibold">{t(`nav.items.${sectionKey}`)}</p>

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={profilesLoading && !selectedProfile}
            className="max-w-[260px] gap-1.5 font-mono"
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                selectedProfile ? "bg-success" : "bg-muted-foreground"
              }`}
              aria-hidden
            />
            <span className="truncate">
              {selectedProfile ? (
                <>
                  {selectedProfile.name}
                  <span className="hidden text-muted-foreground md:inline">
                    {" "}
                    · {selectedProfile.database}
                  </span>
                </>
              ) : profilesLoading ? (
                t("header.loadingProfiles")
              ) : (
                t("header.noProfile")
              )}
            </span>
            <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 max-w-[90vw]">
          <DropdownMenuLabel className="flex items-center justify-between py-1.5 text-xs">
            <span>{t("header.connectionProfile")}</span>
            <Link
              href="/connections"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-info transition hover:bg-muted"
            >
              <Plus className="h-3 w-3" /> {t("header.manage")}
            </Link>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {!profiles || profiles.length === 0 ? (
            <div className="px-3 py-5 text-center">
              <p className="mb-3 text-xs text-muted-foreground">{t("header.emptyProfiles")}</p>
              <Button asChild size="sm" className="w-full">
                <Link href="/connections">
                  <Plus /> {t("header.createFirstProfile")}
                </Link>
              </Button>
            </div>
          ) : (
            profiles.map((p) => {
              const isActive = p.name === selectedProfileName;
              return (
                <DropdownMenuItem
                  key={p.name}
                  onSelect={() => handleSelectProfile(p.name)}
                  className={`flex items-start gap-2 ${isActive ? "bg-accent" : ""}`}
                >
                  <Database
                    className={`mt-0.5 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold">{p.name}</span>
                      {p.is_default && (
                        <Star className="h-3 w-3 shrink-0 fill-warning text-warning" />
                      )}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {p.username}@{p.host}:{p.port}/{p.database}
                    </p>
                  </div>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <LanguageSwitcher className="hidden sm:inline-flex" />

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={handleRefresh}
        disabled={refreshing}
        title={t("common.refresh")}
        aria-label={t("common.refresh")}
      >
        <RefreshCw className={refreshing ? "animate-spin" : ""} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        title={t("header.toggleTheme")}
        aria-label={t("header.toggleTheme")}
      >
        <Sun className="dark:hidden" />
        <Moon className="hidden dark:block" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("header.account")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold uppercase text-primary-foreground"
          >
            {user?.email?.slice(0, 2) ?? "··"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {user && (
            <>
              <div className="px-2 py-1.5">
                <p className="truncate text-[13px] font-medium">{user.email}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Shield className="h-3 w-3" />
                  {user.role}
                </p>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings /> {t("nav.items.settings")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleLogout}
            className="text-destructive focus:text-destructive"
          >
            <LogOut /> {t("common.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
