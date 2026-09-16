import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const REFRESH_COOKIE_NAME = "pgg_refresh";
const LEGACY_COOKIE_NAME = "auth";
const LEGACY_TOKEN_COOKIE = "pgguardian_api_token";
const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;
const TWELVE_HOURS_SEC = 12 * 60 * 60;
const IS_DEV = process.env.NODE_ENV !== "production";

const BACKEND_BASE_URL =
  process.env.PGGUARDIAN_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://127.0.0.1:8000";

function extractRefreshCookieValue(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const cookies = setCookieHeader.split(/,(?=\s*[^\s=;]+=)/);
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    const match = trimmed.match(/^pgg_refresh=([^;]+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (typeof body.api_token === "string" && body.api_token) {
      const apiToken = body.api_token;
      let valid = true;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          const res = await fetch(`${BACKEND_BASE_URL}/api/v1/health`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${apiToken}`,
              Accept: "application/json",
            },
            signal: controller.signal,
          });
          valid = res.status === 200;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch {
        valid = true;
      }

      if (!valid) {
        return NextResponse.json(
          { detail: "Invalid API token" },
          { status: 401 }
        );
      }

      const cookieStore = await cookies();
      cookieStore.set({
        name: LEGACY_COOKIE_NAME,
        value: apiToken,
        httpOnly: true,
        sameSite: "lax",
        secure: !IS_DEV,
        path: "/",
        maxAge: TWELVE_HOURS_SEC,
      });
      cookieStore.set({
        name: LEGACY_TOKEN_COOKIE,
        value: apiToken,
        httpOnly: true,
        sameSite: "lax",
        secure: !IS_DEV,
        path: "/",
        maxAge: TWELVE_HOURS_SEC,
      });

      return NextResponse.json(
        { success: true, expires_in: TWELVE_HOURS_SEC },
        { status: 200 }
      );
    }

    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return NextResponse.json(
        { detail: "email and password are required" },
        { status: 400 }
      );
    }

    const backendRes = await fetch(
      `${BACKEND_BASE_URL}/api/v1/auth/login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, password }),
      }
    );

    if (!backendRes.ok) {
      let detail = "Invalid credentials";
      try {
        const err = await backendRes.json();
        if (err?.detail) detail = err.detail;
      } catch {
      }
      return NextResponse.json(
        { detail },
        { status: backendRes.status }
      );
    }

    const data = await backendRes.json();
    const setCookieHeader = backendRes.headers.get("set-cookie");
    const refreshTokenValue = extractRefreshCookieValue(setCookieHeader);

    if (refreshTokenValue) {
      const cookieStore = await cookies();
      cookieStore.set({
        name: REFRESH_COOKIE_NAME,
        value: refreshTokenValue,
        httpOnly: true,
        sameSite: "lax",
        secure: !IS_DEV,
        path: "/",
        maxAge: SEVEN_DAYS_SEC,
      });
    }

    return NextResponse.json(
      {
        access_token: data.access_token,
        user: data.user,
        expires_in: data.expires_in ?? 43200,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    const currentRefresh = cookieStore.get(REFRESH_COOKIE_NAME)?.value;

    try {
      await fetch(`${BACKEND_BASE_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(currentRefresh
            ? { Cookie: `${REFRESH_COOKIE_NAME}=${currentRefresh}` }
            : {}),
        },
        credentials: "include",
      });
    } catch {
    }

    cookieStore.set({
      name: REFRESH_COOKIE_NAME,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: !IS_DEV,
      path: "/",
      maxAge: 0,
    });
    cookieStore.set({
      name: LEGACY_COOKIE_NAME,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: !IS_DEV,
      path: "/",
      maxAge: 0,
    });
    cookieStore.set({
      name: LEGACY_TOKEN_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: !IS_DEV,
      path: "/",
      maxAge: 0,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function PATCH() {
  try {
    const cookieStore = await cookies();
    const currentRefresh = cookieStore.get(REFRESH_COOKIE_NAME)?.value;

    if (!currentRefresh) {
      return NextResponse.json(
        { detail: "No refresh token available" },
        { status: 401 }
      );
    }

    const backendRes = await fetch(
      `${BACKEND_BASE_URL}/api/v1/auth/refresh`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: `${REFRESH_COOKIE_NAME}=${currentRefresh}`,
        },
        credentials: "include",
      }
    );

    if (!backendRes.ok) {
      cookieStore.set({
        name: REFRESH_COOKIE_NAME,
        value: "",
        httpOnly: true,
        sameSite: "lax",
        secure: !IS_DEV,
        path: "/",
        maxAge: 0,
      });
      return NextResponse.json(
        { detail: "Refresh failed" },
        { status: backendRes.status }
      );
    }

    const data = await backendRes.json();
    const newRefreshToken = extractRefreshCookieValue(
      backendRes.headers.get("set-cookie")
    );

    if (newRefreshToken) {
      cookieStore.set({
        name: REFRESH_COOKIE_NAME,
        value: newRefreshToken,
        httpOnly: true,
        sameSite: "lax",
        secure: !IS_DEV,
        path: "/",
        maxAge: SEVEN_DAYS_SEC,
      });
    }

    return NextResponse.json(
      {
        access_token: data.access_token,
        user: data.user,
        expires_in: data.expires_in ?? 43200,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
