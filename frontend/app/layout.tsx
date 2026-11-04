import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { cookies } from "next/headers";
import "./globals.css";

import AppShell from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/lib/i18n";
import type { Locale } from "@/messages";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "PgGuardian | PostgreSQL DBA Dashboard and Query Analyzer",
  description:
    "PgGuardian is a PostgreSQL DBA dashboard, query analyzer and diagnostics platform for execution plans, live sessions, maintenance, backups and performance tuning.",
  keywords: [
    "PostgreSQL DBA",
    "PostgreSQL dashboard",
    "query analyzer",
    "execution plan",
    "pg_stat_activity",
    "database monitoring",
    "PostgreSQL diagnostics",
    "pgAdmin alternative",
    "FastAPI",
    "Next.js",
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const locale: Locale = cookieStore.get("pgg_locale")?.value === "en" ? "en" : "tr";

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <I18nProvider initialLocale={locale}>
            <Providers>
              <AppShell>{children}</AppShell>
              <Toaster position="top-right" richColors closeButton />
            </Providers>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
