"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ProfileState {
  selectedProfileName: string | null;
  setSelectedProfileName: (name: string | null) => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      selectedProfileName: null,
      setSelectedProfileName: (name) => set({ selectedProfileName: name }),
    }),
    {
      name: "pgguardian-selected-profile",
      partialize: (state) => ({
        selectedProfileName: state.selectedProfileName,
      }),
    }
  )
);

export function getSelectedProfileFromStore(): string | null {
  try {
    return useProfileStore.getState().selectedProfileName;
  } catch {
    return null;
  }
}
