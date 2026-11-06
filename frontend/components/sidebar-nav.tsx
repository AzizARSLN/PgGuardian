"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { NAV_GROUPS } from "@/lib/navigation";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useRole } from "@/lib/hooks/use-role";
import { useUIStore } from "@/store/use-ui-store";
import { useUIPrefsStore } from "@/store/useUIPrefsStore";
import { useAuthStore } from "@/store/useAuthStore";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface SidebarContentProps {
  onNavigate?: () => void;
  /** Desktop-only: render an icon-only rail instead of the full sidebar. */
  collapsed?: boolean;
  /** Desktop-only: toggles the collapsed rail. Absent on mobile. */
  onToggleCollapse?: () => void;
}

function SidebarContent({ onNavigate, collapsed = false, onToggleCollapse }: SidebarContentProps) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const { isAdmin, isDBA } = useRole();

  const handleLogout = async () => {
    await logout();
    onNavigate?.();
    router.push("/login");
  };

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        title={collapsed ? "PgGuardian" : undefined}
        className={cn(
          "mb-4 flex items-center gap-2.5 px-2",
          collapsed && "justify-center px-0"
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-accent">
          <ShieldCheck className="h-4.5 w-4.5" />
        </span>
        {!collapsed && (
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-bold text-sidebar-foreground">PgGuardian</span>
            <span className="text-[11px] text-sidebar-foreground/60">{t("nav.tagline")}</span>
          </span>
        )}
      </Link>

      <nav className="-mr-1 flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
        {NAV_GROUPS.map((group, groupIndex) => {
          // Roles load after the session refresh; hide nothing until they are known.
          const items = group.items.filter(
            (item) =>
              !user || ((!item.adminOnly || isAdmin) && (!item.writerOnly || isDBA))
          );
          if (items.length === 0) return null;
          return (
            <div key={group.key}>
              {collapsed ? (
                groupIndex > 0 && (
                  <div
                    className="mx-1 mb-2 border-t border-sidebar-border/60"
                    aria-hidden
                  />
                )
              ) : (
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {t(`nav.groups.${group.key}`)}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const label = t(`nav.items.${item.key}`);
                  const isActive =
                    pathname === item.href || pathname?.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? label : undefined}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md border-l-2 px-2 py-1.5 text-[13px] font-medium transition-colors",
                        collapsed && "justify-center px-0",
                        isActive
                          ? "border-guardian-lime bg-sidebar-accent text-sidebar-foreground"
                          : "border-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="mt-3 flex flex-col gap-0.5 border-t border-sidebar-border pt-2">
        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? t("common.logout") : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && t("common.logout")}
        </button>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              collapsed && "justify-center px-0"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0" />
            ) : (
              <PanelLeftClose className="h-4 w-4 shrink-0" />
            )}
            {!collapsed && t("nav.collapse")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function SidebarNav() {
  const t = useT();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const collapsed = useUIPrefsStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUIPrefsStore((s) => s.toggleSidebarCollapsed);

  if (isDesktop) {
    return (
      <aside
        className={cn(
          "sticky left-0 top-0 h-screen shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar p-3 transition-[width] duration-200",
          collapsed ? "w-16" : "w-56"
        )}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={toggleSidebarCollapsed}
        />
      </aside>
    );
  }

  return (
    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SheetContent
        side="left"
        className="w-[85%] max-w-[300px] border-r border-sidebar-border bg-sidebar p-3"
      >
        <SheetHeader className="mb-0">
          <SheetTitle className="sr-only">{t("nav.menu")}</SheetTitle>
        </SheetHeader>
        <SidebarContent onNavigate={() => setSidebarOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
