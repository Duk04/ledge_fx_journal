import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { journalNudge } from "@/lib/queries/notifications";

/**
 * "You traded today and haven't journaled." The in-app half of
 * docs/NOTIFICATIONS.md — no scheduler, no mail provider, so it works on
 * every instance. Renders nothing on a day without trades, once today's
 * entry exists, or when switched off in Settings → Notifications.
 */
export async function JournalNudge({ userId, timezone }: { userId: string; timezone: string }) {
  const nudge = await journalNudge(userId, timezone);
  if (!nudge) return null;
  const t = await getTranslations("dashboard.journalNudge");
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-panel border border-brand-line bg-brand-weak px-3.5 py-2.5 text-xs text-ink-2"
      title={t("dismissHint")}
    >
      <NotebookPen className="size-3.5 shrink-0 text-brand" aria-hidden />
      <span>{t("text", { count: nudge.tradeCount })}</span>
      <Link href={`/journal/${nudge.date}`} className="font-medium text-brand underline-offset-2 hover:underline">
        {t("cta")}
      </Link>
    </div>
  );
}
