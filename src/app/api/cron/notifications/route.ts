import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { emailConfigured, sendEmail } from "@/lib/email";
import { dueNotifications, type DueNotification } from "@/lib/notifications/schedule";
import { journalReminderEmail, weeklySummaryEmail, type RenderedEmail } from "@/lib/notifications/templates";
import { unsubscribeUrl } from "@/lib/notifications/unsubscribe";
import { countTradingActivity, hasJournalEntry, listEmailRecipients, weekSummary } from "@/lib/queries/notifications";

/**
 * `GET`/`POST /api/cron/notifications` — sends whatever reminders and
 * summaries are due. Called hourly by a scheduler (vercel.json, or the
 * GitHub Actions fallback in .github/workflows/notifications.yml) with
 * `Authorization: Bearer $CRON_SECRET`. See docs/NOTIFICATIONS.md.
 *
 * Public in the middleware (isPublicPath) because a scheduler has no
 * session; the secret is the whole of its authentication, compared in
 * constant time. With CRON_SECRET unset the route refuses everything.
 *
 * EXACTLY ONCE, OR AT MOST ONCE. Each send first INSERTs its
 * NotificationLog row; the unique (user, kind, period) key makes the insert
 * the lock. Two overlapping runs, a retried request, or the "due from
 * sendHour onwards" rule calling the same user every hour all collapse to
 * one mail. The cost is the other direction: a send that fails stays FAILED
 * for that period instead of being retried — a missed reminder beats a
 * duplicated one.
 */

function authorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Outcome = "sent" | "failed" | "duplicate" | "nothing";

/** Claims the period, or reports that another run already did. */
async function claim(userId: string, due: DueNotification): Promise<string | null> {
  try {
    const row = await prisma.notificationLog.create({
      data: { userId, kind: due.kind, periodKey: due.periodKey },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

async function deliver(logId: string, to: string, mail: RenderedEmail, unsubscribe: string): Promise<Outcome> {
  const result = await sendEmail({
    to,
    ...mail,
    // RFC 8058 one-click: mail clients show their own unsubscribe button and
    // POST to the URL, which the unsubscribe route accepts.
    headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  await prisma.notificationLog.update({
    where: { id: logId },
    data: result.ok ? { status: "SENT" } : { status: "FAILED", error: result.error.slice(0, 500) },
  });
  return result.ok ? "sent" : "failed";
}

async function run(baseUrl: string, now: Date) {
  const counts: Record<Outcome, number> = { sent: 0, failed: 0, duplicate: 0, nothing: 0 };
  const recipients = await listEmailRecipients();

  for (const r of recipients) {
    const user = r.user;
    // An instance that verifies addresses only mails verified ones; one that
    // does not has nothing better to go on than the opt-in itself.
    if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) continue;

    for (const due of dueNotifications(r, user.timezone, now)) {
      // Decide BEFORE claiming: a day with no trades yet at 20:00 may still
      // get one at 22:00, and a claimed period would block that reminder.
      let mail: RenderedEmail | null = null;
      const unsubscribe = unsubscribeUrl(baseUrl, user.id, due.kind);

      if (due.kind === "JOURNAL_REMINDER") {
        const [tradeCount, written] = await Promise.all([
          countTradingActivity(user.id, due.from, due.to),
          hasJournalEntry(user.id, due.periodKey),
        ]);
        if (tradeCount > 0 && !written) {
          mail = journalReminderEmail({
            locale: user.locale,
            date: due.periodKey,
            tradeCount,
            appUrl: baseUrl,
            unsubscribeUrl: unsubscribe,
          });
        }
      } else {
        const week = await weekSummary(user.id, due.from, due.to, user.timezone);
        if (week) {
          mail = weeklySummaryEmail({
            locale: user.locale,
            week: due.periodKey,
            ...week,
            appUrl: baseUrl,
            unsubscribeUrl: unsubscribe,
          });
        }
      }

      if (!mail) {
        counts.nothing++;
        continue;
      }
      const logId = await claim(user.id, due);
      if (!logId) {
        counts.duplicate++;
        continue;
      }
      counts[await deliver(logId, user.email, mail, unsubscribe)]++;
    }
  }
  return { recipients: recipients.length, ...counts };
}

async function handle(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not set; notifications are disabled." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!emailConfigured()) return NextResponse.json({ skipped: "Email is not configured (RESEND_API_KEY)." });

  const baseUrl = env.AUTH_URL ?? new URL(request.url).origin;
  return NextResponse.json(await run(baseUrl, new Date()));
}

export const GET = handle;
export const POST = handle;
