"use client";

import { usePathname } from "next/navigation";
import Header from "@/components/header";
import SidebarNav from "@/components/sidebar-nav";

export const PUBLIC_PATHS = ["/login"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (PUBLIC_PATHS.includes(pathname)) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="flex min-h-screen w-full">
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-x-hidden px-3 py-4 md:px-5">{children}</main>
      </div>
    </div>
  );
}
