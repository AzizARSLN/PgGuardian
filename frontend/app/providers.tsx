"use client";

import * as React from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import MasterPasswordModal from "@/components/auth/MasterPasswordModal";
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

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = React.useMemo(() => getQueryClient(), []);
  const [modalOpen, setModalOpen] = React.useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  React.useEffect(() => {
    function handleAuth401() {
      clearAuth();
      setModalOpen(true);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("auth:401", handleAuth401);
      return () => {
        window.removeEventListener("auth:401", handleAuth401);
      };
    }
  }, [clearAuth]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const cookieExists =
        document.cookie
          .split(";")
          .some((c) => c.trim().startsWith("auth=")) || false;
      const hasAuth =
        cookieExists ||
        Boolean(window.sessionStorage.getItem("pgguardian_api_token"));
      if (hasAuth && !isAuthenticated) {
        useAuthStore.getState().setAuthenticated(true);
      }
    } catch {
    }
  }, [isAuthenticated]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <MasterPasswordModal
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
      <ReactQueryDevtools
        initialIsOpen={false}
        buttonPosition="bottom-right"
      />
    </QueryClientProvider>
  );
}

export default Providers;
