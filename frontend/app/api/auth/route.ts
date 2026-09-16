import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const COOKIE_NAME = "auth";
const TWELVE_HOURS_SEC = 12 * 60 * 60;
const IS_DEV = process.env.NODE_ENV !== "production";

interface AuthPostBody {
  api_token: string;
}

async function verifyApiToken(apiToken: string): Promise<boolean> {
  try {
    const baseUrl =
      process.env.PGGUARDIAN_API_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      "http://localhost:8000";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${baseUrl}/api/v1/health`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      return res.status === 200;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return true;
  }
}

export async function POST(request: Request) {
  try {
    const body: AuthPostBody = await request.json();
    const apiToken = body?.api_token;

    if (!apiToken || typeof apiToken !== "string") {
      return NextResponse.json(
        { detail: "api_token is required" },
        { status: 400 }
      );
    }

    const isValid = await verifyApiToken(apiToken);
    if (!isValid) {
      return NextResponse.json(
        { detail: "Invalid API token" },
        { status: 401 }
      );
    }

    const cookieStore = await cookies();
    cookieStore.set({
      name: COOKIE_NAME,
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
    cookieStore.set({
      name: COOKIE_NAME,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: !IS_DEV,
      path: "/",
      maxAge: 0,
    });

    return NextResponse.json({ success: true }, { status: 200 });
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
