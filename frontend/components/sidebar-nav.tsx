"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  DatabaseZap,
  Activity,
  TerminalSquare,
  ListFilter,
  Table2,
  ShieldCheck,
  Wrench,
  Settings2,
  GitBranch,
  DatabaseBackup,
  Camera,
  FileBarChart2,
  Settings,
  LogOut,
  FileSearch,
  Gauge,
  Database,
  Users,
  Puzzle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useRole } from "@/lib/hooks/use-role";
import { useUIStore } from "@/store/use-ui-store";
import { useAuthStore } from "@/store/useAuthStore";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface NavItem {
  href: string;
  key: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  writerOnly?: boolean;
}

const NAV_GROUPS: { key: string; items: NavItem[] }[] = [
  {
    key: "monitor",
    items: [
      { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
      { href: "/statements", key: "statements", icon: Gauge },
      { href: "/pgbadger", key: "pgbadger", icon: FileSearch },
      { href: "/query-management", key: "queryManagement", icon: ListFilter },
      { href: "/diagnostics", key: "diagnostics", icon: Activity },
      { href: "/replication", key: "replication", icon: GitBranch },
    ],
  },
  {
    key: "explore",
    items: [
      { href: "/sql-editor", key: "sqlEditor", icon: TerminalSquare, writerOnly: true },
      { href: "/schema-browser", key: "schemaBrowser", icon: Table2 },
      { href: "/databases", key: "databases", icon: Database },
    ],
  },
  {
    key: "operate",
    items: [
      { href: "/maintenance", key: "maintenance", icon: Wrench, writerOnly: true },
      { href: "/toolkit", key: "dbaToolkit", icon: Puzzle, writerOnly: true },
      { href: "/backups", key: "backups", icon: DatabaseBackup, writerOnly: true },
      { href: "/snapshots", key: "snapshots", icon: Camera, writerOnly: true },
      { href: "/config", key: "config", icon: Settings2, writerOnly: true },
    ],
  },
  {
    key: "access",
    items: [
      { href: "/connections", key: "connections", icon: DatabaseZap, writerOnly: true },
      { href: "/roles", key: "roles", icon: ShieldCheck, writerOnly: true },
      { href: "/users", key: "users", icon: Users, adminOnly: true },
    ],
  },
  {
    key: "system",
    items: [
      { href: "/report", key: "report", icon: FileBarChart2 },
      { href: "/settings", key: "settings", icon: Settings },
    ],
  },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
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
        className="mb-4 flex items-center gap-2.5 px-2"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-accent">
          <ShieldCheck className="h-4.5 w-4.5" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-bold text-sidebar-foreground">PgGuardian</span>
          <span className="text-[11px] text-sidebar-foreground/60">{t("nav.tagline")}</span>
        </span>
      </Link>

      <nav className="-mr-1 flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
        {NAV_GROUPS.map((group) => {
          // Roles load after the session refresh; hide nothing until they are known.
          const items = group.items.filter(
            (item) =>
              !user || ((!item.adminOnly || isAdmin) && (!item.writerOnly || isDBA))
          );
          if (items.length === 0) return null;
          return (
            <div key={group.key}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                {t(`nav.groups.${group.key}`)}
              </p>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    pathname === item.href || pathname?.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md border-l-2 px-2 py-1.5 text-[13px] font-medium transition-colors",
                        isActive
                          ? "border-guardian-lime bg-sidebar-accent text-sidebar-foreground"
                          : "border-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t(`nav.items.${item.key}`)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="mt-3 border-t border-sidebar-border pt-2">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {t("common.logout")}
        </button>
      </div>
    </div>
  );
}

export default function SidebarNav() {
  const t = useT();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const { sidebarOpen, setSidebarOpen } = useUIStore();

  if (isDesktop) {
    return (
      <aside className="sticky left-0 top-0 h-screen w-56 shrink-0 overflow-hidden border-r border-sidebar-border bg-sidebar p-3">
        <SidebarContent />
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
