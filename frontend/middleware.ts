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
];

export const config = {
  matcher: [
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isProtected(pathname)) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get("auth");
  const hasAuth = Boolean(authCookie?.value);

  if (!hasAuth) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
