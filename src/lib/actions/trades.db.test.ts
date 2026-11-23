/**
 * createTrade end to end against Postgres: the action parses the form, checks
 * account ownership, computes the derived columns, and stores them. The
 * formula layer is unit-tested; this asserts the STORED row is what the
 * dashboard will later read, and that another user's account is refused
 * without a write.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFormData, defaultFormValues } from "@/components/trades/trade-form-values";
import { signInAs } from "../../../test/db/auth";
import { createAccount, createUser, ensureInstruments } from "../../../test/db/factories";
import { closeRTrade, closeTrade, createTrade, duplicateTrade, setTradeNotes, updateTrade } from "./trades";

/** A closed EURUSD long: +20 pips on 1 lot, 10-pip stop => +2R, $200 gross. */
function closedEurusdLong() {
  return buildFormData(
    defaultFormValues({
      entryMode: "PRICE",
      symbol: "EURUSD",
      direction: "LONG",
      status: "CLOSED",
      // 13:30 UTC on a Wednesday — inside the London/New York overlap.
      openedAt: "2026-03-04T13:30:00.000Z",
      closedAt: "2026-03-04T15:00:00.000Z",
      entryPrice: "1.10000",
      exitPrice: "1.10200",
      stopLoss: "1.09900",
      volumeLots: "1",
      commission: "7",
    }),
  );
}

describe("createTrade", () => {
  it("stores the derived analytics columns, not just the raw facts", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const account = await createAccount(user.id);
    signInAs(user.id);

    const result = await createTrade(account.id, closedEurusdLong());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.grossPnl?.toString()).toBe("200");
    expect(row.netPnl?.toString()).toBe("193");
    expect(row.pips?.toString()).toBe("20");
    expect(row.rMultiple?.toString()).toBe("1.93");
    expect(row.holdingMinutes).toBe(90);
    expect(row.marketSession).toBe("OVERLAP");
  });

  it("refuses another user's account and writes nothing", async () => {
    await ensureInstruments("EURUSD");
    const alice = await createUser();
    const bob = await createUser();
    const bobsAccount = await createAccount(bob.id);
    signInAs(alice.id);

    const result = await createTrade(bobsAccount.id, closedEurusdLong());
    expect(result.ok).toBe(false);
    expect(await prisma.trade.count({ where: { accountId: bobsAccount.id } })).toBe(0);
  });

  it("refuses a tag that belongs to someone else", async () => {
    await ensureInstruments("EURUSD");
    const alice = await createUser();
    const bob = await createUser();
    const account = await createAccount(alice.id);
    const bobsTag = await prisma.tag.create({ data: { userId: bob.id, name: "bob-only", kind: "SETUP" } });
    signInAs(alice.id);

    const fd = closedEurusdLong();
    fd.append("tagIds", bobsTag.id);
    const result = await createTrade(account.id, fd);

    expect(result.ok).toBe(false);
    expect(await prisma.trade.count({ where: { accountId: account.id } })).toBe(0);
  });
});

describe("R-mode trades", () => {
  /** Risked $100 on a 1:2.5 plan, logged with no prices at all. */
  function rTrade(overrides: Parameters<typeof defaultFormValues>[0] = {}) {
    return buildFormData(
      defaultFormValues({
        symbol: "EURUSD",
        direction: "SHORT",
        status: "OPEN",
        openedAt: "2026-03-04T13:30:00.000Z",
        plannedRisk: "100",
        plannedRR: "2.5",
        ...overrides,
      }),
    );
  }

  it("stores a win as +RR and P&L as R × risk, with no fills", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const account = await createAccount(user.id);
    signInAs(user.id);

    const result = await createTrade(
      account.id,
      rTrade({ status: "CLOSED", closedAt: "2026-03-04T15:00:00.000Z", resultR: "2.5", commission: "5" }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result));

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: result.id }, include: { executions: true } });
    expect(row.entryMode).toBe("R_MULTIPLE");
    expect(row.entryPrice).toBeNull();
    expect(row.volumeLots).toBeNull();
    expect(row.rMultiple?.toString()).toBe("2.5");
    expect(row.grossPnl?.toString()).toBe("250");
    expect(row.netPnl?.toString()).toBe("245");
    expect(row.riskAmount?.toString()).toBe("100");
    expect(row.holdingMinutes).toBe(90);
    expect(row.executions).toHaveLength(0);
  });

  it("closes an open R trade at -1R, and refuses an exit price for it", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const account = await createAccount(user.id);
    signInAs(user.id);

    const created = await createTrade(account.id, rTrade());
    if (!created.ok) throw new Error(JSON.stringify(created));

    const byPrice = await closeTrade(account.id, created.id, {
      exitPrice: "1.1",
      closedAt: "2026-03-04T15:00:00.000Z",
    });
    expect(byPrice.ok).toBe(false);

    const closed = await closeRTrade(account.id, created.id, { resultR: "-1", closedAt: "2026-03-04T15:00:00.000Z" });
    expect(closed.ok).toBe(true);
    const row = await prisma.trade.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("CLOSED");
    expect(row.rMultiple?.toString()).toBe("-1");
    expect(row.netPnl?.toString()).toBe("-100");
  });

  it("duplicates the plan, not the result", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const account = await createAccount(user.id);
    signInAs(user.id);

    const created = await createTrade(
      account.id,
      rTrade({ status: "CLOSED", closedAt: "2026-03-04T15:00:00.000Z", resultR: "2.5" }),
    );
    if (!created.ok) throw new Error(JSON.stringify(created));
    const dup = await duplicateTrade(account.id, created.id);
    if (!dup.ok) throw new Error(JSON.stringify(dup));

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: dup.id } });
    expect(row).toMatchObject({ entryMode: "R_MULTIPLE", status: "OPEN", resultR: null, netPnl: null });
    expect(row.plannedRisk?.toString()).toBe("100");
    expect(row.plannedRR?.toString()).toBe("2.5");
  });

  it("keeps an R trade in R mode when edited, whatever the POST says", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const account = await createAccount(user.id);
    signInAs(user.id);

    const created = await createTrade(account.id, rTrade());
    if (!created.ok) throw new Error(JSON.stringify(created));
    const priceForm = buildFormData(
      defaultFormValues({ entryMode: "PRICE", symbol: "EURUSD", entryPrice: "1.1", volumeLots: "1" }),
    );
    const res = await updateTrade(account.id, created.id, priceForm);
    // Parsed as the R form, which this POST does not satisfy.
    expect(res.ok).toBe(false);
    const row = await prisma.trade.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.entryMode).toBe("R_MULTIPLE");
    expect(row.entryPrice).toBeNull();
  });
});

describe("updateTrade on a partly closed trade", () => {
  it("keeps the partial exit when only the notes change", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const account = await createAccount(user.id);
    signInAs(user.id);

    const open = buildFormData(
      defaultFormValues({
        entryMode: "PRICE",
        symbol: "EURUSD",
        direction: "LONG",
        status: "OPEN",
        openedAt: "2026-03-04T13:30:00.000Z",
        entryPrice: "1.10000",
        stopLoss: "1.09900",
        volumeLots: "1",
      }),
    );
    const created = await createTrade(account.id, open);
    if (!created.ok) throw new Error(JSON.stringify(created));
    const partial = await closeTrade(account.id, created.id, {
      exitPrice: "1.10100",
      closedAt: "2026-03-04T14:00:00.000Z",
      volumeLots: "0.5",
    });
    expect(partial.ok).toBe(true);

    // What the (locked) edit form posts back: its fields, plus a note.
    const edited = buildFormData(
      defaultFormValues({
        entryMode: "PRICE",
        symbol: "EURUSD",
        direction: "LONG",
        status: "OPEN",
        openedAt: "2026-03-04T13:30:00.000Z",
        entryPrice: "1.10000",
        stopLoss: "1.09900",
        volumeLots: "1",
        notes: "held the runner",
      }),
    );
    const res = await updateTrade(account.id, created.id, edited);
    expect(res.ok).toBe(true);

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: created.id }, include: { executions: true } });
    expect(row.notes).toBe("held the runner");
    expect(row.executions.map((e) => [e.kind, e.volumeLots.toString()]).sort()).toEqual([
      ["ENTRY", "1"],
      ["EXIT", "0.5"],
    ]);
  });
});

describe("updateTrade back to OPEN", () => {
  it("drops the exit, the close time and the P&L, whatever the POST carries", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const account = await createAccount(user.id);
    signInAs(user.id);

    const created = await createTrade(account.id, closedEurusdLong());
    if (!created.ok) throw new Error(JSON.stringify(created));

    // A crafted POST: status OPEN but the exit still attached.
    const fd = closedEurusdLong();
    fd.set("status", "OPEN");
    const res = await updateTrade(account.id, created.id, fd);
    expect(res.ok).toBe(true);

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: created.id }, include: { executions: true } });
    expect(row).toMatchObject({ status: "OPEN", exitPrice: null, closedAt: null, netPnl: null, holdingMinutes: null });
    expect(row.executions.map((e) => e.kind)).toEqual(["ENTRY"]);
  });
});

describe("duplicateTrade (price mode)", () => {
  it("opens a copy with its risk and session already computed", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const account = await createAccount(user.id);
    signInAs(user.id);

    const created = await createTrade(account.id, closedEurusdLong());
    if (!created.ok) throw new Error(JSON.stringify(created));
    const dup = await duplicateTrade(account.id, created.id);
    if (!dup.ok) throw new Error(JSON.stringify(dup));

    const row = await prisma.trade.findUniqueOrThrow({ where: { id: dup.id } });
    expect(row).toMatchObject({ status: "OPEN", exitPrice: null, closedAt: null, netPnl: null });
    // 10-pip stop on 1 lot of EURUSD.
    expect(row.riskAmount?.toString()).toBe("100");
    expect(row.marketSession).not.toBeNull();
  });
});

describe("closeTrade, clicked twice", () => {
  it("exits the lots once and reports the second as a failure, not a throw", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const account = await createAccount(user.id);
    signInAs(user.id);
    const created = await createTrade(
      account.id,
      buildFormData(
        defaultFormValues({
          entryMode: "PRICE",
          symbol: "EURUSD",
          direction: "LONG",
          status: "OPEN",
          openedAt: "2026-03-04T13:30:00.000Z",
          entryPrice: "1.10000",
          volumeLots: "1",
        }),
      ),
    );
    if (!created.ok) throw new Error(JSON.stringify(created));

    const close = () =>
      closeTrade(account.id, created.id, { exitPrice: "1.101", closedAt: "2026-03-04T15:00:00.000Z" });
    const results = await Promise.all([close(), close()]);

    expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
    const exits = await prisma.execution.count({ where: { tradeId: created.id, kind: "EXIT" } });
    expect(exits).toBe(1);
  });
});

describe("setTradeNotes", () => {
  async function tradeOf(userId: string) {
    const account = await createAccount(userId);
    signInAs(userId);
    const created = await createTrade(account.id, closedEurusdLong());
    if (!created.ok) throw new Error(JSON.stringify(created));
    return { account, tradeId: created.id };
  }

  it("saves the note and touches nothing the trade's numbers come from", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const { account, tradeId } = await tradeOf(user.id);
    const before = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { executions: true } });

    const res = await setTradeNotes(account.id, tradeId, "Faded the London high.\nToo early.");
    expect(res.ok).toBe(true);

    const after = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { executions: true } });
    expect(after.notes).toBe("Faded the London high.\nToo early.");
    // The reason this is not updateTrade: a note must not be able to move P&L
    // or rewrite the fills.
    expect(after.netPnl?.toString()).toBe(before.netPnl?.toString());
    expect(after.executions.map((e) => e.id)).toEqual(before.executions.map((e) => e.id));
  });

  it("clears the note when given only whitespace", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const { account, tradeId } = await tradeOf(user.id);
    await setTradeNotes(account.id, tradeId, "something");

    expect((await setTradeNotes(account.id, tradeId, "  \n ")).ok).toBe(true);
    expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).notes).toBeNull();
  });

  it("refuses a note over the limit with a field error, and keeps the old one", async () => {
    await ensureInstruments("EURUSD");
    const user = await createUser();
    const { account, tradeId } = await tradeOf(user.id);
    await setTradeNotes(account.id, tradeId, "kept");

    const res = await setTradeNotes(account.id, tradeId, "x".repeat(4001));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors?.notes?.length).toBe(1);
    expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).notes).toBe("kept");
  });

  it("refuses another user's account", async () => {
    await ensureInstruments("EURUSD");
    const alice = await createUser();
    const bob = await createUser();
    const { account: bobsAccount, tradeId } = await tradeOf(bob.id);
    signInAs(alice.id);

    expect((await setTradeNotes(bobsAccount.id, tradeId, "mine now")).ok).toBe(false);
    expect((await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } })).notes).toBeNull();
  });

  it("does not reach a trade in another account through one's own account id", async () => {
    // The account check passes (it is Alice's own); the trade id is Bob's.
    // The write is scoped to the checked account, so it matches nothing.
    await ensureInstruments("EURUSD");
    const alice = await createUser();
    const bob = await createUser();
    const { tradeId: bobsTrade } = await tradeOf(bob.id);
    const alicesAccount = await createAccount(alice.id);
    signInAs(alice.id);

    const res = await setTradeNotes(alicesAccount.id, bobsTrade, "mine now");
    expect(res.ok).toBe(false);
    expect((await prisma.trade.findUniqueOrThrow({ where: { id: bobsTrade } })).notes).toBeNull();
  });
});
