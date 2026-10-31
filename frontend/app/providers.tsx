"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Loader2 } from "lucide-react";

import { PUBLIC_PATHS } from "@/components/app-shell";
import { useAuthStore } from "@/store/useAuthStore";

const STALE_TIME = 3000;
const GC_TIME = 30000;
const RETRY_COUNT = 1;

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
        gcTime: GC_TIME,
        retry: RETRY_COUNT,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchOnMount: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

function toLogin() {
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = React.useMemo(() => getQueryClient(), []);
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const [restoring, setRestoring] = React.useState(!isPublic && !isAuthenticated);

  React.useEffect(() => {
    window.addEventListener("auth:401", toLogin);
    return () => window.removeEventListener("auth:401", toLogin);
  }, []);

  // The access token lives in memory, so a reload starts without one. The
  // refresh cookie is HttpOnly and invisible here: just ask for a new token
  // before any page query runs.
  React.useEffect(() => {
    if (isPublic || useAuthStore.getState().isAuthenticated) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    useAuthStore
      .getState()
      .refreshAccessToken()
      .then((token) => {
        if (cancelled) return;
        if (token) {
          setRestoring(false);
        } else {
          toLogin();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isPublic]);

  return (
    <QueryClientProvider client={queryClient}>
      {restoring ? (
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        children
      )}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  );
}

export default Providers;
