"use client";

import { usePathname } from "next/navigation";
import Header from "@/components/header";
import ProfileGate from "@/components/profile-gate";
import SidebarNav from "@/components/sidebar-nav";
import TabBar from "@/components/tab-bar";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";

export const PUBLIC_PATHS = ["/login"];

// Profile management stays reachable without a chosen database: it is where the
// first profile gets created when the list is still empty.
const PROFILE_GATE_BYPASS = ["/connections"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const selectedProfileName = useProfileStore((s) => s.selectedProfileName);

  if (PUBLIC_PATHS.includes(pathname)) {
    return <main className="min-h-screen">{children}</main>;
  }

  const bypassesGate = PROFILE_GATE_BYPASS.some((path) => pathname?.startsWith(path));

  // Nothing runs before a connection profile exists: no queries, no pages.
  if (isAuthenticated && !selectedProfileName && !bypassesGate) {
    return <ProfileGate />;
  }

  return (
    <div className="flex min-h-screen w-full">
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <TabBar />
        <main className="flex-1 overflow-x-hidden px-3 py-4 md:px-5">{children}</main>
      </div>
    </div>
  );
}
