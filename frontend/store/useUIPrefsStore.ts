"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UIPrefsState {
  pollInterval: number;
  autoRefresh: boolean;
  setPollInterval: (interval: number) => void;
  setAutoRefresh: (value: boolean) => void;
  reset: () => void;
}

const DEFAULTS = {
  pollInterval: 10000,
  autoRefresh: true,
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
      }),
    }
  )
);

export default useUIPrefsStore;
