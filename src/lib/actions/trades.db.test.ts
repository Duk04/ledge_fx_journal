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
import { createTrade } from "./trades";

/** A closed EURUSD long: +20 pips on 1 lot, 10-pip stop => +2R, $200 gross. */
function closedEurusdLong() {
  return buildFormData(
    defaultFormValues({
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
