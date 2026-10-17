/**
 * Restore against Postgres, end to end: user A's data is exported through
 * the real `GET /api/export/data`, then restored as user B through the real
 * action. Asserts the rules restore-store.ts states — new accounts, derived
 * columns recomputed (and equal to the originals), tags and playbooks
 * mapped, fills carried or synthesized, journal days never overwritten — and
 * that nobody else's rows move, and a bad file writes nothing.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as exportData } from "@/app/api/export/data/route";
import { buildFormData, defaultFormValues } from "@/components/trades/trade-form-values";
import { signInAs } from "../../../test/db/auth";
import { createAccount, createUser, ensureInstruments } from "../../../test/db/factories";
import { addExternalLink } from "./attachments";
import { addExecution } from "./executions";
import { saveJournalEntry } from "./journal";
import { createPlaybook, setRuleCheck } from "./playbooks";
import { restoreFromExport } from "./restore";
import { createTag } from "./tags";
import { createTrade } from "./trades";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function trade(accountId: string, values: Parameters<typeof defaultFormValues>[0]) {
  const res = await createTrade(accountId, buildFormData(defaultFormValues({ entryMode: "PRICE", ...values })));
  if (!res.ok) throw new Error(res.formError ?? JSON.stringify(res.fieldErrors));
  return res.id;
}

/** User A with a bit of everything, exported. */
async function exportedUser() {
  await ensureInstruments("EURUSD", "USDJPY");
  const user = await createUser();
  const account = await createAccount(user.id);
  await prisma.tradingAccount.update({
    where: { id: account.id },
    data: { dailyLossLimitPct: "5", maxDrawdownPct: "10", drawdownMode: "TRAILING", minTradingDays: 4 },
  });
  // Skipped on restore: there is no backtest run in the file to hang it on.
  await prisma.tradingAccount.create({
    data: { userId: user.id, label: "BT", platform: "OTHER", accountType: "BACKTEST", startingBalance: "10000" },
  });
  signInAs(user.id);

  const tag = await createTag({ name: "Breakout", kind: "SETUP", color: "#123456" });
  if (!tag.ok) throw new Error(tag.formError);
  const tagId = (await prisma.tag.findFirstOrThrow({ where: { userId: user.id, name: "Breakout" } })).id;
  const pb = await createPlaybook({ name: "Range", rules: ["Trend agrees", "Risk ≤ 1%"] });
  if (!pb.ok) throw new Error(pb.formError);

  const win = await trade(account.id, {
    symbol: "EURUSD",
    direction: "LONG",
    status: "CLOSED",
    openedAt: "2026-03-04T10:00:00.000Z",
    closedAt: "2026-03-04T12:00:00.000Z",
    entryPrice: "1.1000",
    exitPrice: "1.1020",
    stopLoss: "1.0990",
    maePrice: "1.0995",
    mfePrice: "1.1025",
    volumeLots: "1",
    commission: "-7",
    notes: "win",
    tagIds: [tagId],
    playbookId: pb.id,
  });
  const rules = await prisma.playbookRule.findMany({ where: { playbookId: pb.id }, orderBy: { sortOrder: "asc" } });
  await setRuleCheck(account.id, win, rules[0].id, true);
  await setRuleCheck(account.id, win, rules[1].id, false);
  await addExternalLink(win, "https://example.com/chart.png", "BEFORE", "entry");
  // An upload: only its storage key would travel, never the bytes.
  await prisma.attachment.create({ data: { tradeId: win, storageKey: `${user.id}/chart.png` } });

  // Scaled in and closed in two parts: four fills, a JPY quote in a USD account.
  const scaled = await trade(account.id, {
    symbol: "USDJPY",
    direction: "SHORT",
    status: "OPEN",
    openedAt: "2026-03-05T08:00:00.000Z",
    entryPrice: "150.00",
    stopLoss: "150.50",
    volumeLots: "1",
    notes: "scaled",
  });
  for (const fill of [
    { kind: "ENTRY", executedAt: "2026-03-05T09:00:00Z", price: "150.20", volumeLots: "1" },
    { kind: "EXIT", executedAt: "2026-03-05T10:00:00Z", price: "149.80", volumeLots: "0.5" },
    { kind: "EXIT", executedAt: "2026-03-05T14:00:00Z", price: "149.50", volumeLots: "1.5" },
  ]) {
    const res = await addExecution(account.id, scaled, fill);
    if (!res.ok) throw new Error(res.formError);
  }

  await trade(account.id, {
    symbol: "EURUSD",
    direction: "SHORT",
    status: "OPEN",
    openedAt: "2026-03-06T10:00:00.000Z",
    entryPrice: "1.1050",
    stopLoss: "1.1080",
    volumeLots: "0.5",
    notes: "open",
  });

  // Logged in R: no prices and no fills, so it must survive on its R inputs.
  const rwin = await createTrade(
    account.id,
    buildFormData(
      defaultFormValues({
        symbol: "EURUSD",
        direction: "SHORT",
        status: "CLOSED",
        openedAt: "2026-03-07T10:00:00.000Z",
        closedAt: "2026-03-07T11:00:00.000Z",
        plannedRisk: "100",
        plannedRR: "2.5",
        resultR: "2.5",
        notes: "rwin",
      }),
    ),
  );
  if (!rwin.ok) throw new Error(JSON.stringify(rwin));

  await prisma.balanceEvent.create({
    data: { accountId: account.id, kind: "DEPOSIT", amount: "500", occurredAt: new Date("2026-03-01T00:00:00Z") },
  });
  await saveJournalEntry({ date: "2026-03-04", field: "review", value: "A's review" });
  await saveJournalEntry({ date: "2026-03-05", field: "preMarket", value: "A's plan" });

  const res = await exportData();
  const file = (await res.json()) as Json;
  return { user, account, file };
}

function upload(file: unknown, name = "export.json") {
  const fd = new FormData();
  fd.set("file", new File([typeof file === "string" ? file : JSON.stringify(file)], name));
  return fd;
}

const DERIVED = ["netPnl", "grossPnl", "pips", "rMultiple", "riskAmount", "holdingMinutes", "marketSession"] as const;
const AGGREGATE = [
  "status",
  "entryPrice",
  "exitPrice",
  "volumeLots",
  "openedAt",
  "closedAt",
  "initialStopLoss",
  "entryMode",
  "plannedRisk",
  "plannedRR",
  "resultR",
] as const;

/** A trade's comparable columns, as strings, keyed by its notes. */
async function tradesByNote(userId: string) {
  const rows = await prisma.trade.findMany({
    where: { account: { userId, accountType: { not: "BACKTEST" } } },
    include: { executions: true, tradeTags: true, ruleChecks: true },
  });
  return new Map(
    rows.map((t) => [
      t.notes,
      {
        ...(Object.fromEntries(
          [...DERIVED, ...AGGREGATE].map((k) => [k, t[k] === null ? null : String(t[k])]),
        ) as Record<(typeof DERIVED)[number] | (typeof AGGREGATE)[number], string | null>),
        maePrice: t.maePrice?.toString() ?? null,
        executions: t.executions.length,
        tags: t.tradeTags.length,
        ruleChecks: t.ruleChecks.length,
        accountId: t.accountId,
        playbookId: t.playbookId,
      },
    ]),
  );
}

async function rowCounts(userId: string) {
  const [accounts, trades, tags, journal] = await Promise.all([
    prisma.tradingAccount.count({ where: { userId } }),
    prisma.trade.count({ where: { account: { userId } } }),
    prisma.tag.count({ where: { userId } }),
    prisma.journalEntry.count({ where: { userId } }),
  ]);
  return { accounts, trades, tags, journal };
}

describe("restoreFromExport", () => {
  it("restores into new accounts, recomputing derived columns and mapping tags and playbooks", async () => {
    const a = await exportedUser();
    expect(a.file.schemaVersion).toBe(3);
    expect(a.file.accounts.find((x: Json) => x.id === a.account.id).drawdownMode).toBe("TRAILING");

    // Someone else entirely, who must not be touched.
    const bystander = await createUser();
    const bystanderAccount = await createAccount(bystander.id);
    const bystanderBefore = await rowCounts(bystander.id);
    const aBefore = await rowCounts(a.user.id);
    const original = await tradesByNote(a.user.id);

    // B already has the tag, and a journal entry on one of A's days.
    const b = await createUser();
    signInAs(b.id);
    await createTag({ name: "Breakout", kind: "SETUP", color: "#654321" });
    await saveJournalEntry({ date: "2026-03-04", field: "review", value: "B's own review" });

    // A tampered derived column must not survive, and an unknown symbol is skipped.
    const file = structuredClone(a.file);
    const liveAccount = file.accounts.find((x: Json) => x.accountType !== "BACKTEST");
    liveAccount.trades.find((t: Json) => t.notes === "win").netPnl = "999999";
    liveAccount.trades.push({ ...liveAccount.trades[0], symbol: "ZZZFAKE", executions: [], notes: "ghost" });

    const res = await restoreFromExport(upload(file));
    if (!res.ok) throw new Error(res.formError);
    expect(res.accounts).toBe(1);
    expect(res.trades).toBe(4);
    expect(res.executions).toBe(2 + 4 + 1);
    expect(res.tagsCreated).toBe(0);
    expect(res.playbooksCreated).toBe(1);
    expect(res.skipped).toMatchObject({
      backtestAccounts: 1,
      unknownSymbolTrades: 1,
      unknownSymbols: ["ZZZFAKE"],
      journalDays: 1,
      uploadedAttachments: 1,
      invalidTrades: 0,
    });

    const [restoredAccount] = await prisma.tradingAccount.findMany({ where: { userId: b.id } });
    expect(restoredAccount.id).not.toBe(a.account.id);
    expect(restoredAccount.label).toBe(`${a.account.label} (restored)`);
    expect(restoredAccount.drawdownMode).toBe("TRAILING");
    expect(restoredAccount.maxDrawdownPct?.toString()).toBe("10");
    expect(restoredAccount.minTradingDays).toBe(4);
    expect(await prisma.balanceEvent.count({ where: { accountId: restoredAccount.id } })).toBe(1);

    const restored = await tradesByNote(b.id);
    const bTag = await prisma.tag.findFirstOrThrow({ where: { userId: b.id, name: "Breakout" } });
    const bPlaybook = await prisma.playbook.findFirstOrThrow({ where: { userId: b.id, name: "Range" } });
    for (const note of ["win", "scaled", "open", "rwin"]) {
      const before = original.get(note)!;
      const after = restored.get(note)!;
      for (const k of [...DERIVED, ...AGGREGATE, "maePrice", "executions", "tags", "ruleChecks"] as const) {
        expect([note, k, after[k]]).toEqual([note, k, before[k]]);
      }
      expect(after.accountId).toBe(restoredAccount.id);
    }
    expect(restored.get("win")!.netPnl).not.toBe("999999");
    expect(restored.get("win")!.playbookId).toBe(bPlaybook.id);
    expect(await prisma.tradeTag.findMany({ where: { tagId: bTag.id } })).toHaveLength(1);
    expect(await prisma.attachment.findMany({ where: { trade: { accountId: restoredAccount.id } } })).toMatchObject([
      { externalUrl: "https://example.com/chart.png", storageKey: null, kind: "BEFORE", caption: "entry" },
    ]);

    const journal = await prisma.journalEntry.findMany({ where: { userId: b.id }, orderBy: { entryDate: "asc" } });
    expect(journal.map((e) => [e.entryDate.toISOString().slice(0, 10), e.review ?? e.preMarket])).toEqual([
      ["2026-03-04", "B's own review"],
      ["2026-03-05", "A's plan"],
    ]);

    // Nobody else moved.
    expect(await rowCounts(a.user.id)).toEqual(aBefore);
    expect(await rowCounts(bystander.id)).toEqual(bystanderBefore);
    expect(await prisma.trade.count({ where: { accountId: bystanderAccount.id } })).toBe(0);

    // Restoring twice is two copies, never a merge.
    const again = await restoreFromExport(upload(a.file));
    expect(again.ok).toBe(true);
    expect(await prisma.tradingAccount.count({ where: { userId: b.id } })).toBe(2);
  });

  it("restores a version-1 file, synthesizing one entry and one exit per closed trade", async () => {
    const a = await exportedUser();
    const original = await tradesByNote(a.user.id);

    const v1 = structuredClone(a.file);
    v1.schemaVersion = 1;
    for (const k of ["strategies", "symbolAliases", "notificationPrefs"]) delete v1[k];
    for (const account of v1.accounts) {
      // A v1 writer could not have produced an R-mode trade.
      account.trades = account.trades.filter((t: Json) => t.entryMode !== "R_MULTIPLE");
      for (const t of account.trades)
        for (const k of [
          "executions",
          "initialStopLoss",
          "maePrice",
          "mfePrice",
          "tagRefs",
          "entryMode",
          "plannedRR",
          "plannedRisk",
          "resultR",
        ])
          delete t[k];
    }

    const c = await createUser();
    signInAs(c.id);
    const res = await restoreFromExport(upload(v1));
    if (!res.ok) throw new Error(res.formError);
    expect(res.trades).toBe(3);

    const restored = await tradesByNote(c.id);
    expect(restored.get("win")!.executions).toBe(2);
    expect(restored.get("open")!.executions).toBe(1);
    // Four real fills collapse to one entry and one exit at their averages —
    // and the P&L is still exactly the original (lib/metrics/fills.ts, header).
    expect(restored.get("scaled")!.executions).toBe(2);
    for (const note of ["win", "scaled", "open"]) {
      for (const k of DERIVED) expect([note, k, restored.get(note)![k]]).toEqual([note, k, original.get(note)![k]]);
    }
    expect(restored.get("win")!.initialStopLoss).toBe("1.099");
    expect(restored.get("win")!.tags).toBe(1);
  });

  it("refuses a malformed file and writes nothing", async () => {
    const a = await exportedUser();
    const b = await createUser();
    signInAs(b.id);
    const before = await rowCounts(b.id);

    const bad = structuredClone(a.file);
    bad.accounts[0].trades[0].entryPrice = "one point one";
    const res = await restoreFromExport(upload(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.formError).toMatch(/accounts\[0\]\.trades\[0\]\.entryPrice/);

    expect(await restoreFromExport(upload("{ not json"))).toMatchObject({ ok: false });
    expect(await restoreFromExport(upload({ schemaVersion: 9, accounts: [] }))).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/newer version/),
    });
    expect(await restoreFromExport(new FormData())).toMatchObject({ ok: false });

    // Valid JSON the database refuses (a balance too large for its column),
    // after tags and playbooks were already written in the same transaction:
    // all of it rolls back.
    const overflow = structuredClone(a.file);
    overflow.tags.push({ name: "Only-in-overflow", kind: "MISTAKE", color: null, sortOrder: 1 });
    overflow.accounts[0].startingBalance = "1e30";
    const failed = await restoreFromExport(upload(overflow));
    expect(failed).toMatchObject({ ok: false, formError: expect.stringMatching(/nothing was imported/) });

    expect(await rowCounts(b.id)).toEqual(before);
    expect(await prisma.playbook.count({ where: { userId: b.id } })).toBe(0);
  });
});
