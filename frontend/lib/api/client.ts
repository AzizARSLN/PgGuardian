"use client";

import { toast } from "sonner";
import { useAuthStore } from "@/store/useAuthStore";
import { getSelectedProfileFromStore } from "@/store/useProfileStore";

export const API_BASE_URL = "/api/v1";
export const DEFAULT_TIMEOUT = 30000;

export interface ValidationErrorLocItem {
  type: "string" | "number";
  value: string | number;
}

export interface ValidationErrorItem {
  type: string;
  loc: (string | number)[];
  msg: string;
  input: unknown;
  ctx?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  detail: string | ValidationErrorItem[];
}

export class ApiError extends Error {
  status: number;
  data: ApiErrorResponse | null;
  validationErrors: ValidationErrorItem[] | null;

  constructor(
    status: number,
    message: string,
    data: ApiErrorResponse | null = null
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.validationErrors =
      data && typeof data.detail !== "string" ? data.detail : null;
  }
}

export function getAccessTokenFromStore(): string | null {
  try {
    return useAuthStore.getState().access_token || null;
  } catch {
    return null;
  }
}

function getApiToken(): string | null {
  try {
    const jwtToken = getAccessTokenFromStore();
    if (jwtToken) return jwtToken;

    if (typeof window === "undefined") return null;
    const key = "pgguardian_api_token";
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setApiTokenInMemory(token: string): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("pgguardian_api_token", token);
  } catch {
  }
}

export function clearApiTokenInMemory(): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem("pgguardian_api_token");
  } catch {
  }
}

export interface RequestOptions extends RequestInit {
  timeout?: number;
  skipAuth?: boolean;
  skipToast?: boolean;
  params?: Record<string, string | number | boolean | undefined | null>;
}

function buildQueryString(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function performFetch<T = unknown>(
  url: string,
  headers: Record<string, string>,
  rest: RequestInit,
  timeout: number,
  skipToast: boolean
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...rest,
      headers,
      signal: controller.signal,
      credentials: "include",
    });

    const contentType = response.headers.get("content-type") || "";
    let data: unknown = null;

    if (contentType.includes("application/json")) {
      try {
        data = (await response.json()) as unknown;
      } catch {
        data = null;
      }
    } else if (response.status >= 200 && response.status < 300) {
      return (await response.text()) as unknown as T;
    }

    if (response.ok) {
      return data as T;
    }

    if (response.status === 401) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("auth:401"));
      }
      if (!skipToast) {
        toast.error("Oturum süresi doldu. Lütfen tekrar bağlanın.", {
          description: "API token geçersiz veya eksik.",
        });
      }
      throw new ApiError(401, "Unauthorized", data as ApiErrorResponse);
    }

    const errorData = data as ApiErrorResponse | null;
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

    if (errorData) {
      if (typeof errorData.detail === "string") {
        errorMessage = errorData.detail;
      } else if (Array.isArray(errorData.detail)) {
        const first = errorData.detail[0];
        if (first) {
          const loc = first.loc.join(".");
          errorMessage = `${first.msg} (${loc})`;
        }
      }
    }

    if (!skipToast) {
      if (response.status === 422) {
        toast.error("Doğrulama hatası", {
          description: errorMessage,
        });
      } else if (response.status >= 500) {
        toast.error("Sunucu hatası", {
          description: errorMessage,
        });
      } else if (response.status === 403) {
        toast.error("Yetki hatası", {
          description: errorMessage,
        });
      } else if (response.status === 404) {
        toast.error("Bulunamadı", { description: errorMessage });
      } else if (response.status >= 400) {
        toast.error("İstek hatası", { description: errorMessage });
      }
    }

    throw new ApiError(response.status, errorMessage, errorData);
  } catch (error) {
    if (error instanceof ApiError) throw error;

    if (error instanceof DOMException && error.name === "AbortError") {
      if (!skipToast) {
        toast.error("İstek zaman aşımına uğradı", {
          description: "Sunucu yanıt vermedi. Lütfen daha sonra tekrar deneyin.",
        });
      }
      throw new ApiError(408, "Request timeout");
    }

    if (error instanceof Error) {
      if (!skipToast) {
        toast.error("Bağlantı hatası", { description: error.message });
      }
      throw new ApiError(0, error.message);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function apiFetch<T = unknown>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT,
    skipAuth = false,
    skipToast = false,
    params,
    headers: customHeaders,
    ...rest
  } = options;

  const url = `${API_BASE_URL}${endpoint}${params ? buildQueryString(params) : ""}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(customHeaders as Record<string, string>),
  };

  if (rest.body && !(rest.body instanceof FormData)) {
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  if (!skipAuth) {
    const token = getApiToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const selectedProfile = getSelectedProfileFromStore();
  if (selectedProfile) {
    headers["X-Profile-Name"] = encodeURIComponent(selectedProfile);
  }

  try {
    return await performFetch<T>(url, { ...headers }, rest, timeout, skipToast);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && !skipAuth) {
      try {
        const newToken = await useAuthStore.getState().refreshAccessToken();
        if (newToken) {
          const retryHeaders: Record<string, string> = {
            ...headers,
            Authorization: `Bearer ${newToken}`,
          };
          if (selectedProfile) {
            retryHeaders["X-Profile-Name"] = encodeURIComponent(selectedProfile);
          }
          return await performFetch<T>(
            url,
            retryHeaders,
            rest,
            timeout,
            skipToast
          );
        }
      } catch {
        // ignore refresh errors, fall through to logout
      }

      await useAuthStore.getState().logout();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("auth:401"));
      }
      throw error;
    }
    throw error;
  }
}

export const api = {
  get: <T>(endpoint: string, options?: Omit<RequestOptions, "method">) =>
    apiFetch<T>(endpoint, { ...options, method: "GET" }),

  post: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">
  ) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: "POST",
      body:
        body !== undefined
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
    }),

  patch: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">
  ) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: "PATCH",
      body:
        body !== undefined
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
    }),

  put: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">
  ) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: "PUT",
      body:
        body !== undefined
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
    }),

  delete: <T>(
    endpoint: string,
    body?: unknown,
    options?: Omit<RequestOptions, "method" | "body">
  ) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: "DELETE",
      body:
        body !== undefined
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
      headers:
        body !== undefined && !(body instanceof FormData)
          ? { "Content-Type": "application/json", ...(options?.headers as Record<string, string> | undefined) }
          : options?.headers,
    }),
};
