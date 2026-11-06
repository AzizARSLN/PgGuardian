"use client";

import {
  Activity,
  Camera,
  Database,
  DatabaseBackup,
  DatabaseZap,
  FileBarChart2,
  FileSearch,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Layers,
  ListFilter,
  Puzzle,
  Settings,
  Settings2,
  ShieldCheck,
  Table2,
  TerminalSquare,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  key: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  writerOnly?: boolean;
}

/**
 * The single source of truth for top-level navigation. The sidebar renders it
 * and the tab bar resolves titles/icons from it, so both stay in step.
 */
export const NAV_GROUPS: { key: string; items: NavItem[] }[] = [
  {
    key: "monitor",
    items: [
      { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
      { href: "/statements", key: "statements", icon: Gauge },
      { href: "/pgbadger", key: "pgbadger", icon: FileSearch },
      { href: "/query-management", key: "queryManagement", icon: ListFilter },
      { href: "/diagnostics", key: "diagnostics", icon: Activity },
      { href: "/index-monitor", key: "indexMonitor", icon: Layers },
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

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * Resolve a pathname to its nav entry. Nested routes such as
 * `/sql-editor/…` map to their owner; the longest matching href wins.
 */
export function findNavItem(pathname: string | null | undefined): NavItem | undefined {
  if (!pathname) return undefined;
  return NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  ).sort((a, b) => b.href.length - a.href.length)[0];
}
