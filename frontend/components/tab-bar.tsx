"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { findNavItem, NAV_ITEMS } from "@/lib/navigation";
import { useTabsStore } from "@/store/use-tabs-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Navigation tab strip under the header. Tabs are a registry of visited routes:
 * any navigation — sidebar, header links or programmatic push — opens one, so
 * this component owns no local tab state beyond the mount guard.
 */
export default function TabBar() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();

  const tabs = useTabsStore((s) => s.tabs);
  const activeHref = useTabsStore((s) => s.activeHref);
  const openTab = useTabsStore((s) => s.openTab);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const closeOthers = useTabsStore((s) => s.closeOthers);
  const closeAll = useTabsStore((s) => s.closeAll);

  // Tabs live in localStorage and rehydrate on the client only, so render the
  // strip after mount to keep the server and first client paint identical.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    const item = findNavItem(pathname);
    if (item) openTab({ href: item.href, key: item.key });
  }, [pathname, openTab]);

  const go = React.useCallback(
    (href: string) => {
      setActive(href);
      if (href !== pathname) router.push(href);
    },
    [pathname, router, setActive]
  );

  const handleClose = (href: string) => {
    const wasActive = href === activeHref;
    closeTab(href);
    if (!wasActive) return;
    const next = useTabsStore.getState().activeHref;
    if (next && next !== pathname) router.push(next);
  };

  const handleCloseAll = () => {
    closeAll();
    // Never leave the shell tab-less: fall back to the first entry.
    const home = NAV_ITEMS[0];
    openTab({ href: home.href, key: home.key });
    if (home.href !== pathname) router.push(home.href);
  };

  if (!mounted || tabs.length === 0) return null;

  return (
    <div className="sticky top-12 z-30 flex h-8 items-stretch border-b border-border bg-muted/40">
      <div
        role="tablist"
        aria-label={t("tabs.label")}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
      >
        {tabs.map((tab) => {
          const active = tab.href === activeHref;
          const Icon = findNavItem(tab.href)?.icon;
          return (
            <div
              key={tab.href}
              className={cn(
                "group/tab relative flex shrink-0 items-center border-r border-border",
                active ? "bg-background" : "hover:bg-background/60"
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => go(tab.href)}
                className={cn(
                  "flex h-full items-center gap-1.5 pl-2.5 pr-1 text-xs font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                <span className="max-w-[160px] truncate">{t(`nav.items.${tab.key}`)}</span>
              </button>
              <button
                type="button"
                onClick={() => handleClose(tab.href)}
                aria-label={t("tabs.close")}
                className="mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-colors hover:bg-muted-foreground/20 hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
              {active && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
              )}
            </div>
          );
        })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("tabs.actions")}
            className="flex h-full w-8 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!activeHref}
            onSelect={() => activeHref && closeTab(activeHref)}
          >
            {t("tabs.close")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!activeHref}
            onSelect={() => {
              if (!activeHref) return;
              closeOthers(activeHref);
              if (activeHref !== pathname) router.push(activeHref);
            }}
          >
            {t("tabs.closeOthers")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleCloseAll}>{t("tabs.closeAll")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
