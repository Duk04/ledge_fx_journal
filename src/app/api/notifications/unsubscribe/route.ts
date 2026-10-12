import { NextResponse } from "next/server";
import { createTranslator } from "next-intl";
import { prisma } from "@/lib/db";
import en from "../../../../../messages/en.json";
import mn from "../../../../../messages/mn.json";
import { isLocale } from "@/i18n/config";
import { verifyUnsubscribe } from "@/lib/notifications/unsubscribe";
import type { NotificationKindName } from "@/lib/notifications/schedule";

/**
 * `GET`/`POST /api/notifications/unsubscribe?u=&k=&s=` — the link at the
 * bottom of every notification email, and the target of the
 * `List-Unsubscribe-Post` one-click header (which POSTs).
 *
 * Public (isPublicPath): it has to work from a mail client with no session.
 * The HMAC in `s` is the authorization — see lib/notifications/unsubscribe.ts.
 * GET answers with a small page in the user's language; POST with an empty
 * 200, which is all a mail client's one-click wants.
 */

const FIELD: Record<NotificationKindName, "journalReminder" | "weeklySummary"> = {
  JOURNAL_REMINDER: "journalReminder",
  WEEKLY_SUMMARY: "weeklySummary",
};

async function unsubscribe(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u") ?? "";
  const kind = url.searchParams.get("k") ?? "";
  const sig = url.searchParams.get("s") ?? "";
  if (!verifyUnsubscribe(userId, kind, sig)) return null;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
  if (!user) return null;
  // upsert: an unsubscribe for a user with no prefs row must still leave
  // one saying "off", not silently do nothing.
  await prisma.notificationPrefs.upsert({
    where: { userId },
    create: { userId, [FIELD[kind]]: false },
    update: { [FIELD[kind]]: false },
  });
  return { locale: isLocale(user.locale) ? user.locale : "en", kind };
}

export async function GET(request: Request) {
  const done = await unsubscribe(request);
  const locale = done?.locale ?? "en";
  const t = createTranslator({ locale, messages: (locale === "mn" ? mn : en) as typeof en, namespace: "unsubscribe" });
  const title = done ? t("doneTitle") : t("invalidTitle");
  const body = done ? t(done.kind === "JOURNAL_REMINDER" ? "doneReminder" : "doneSummary") : t("invalidBody");
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;line-height:1.5">
<h1 style="font-size:20px">${title}</h1><p>${body}</p><p><a href="/settings?tab=notifications">${t("settings")}</a></p></body></html>`;
  return new NextResponse(html, {
    status: done ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const done = await unsubscribe(request);
  return new NextResponse(null, { status: done ? 200 : 400 });
}
