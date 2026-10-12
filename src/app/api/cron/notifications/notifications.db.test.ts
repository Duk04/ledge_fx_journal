/**
 * The notification cron end to end against Postgres, with only the mail
 * provider faked (global fetch). What it pins down:
 *  - the route is closed without CRON_SECRET and without the right bearer;
 *  - a due reminder is sent once per period, however many runs land in it;
 *  - "nothing to say" (no trades, already journaled) sends nothing and
 *    claims nothing, so a later run that day can still send;
 *  - a failed send is recorded and not retried;
 *  - the weekly summary reads last week's closed trades;
 *  - the signed unsubscribe link switches exactly that kind off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { buildFormData, defaultFormValues } from "@/components/trades/trade-form-values";
import { createTrade } from "@/lib/actions/trades";
import { unsubscribeUrl } from "@/lib/notifications/unsubscribe";
import { signInAs } from "../../../../../test/db/auth";
import { createAccount, createUser, ensureInstruments } from "../../../../../test/db/factories";
import { GET as cron } from "./route";
import { GET as unsubscribeGet } from "../../notifications/unsubscribe/route";

const SECRET = "cron-secret-for-tests-0123456789";
const UB = "Asia/Ulaanbaatar";

/** Wednesday 2026-03-04, 22:00 in Ulaanbaatar. */
const WED_EVENING = new Date("2026-03-04T14:00:00Z");
/** Monday 2026-03-09, 21:00 in Ulaanbaatar. */
const MON_EVENING = new Date("2026-03-09T13:00:00Z");

const fetchMock = vi.fn();

function call(auth: string | null = `Bearer ${SECRET}`) {
  return cron(
    new Request("http://ledger.test/api/cron/notifications", { headers: auth ? { authorization: auth } : {} }),
  );
}

/** Mails the fake provider received for one address. */
function mailsTo(email: string) {
  return fetchMock.mock.calls
    .map(
      ([, init]) => JSON.parse((init as RequestInit).body as string) as { to: string; subject: string; text: string },
    )
    .filter((m) => m.to === email);
}

async function traderWithTradeOnWednesday(prefs: { journalReminder?: boolean; weeklySummary?: boolean }) {
  await ensureInstruments("EURUSD");
  const user = await createUser({ timezone: UB });
  const account = await createAccount(user.id);
  signInAs(user.id);
  const result = await createTrade(
    account.id,
    buildFormData(
      defaultFormValues({
        symbol: "EURUSD",
        direction: "LONG",
        status: "CLOSED",
        openedAt: "2026-03-04T05:30:00.000Z",
        closedAt: "2026-03-04T07:00:00.000Z",
        entryPrice: "1.10000",
        exitPrice: "1.10200",
        stopLoss: "1.09900",
        volumeLots: "1",
      }),
    ),
  );
  expect(result.ok).toBe(true);
  await prisma.notificationPrefs.create({
    data: { userId: user.id, sendHour: 20, journalReminder: false, weeklySummary: false, ...prefs },
  });
  return { user, account };
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("AUTH_SECRET", "s".repeat(32));
  vi.stubEnv("AUTH_URL", "https://ledger.test");
  // Tests run with SKIP_ENV_VALIDATION, so `env` is raw process.env and a
  // .env file's "false" would be a truthy string here (env.ts parses it in
  // a real deployment).
  vi.stubEnv("REQUIRE_EMAIL_VERIFICATION", "");
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({ id: "email_1" }));
  vi.stubGlobal("fetch", fetchMock);
  // Only Date: Prisma's own timers must keep running.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/api/cron/notifications", () => {
  it("is closed without CRON_SECRET, and to a wrong or missing bearer", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call()).status).toBe(503);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call(null)).status).toBe(401);
    expect((await call(`Bearer ${SECRET}x`)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a due journal reminder once per day, however many runs land in it", async () => {
    vi.setSystemTime(WED_EVENING);
    const { user } = await traderWithTradeOnWednesday({ journalReminder: true });

    expect((await call()).status).toBe(200);
    await call();
    vi.setSystemTime(new Date(WED_EVENING.getTime() + 60 * 60 * 1000));
    await call();

    const mails = mailsTo(user.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("You traded today — your journal is still empty");
    expect(mails[0].text).toContain("1 trade on 2026-03-04");
    const logs = await prisma.notificationLog.findMany({ where: { userId: user.id } });
    expect(logs).toMatchObject([{ kind: "JOURNAL_REMINDER", periodKey: "2026-03-04", status: "SENT" }]);
  });

  it("before the chosen hour, or once the day is journaled, sends and claims nothing", async () => {
    vi.setSystemTime(new Date("2026-03-04T11:00:00Z")); // 19:00 local
    const { user } = await traderWithTradeOnWednesday({ journalReminder: true });
    await call();
    expect(mailsTo(user.email)).toHaveLength(0);

    await prisma.journalEntry.create({ data: { userId: user.id, entryDate: new Date("2026-03-04T00:00:00Z") } });
    vi.setSystemTime(WED_EVENING);
    await call();
    expect(mailsTo(user.email)).toHaveLength(0);
    expect(await prisma.notificationLog.count({ where: { userId: user.id } })).toBe(0);
  });

  it("records a failed send and does not retry it in the same period", async () => {
    vi.setSystemTime(WED_EVENING);
    const { user } = await traderWithTradeOnWednesday({ journalReminder: true });
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    await call();
    await call();
    expect(mailsTo(user.email)).toHaveLength(1);
    const log = await prisma.notificationLog.findFirstOrThrow({ where: { userId: user.id } });
    expect(log.status).toBe("FAILED");
    expect(log.error).toContain("429");
  });

  it("sends last week's summary on Monday evening", async () => {
    vi.setSystemTime(MON_EVENING);
    const { user, account } = await traderWithTradeOnWednesday({ weeklySummary: true });
    await call();
    const mails = mailsTo(user.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Your trading week of 2026-03-02");
    expect(mails[0].text).toContain(`${account.label}: 1 ·`);
    expect(mails[0].text).toContain("Journal entries: 0 of 1 trading days.");
  });
});

describe("/api/notifications/unsubscribe", () => {
  it("a signed link switches that kind off; a tampered one changes nothing", async () => {
    vi.setSystemTime(WED_EVENING);
    const { user } = await traderWithTradeOnWednesday({ journalReminder: true, weeklySummary: true });

    const good = unsubscribeUrl("https://ledger.test", user.id, "JOURNAL_REMINDER");
    const tampered = good.replace("JOURNAL_REMINDER", "WEEKLY_SUMMARY");
    expect((await unsubscribeGet(new Request(tampered))).status).toBe(400);
    expect((await unsubscribeGet(new Request(good))).status).toBe(200);

    const prefs = await prisma.notificationPrefs.findUniqueOrThrow({ where: { userId: user.id } });
    expect(prefs).toMatchObject({ journalReminder: false, weeklySummary: true });
  });
});
