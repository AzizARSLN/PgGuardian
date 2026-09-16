"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UIPrefsState {
  pollInterval: number;
  theme: "light" | "dark" | "system";
  autoRefresh: boolean;
  setPollInterval: (interval: number) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setAutoRefresh: (value: boolean) => void;
  reset: () => void;
}

const DEFAULTS = {
  pollInterval: 10000,
  theme: "dark" as const,
  autoRefresh: true,
};

export const useUIPrefsStore = create<UIPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setPollInterval: (interval: number) => {
        set({ pollInterval: Math.max(1000, interval) });
      },

      setTheme: (theme: "light" | "dark" | "system") => {
        set({ theme });
        try {
          if (typeof window !== "undefined" && "document" in window) {
            const root = window.document.documentElement;
            if (theme === "system") {
              const isDark = window.matchMedia(
                "(prefers-color-scheme: dark)"
              ).matches;
              root.classList.toggle("dark", isDark);
            } else {
              root.classList.toggle("dark", theme === "dark");
            }
          }
        } catch {
        }
      },

      setAutoRefresh: (value: boolean) => {
        set({ autoRefresh: value });
      },

      reset: () => {
        set(DEFAULTS);
      },
    }),
    {
      name: "pgguardian-ui-prefs",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        pollInterval: state.pollInterval,
        theme: state.theme,
        autoRefresh: state.autoRefresh,
      }),
    }
  )
);

export default useUIPrefsStore;
