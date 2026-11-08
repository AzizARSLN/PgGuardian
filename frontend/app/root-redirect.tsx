"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-side replacement for the server `redirect("/dashboard")` used by the
 * root page. Static exports (desktop build) cannot perform a server redirect,
 * so the landing shell hands off to the dashboard once it hydrates.
 */
export default function RootRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
