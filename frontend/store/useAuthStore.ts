"use client";

import { create } from "zustand";
import { api, setApiTokenInMemory, clearApiTokenInMemory } from "@/lib/api/client";
import { tGlobal } from "@/lib/i18n";
import { useProfileStore } from "@/store/useProfileStore";

// The web build talks to the Next.js route handler at /api/auth, which proxies
// to the backend and owns the HttpOnly refresh cookie. The desktop build has no
// Next.js server: the bundled FastAPI sidecar serves both the UI and the API on
// one origin, so it calls the auth endpoints directly.
const IS_DESKTOP = process.env.NEXT_PUBLIC_PGGUARDIAN_DESKTOP === "1";
const AUTH_LOGIN_URL = IS_DESKTOP ? "/api/v1/auth/login" : "/api/auth";
const AUTH_REFRESH_URL = IS_DESKTOP ? "/api/v1/auth/refresh" : "/api/auth";
const AUTH_LOGOUT_URL = IS_DESKTOP ? "/api/v1/auth/logout" : "/api/auth";
const AUTH_REFRESH_METHOD = IS_DESKTOP ? "POST" : "PATCH";
const AUTH_LOGOUT_METHOD = IS_DESKTOP ? "POST" : "DELETE";

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

let refreshInFlight: Promise<string | null> | null = null;

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
      const res = await fetch(AUTH_LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        let detail = tGlobal("api.loginFailed");
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

      useProfileStore.getState().setSelectedProfileName(null);
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

  refreshAccessToken: () => {
    refreshInFlight ??= (async () => {
    try {
      const res = await fetch(AUTH_REFRESH_URL, {
        method: AUTH_REFRESH_METHOD,
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
    } finally {
      refreshInFlight = null;
    }
    })();
    return refreshInFlight;
  },

  logout: async () => {
    try {
      await fetch(AUTH_LOGOUT_URL, {
        method: AUTH_LOGOUT_METHOD,
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
      // Signing out forgets the server too, so the next session starts at the
      // profile gate instead of silently reusing the old database.
      useProfileStore.getState().setSelectedProfileName(null);
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
