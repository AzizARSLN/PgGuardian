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
  title: "PgGuardian",
  description: "PostgreSQL administration and diagnostics for DBAs",
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
