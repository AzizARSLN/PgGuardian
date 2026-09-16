"use client";

import { create } from "zustand";
import {
  setApiTokenInMemory,
  clearApiTokenInMemory,
} from "@/lib/api/client";

interface AuthState {
  isAuthenticated: boolean;
  masterPasswordHash: string | null;
  apiToken: string | null;
  user: { email: string; role: string } | null;
  setApiToken: (token: string) => void;
  setAuthenticated: (value: boolean) => void;
  setMasterPasswordHash: (hash: string | null) => void;
  setUser: (user: { email: string; role: string } | null) => void;
  clearAuth: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  masterPasswordHash: null,
  apiToken: null,
  user: { email: "admin@pgguardian.local", role: "SuperAdmin" },

  setApiToken: (token: string) => {
    setApiTokenInMemory(token);
    set({ apiToken: token, isAuthenticated: true });
  },

  setAuthenticated: (value: boolean) => {
    set({ isAuthenticated: value });
  },

  setMasterPasswordHash: (hash: string | null) => {
    set({ masterPasswordHash: hash });
  },

  setUser: (user: { email: string; role: string } | null) => {
    set({ user });
  },

  clearAuth: () => {
    clearApiTokenInMemory();
    set({
      isAuthenticated: false,
      masterPasswordHash: null,
      apiToken: null,
      user: null,
    });
  },

  logout: () => {
    clearApiTokenInMemory();
    try {
      document.cookie = "auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    } catch {
      // noop
    }
    set({
      isAuthenticated: false,
      masterPasswordHash: null,
      apiToken: null,
    });
  },
}));

export default useAuthStore;
