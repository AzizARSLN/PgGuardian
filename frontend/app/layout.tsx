import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
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

function hasAnyAuth(cookieStore: ReadonlyRequestCookies) {
  const newAuth = cookieStore.get("pgg_refresh");
  const legacyToken = cookieStore.get("pgguardian_api_token");
  const legacyAuth = cookieStore.get("auth");
  const envToken = process.env.NEXT_PUBLIC_PGGUARDIAN_API_TOKEN;
  return Boolean(
    newAuth?.value ||
    legacyToken?.value ||
    legacyAuth?.value ||
    envToken
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const showShell = hasAnyAuth(cookieStore);

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
