import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import SidebarNav from "@/components/sidebar-nav";
import Header from "@/components/header";
import { Toaster } from "@/components/ui/sonner";
import { cookies } from "next/headers";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "PgGuardian - PostgreSQL Yönetim Paneli",
  description: "PostgreSQL veritabanı yönetimi, teşhis ve izleme paneli",
};

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

function isProtected(pathname: string) {
  return PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const authCookie = cookieStore.get("auth");
  const hasAuth = Boolean(authCookie?.value);

  let pathname = "";
  try {
    const headersList = Object.fromEntries(cookieStore);
    const _ = headersList;
  } catch {
    // noop
  }

  const reqHeaders = (await import("next/headers"));
  const h = await reqHeaders.headers();
  const xUrl = h.get("x-next-pathname") || h.get("x-invoke-path") || "";
  pathname = xUrl;

  const showShell = hasAuth;

  return (
    <html lang="tr" suppressHydrationWarning>
      <body className={`antialiased min-h-screen`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Providers>
            {showShell ? (
              <div className="flex min-h-screen w-full">
                <SidebarNav />
                <div className="flex-1 flex flex-col min-w-0">
                  <Header />
                  <main className="flex-1 px-3 py-4 md:px-6 lg:px-8 overflow-x-hidden">{children}</main>
                </div>
              </div>
            ) : (
              <main className="min-h-screen flex items-center justify-center">
                {children}
              </main>
            )}
            <Toaster position="top-right" richColors closeButton />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
