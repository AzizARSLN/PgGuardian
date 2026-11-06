"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface TabItem {
  href: string;
  /** i18n key under `nav.items.*`, used for the tab title and icon lookup. */
  key: string;
}

interface TabsState {
  tabs: TabItem[];
  activeHref: string | null;
  /** Open a tab, or focus it when the same route is already open. */
  openTab: (tab: TabItem) => void;
  setActive: (href: string) => void;
  /** Close one tab; the active neighbour becomes the new focus. */
  closeTab: (href: string) => void;
  closeOthers: (href: string) => void;
  closeAll: () => void;
  reset: () => void;
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeHref: null,

      openTab: (tab) => {
        const { tabs } = get();
        const exists = tabs.some((item) => item.href === tab.href);
        set({
          tabs: exists ? tabs : [...tabs, tab],
          activeHref: tab.href,
        });
      },

      setActive: (href) => set({ activeHref: href }),

      closeTab: (href) => {
        const { tabs, activeHref } = get();
        const index = tabs.findIndex((item) => item.href === href);
        if (index === -1) return;
        const next = tabs.filter((item) => item.href !== href);
        let nextActive = activeHref;
        if (activeHref === href) {
          // Prefer the tab that slid into this slot, else the one on the left.
          const neighbour = next[index] ?? next[index - 1] ?? null;
          nextActive = neighbour ? neighbour.href : null;
        }
        set({ tabs: next, activeHref: nextActive });
      },

      closeOthers: (href) => {
        const { tabs } = get();
        if (!tabs.some((item) => item.href === href)) return;
        set({ tabs: tabs.filter((item) => item.href === href), activeHref: href });
      },

      closeAll: () => set({ tabs: [], activeHref: null }),

      reset: () => set({ tabs: [], activeHref: null }),
    }),
    {
      name: "pgguardian-tabs",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tabs: state.tabs, activeHref: state.activeHref }),
    }
  )
);

export default useTabsStore;
