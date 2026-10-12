import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeScript } from "@/components/theme-script";
import { ToastProvider } from "@/components/ui/toast";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

/**
 * Fonts are linked from Google Fonts at runtime rather than pulled in through
 * `next/font/google`, because `next/font` fetches the font files during the
 * BUILD and this project has to build in environments with no route to
 * fonts.googleapis.com. The trade-off is one third-party request and a brief
 * fallback flash on a cold cache.
 *
 * If you build somewhere with network access — or you self-host the .woff2
 * files under /public/fonts — prefer the built-in loader instead. It
 * self-hosts the files, removes the request and eliminates the flash:
 *
 *   import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
 *   const sans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"] });
 *   const mono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });
 *   // ...then add `${sans.variable} ${mono.variable}` to the <html> className
 *   //    and delete the two <link> tags below.
 *
 * The font family names the stylesheet expects are declared in globals.css, so
 * either route works without touching a single component.
 */

export const metadata: Metadata = {
  title: {
    default: "Ledger — FX Journal",
    template: "%s · Ledger",
  },
  description:
    "A trading journal that logs every position, keeps the screenshots with it, and does the statistics for you.",
  applicationName: "Ledger",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Ledger", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#090b0f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- this is the
            root layout, so the stylesheet applies to every page; see the note
            above for why next/font isn't used here. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=Inter:wght@400..700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <ThemeScript />
      </head>
      <body className="min-h-full antialiased">
        {/* next-intl v4: the provider inherits locale and messages from
            src/i18n/request.ts on the server; nothing to pass. */}
        <NextIntlClientProvider>
          <ToastProvider>{children}</ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
