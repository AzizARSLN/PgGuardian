"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UIPrefsState {
  pollInterval: number;
  autoRefresh: boolean;
  /** Desktop sidebar collapsed into an icon-only rail. */
  sidebarCollapsed: boolean;
  setPollInterval: (interval: number) => void;
  setAutoRefresh: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  toggleSidebarCollapsed: () => void;
  reset: () => void;
}

const DEFAULTS = {
  pollInterval: 10000,
  autoRefresh: true,
  sidebarCollapsed: false,
};

export const useUIPrefsStore = create<UIPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setPollInterval: (interval: number) => {
        set({ pollInterval: Math.max(1000, interval) });
      },

      setAutoRefresh: (value: boolean) => {
        set({ autoRefresh: value });
      },

      setSidebarCollapsed: (value: boolean) => {
        set({ sidebarCollapsed: value });
      },

      toggleSidebarCollapsed: () => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
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
        autoRefresh: state.autoRefresh,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);

export default useUIPrefsStore;
