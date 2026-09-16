import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PATHS = [
  "/dashboard",
  "/connections",
  "/diagnostics",
  "/sql-editor",
  "/query-management",
  "/schema-browser",
  "/roles",
  "/maintenance",
  "/config",
  "/replication",
  "/backups",
  "/snapshots",
  "/report",
  "/settings",
  "/users",
];

const REFRESH_COOKIE_NAME = "pgg_refresh";
const LEGACY_COOKIE_NAME = "pgguardian_api_token";
const LEGACY_AUTH_COOKIE = "auth";

export const config = {
  matcher: [
    "/",
    "/login",
    "/users/:path*",
    "/dashboard/:path*",
    "/connections/:path*",
    "/diagnostics/:path*",
    "/sql-editor/:path*",
    "/query-management/:path*",
    "/schema-browser/:path*",
    "/roles/:path*",
    "/maintenance/:path*",
    "/config/:path*",
    "/replication/:path*",
    "/backups/:path*",
    "/snapshots/:path*",
    "/report/:path*",
    "/settings/:path*",
  ],
};

function isProtected(pathname: string) {
  return PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  return Buffer.from(padded, "base64").toString("utf-8");
}

function getRoleFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return payload.role || payload["role"] || null;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasLegacyCookie = Boolean(request.cookies.get(LEGACY_COOKIE_NAME)?.value);
  const hasLegacyAuthCookie = Boolean(request.cookies.get(LEGACY_AUTH_COOKIE)?.value);
  const hasEnvToken = Boolean(process.env.NEXT_PUBLIC_PGGUARDIAN_API_TOKEN);

  if (hasLegacyCookie || hasEnvToken || hasLegacyAuthCookie) {
    return NextResponse.next();
  }

  const refreshCookie = request.cookies.get(REFRESH_COOKIE_NAME);
  const hasRefresh = Boolean(refreshCookie?.value);

  if (pathname === "/login") {
    if (hasRefresh) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (pathname === "/" || pathname === "") {
    return NextResponse.next();
  }

  if (pathname.startsWith("/users")) {
    if (!hasRefresh) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    const role = getRoleFromJwt(refreshCookie!.value);
    if (role !== "Admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!isProtected(pathname)) {
    return NextResponse.next();
  }

  if (!hasRefresh) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
