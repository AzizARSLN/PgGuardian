"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useUIStore } from "@/store/use-ui-store";
import { useAuthStore } from "@/store/useAuthStore";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/connections", label: "Connections", icon: DatabaseZap },
  { href: "/diagnostics", label: "Diagnostics", icon: Activity },
  { href: "/sql-editor", label: "SQL Editor", icon: TerminalSquare },
  { href: "/query-management", label: "Query Management", icon: ListFilter },
  { href: "/schema-browser", label: "Schema Browser", icon: Table2 },
  { href: "/roles", label: "Roles", icon: ShieldCheck },
  { href: "/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/config", label: "Config", icon: Settings2 },
  { href: "/replication", label: "Replication", icon: GitBranch },
  { href: "/backups", label: "Backups", icon: DatabaseBackup },
  { href: "/snapshots", label: "Snapshots", icon: Camera },
  { href: "/report", label: "Report", icon: FileBarChart2 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push("/login");
    onNavigate?.();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="mb-8 px-3">
        <Link href="/dashboard" className="flex items-center gap-3" onClick={onNavigate}>
          <div className="h-12 w-12 rounded-full bg-gradient-accent flex items-center justify-center shadow-lg">
            <DatabaseZap className="h-6 w-6 text-white" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-xl font-bold text-gradient">PgGuardian</span>
            <span className="text-xs text-muted-foreground">PostgreSQL Panel</span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 flex flex-col gap-1.5 overflow-y-auto pr-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-3 rounded-full px-4 py-3 text-sm font-medium transition-all",
                isActive
                  ? "bg-gradient-to-r from-indigo-500/20 to-emerald-500/20 text-white border border-white/10 shadow-inner"
                  : "text-muted-foreground hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 shrink-0 transition-colors",
                  isActive
                    ? "text-gradient"
                    : "text-muted-foreground group-hover:text-white"
                )}
                style={
                  isActive
                    ? {
                        stroke: "url(#sideGradient)",
                      }
                    : undefined
                }
              />
              <svg width="0" height="0" className="absolute">
                <defs>
                  <linearGradient id="sideGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="truncate">{item.label}</span>
              {isActive && (
                <span className="ml-auto h-2.5 w-2.5 rounded-full bg-gradient-accent" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-white/10 space-y-2">
        <button
          onClick={handleLogout}
          className="w-full group flex items-center gap-3 rounded-full px-4 py-3 text-sm font-medium transition-all text-muted-foreground hover:bg-white/10 hover:text-destructive"
        >
          <LogOut className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-destructive" />
          <span className="truncate">Logout</span>
        </button>
        <div className="px-3 py-3 rounded-full bg-white/5 backdrop-blur-sm border border-white/5">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground truncate">v1.0.0</p>
              <p className="text-xs text-emerald-400 truncate flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                API: 127.0.0.1:8000
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SidebarNav() {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const { sidebarOpen, setSidebarOpen } = useUIStore();

  if (isDesktop) {
    return (
      <aside className="w-64 shrink-0 min-h-screen sticky top-0 left-0 h-screen border-r border-white/10 bg-white/5 backdrop-blur-md p-6 flex flex-col gap-2 overflow-hidden">
        <SidebarContent />
      </aside>
    );
  }

  return (
    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SheetContent
        side="left"
        className="w-[85%] max-w-[85%] border-r border-white/10 bg-sidebar p-6"
      >
        <SheetHeader className="mb-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
        </SheetHeader>
        <SidebarContent onNavigate={() => setSidebarOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
