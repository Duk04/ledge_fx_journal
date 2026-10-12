"use client";

import { WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOnlineStatus } from "./use-online-status";

/**
 * The entire "offline" story for this app: say so, plainly, and let every
 * write surface (trade form, attachment uploader) disable itself using the
 * same `useOnlineStatus()` hook. See docs/PWA.md for why there is no offline
 * write queue instead.
 *
 * Renders nothing while online. Mounted once in src/app/(app)/layout.tsx,
 * above the page content, so it's visible regardless of which route is open.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const t = useTranslations("shell");
  if (online) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 border-b border-warn/30 bg-warn-weak px-3 py-1.5 text-xs text-warn"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      <span>{t("offline")}</span>
    </div>
  );
}
