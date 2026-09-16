"use client";

import { create } from "zustand";
import { api, setApiTokenInMemory, clearApiTokenInMemory } from "@/lib/api/client";

export type UserRole = "Admin" | "DBA" | "Viewer";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  password_must_change: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  current: string;
  newPwd: string;
}

interface AuthState {
  isAuthenticated: boolean;
  access_token: string | null;
  user: User | null;
  isLoading: boolean;
  masterPasswordHash: string | null;
  apiToken: string | null;
  login: (req: LoginRequest) => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
  logout: () => Promise<void>;
  changePassword: (req: ChangePasswordRequest) => Promise<void>;
  setUser: (user: User | null) => void;
  setApiToken: (token: string) => void;
  setAuthenticated: (value: boolean) => void;
  setMasterPasswordHash: (hash: string | null) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  access_token: null,
  user: null,
  isLoading: false,
  masterPasswordHash: null,
  apiToken: null,

  login: async ({ email, password }) => {
    set({ isLoading: true });
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        let detail = "Giriş başarısız";
        try {
          const err = await res.json();
          if (err?.detail) detail = err.detail;
        } catch {
        }
        throw new Error(detail);
      }

      const data = await res.json();
      const user = data.user as User;
      const access_token = data.access_token as string;

      set({
        isAuthenticated: true,
        access_token,
        user,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  refreshAccessToken: async () => {
    try {
      const res = await fetch("/api/auth", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      const newToken = data.access_token as string;
      const newUser = data.user as User | undefined;

      set((state) => ({
        access_token: newToken,
        isAuthenticated: true,
        user: newUser || state.user,
      }));

      return newToken;
    } catch {
      return null;
    }
  },

  logout: async () => {
    try {
      await fetch("/api/auth", {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
    } finally {
      set({
        isAuthenticated: false,
        access_token: null,
        user: null,
        isLoading: false,
        masterPasswordHash: null,
        apiToken: null,
      });
      clearApiTokenInMemory();
    }
  },

  changePassword: async ({ current, newPwd }) => {
    await api.patch("/auth/me/change_password", {
      current_password: current,
      new_password: newPwd,
    });
    set((state) => ({
      user: state.user ? { ...state.user, password_must_change: false } : null,
    }));
  },

  setUser: (user) => {
    set({ user });
  },

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

  clearAuth: () => {
    clearApiTokenInMemory();
    set({
      isAuthenticated: false,
      masterPasswordHash: null,
      apiToken: null,
      access_token: null,
      user: null,
    });
  },
}));

export default useAuthStore;
