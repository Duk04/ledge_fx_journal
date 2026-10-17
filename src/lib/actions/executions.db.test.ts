/**
 * Fills against Postgres: the trade row is always the aggregate of its fills,
 * partial closes keep it OPEN, a full close computes P&L exactly as a
 * one-shot trade would, and invalid fill sets are refused.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFormData, defaultFormValues } from "@/components/trades/trade-form-values";
import { signInAs } from "../../../test/db/auth";
import { createAccount, createUser, ensureInstruments } from "../../../test/db/factories";
import { addExecution, deleteExecution } from "./executions";
import { closeTrade, createTrade, updateTrade } from "./trades";

async function openLong() {
  await ensureInstruments("EURUSD");
  const user = await createUser();
  const account = await createAccount(user.id);
  signInAs(user.id);
  const res = await createTrade(
    account.id,
    buildFormData(
      defaultFormValues({
        entryMode: "PRICE",
        symbol: "EURUSD",
        direction: "LONG",
        status: "OPEN",
        openedAt: "2026-03-04T10:00:00.000Z",
        entryPrice: "1.1000",
        stopLoss: "1.0990",
        volumeLots: "1",
      }),
    ),
  );
  if (!res.ok) throw new Error(res.formError);
  return { account, tradeId: res.id };
}

describe("executions", () => {
  it("a new trade gets exactly one ENTRY fill and an initial stop", async () => {
    const { tradeId } = await openLong();
    const trade = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, include: { executions: true } });
    expect(trade.executions.map((e) => [e.kind, e.price.toString(), e.volumeLots.toString()])).toEqual([
      ["ENTRY", "1.1", "1"],
    ]);
    expect(trade.initialStopLoss?.toString()).toBe("1.099");
  });

  it("scale in, partial close, then close the rest: OPEN until flat, exact P&L at the end", async () => {
    const { account, tradeId } = await openLong();

    const scaled = await addExecution(account.id, tradeId, {
      kind: "ENTRY",
      executedAt: "2026-03-04T11:00:00Z",
      price: "1.1020",
      volumeLots: "1",
    });
    expect(scaled).toMatchObject({ ok: true, status: "OPEN" });
    let t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
    expect([t.entryPrice?.toString(), t.volumeLots?.toString()]).toEqual(["1.101", "2"]);

    expect(
      await closeTrade(account.id, tradeId, {
        exitPrice: "1.1030",
        closedAt: "2026-03-04T12:00:00Z",
        volumeLots: "0.5",
      }),
    ).toMatchObject({ ok: true });
    t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
    expect(t.status).toBe("OPEN");
    expect(t.netPnl).toBeNull();

    // Closing more than is open is refused.
    expect(
      await closeTrade(account.id, tradeId, { exitPrice: "1.1050", closedAt: "2026-03-04T14:00:00Z", volumeLots: "2" }),
    ).toMatchObject({ ok: false });

    expect(
      await closeTrade(account.id, tradeId, { exitPrice: "1.1050", closedAt: "2026-03-04T14:00:00Z" }),
    ).toMatchObject({ ok: true });
    t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
    expect(t.status).toBe("CLOSED");
    expect(t.exitPrice?.toString()).toBe("1.1045");
    // Cash realised: exits 0.5×1.1030 + 1.5×1.1050 − entries 1.1000 + 1.1020,
    // × 100,000 = $700.
    expect(t.grossPnl?.toString()).toBe("700");
    expect(t.closedAt?.toISOString()).toBe("2026-03-04T14:00:00.000Z");
  });

  it("deleting the last exit reopens the trade; the only entry cannot be deleted", async () => {
    const { account, tradeId } = await openLong();
    await closeTrade(account.id, tradeId, { exitPrice: "1.1020", closedAt: "2026-03-04T12:00:00Z" });
    const fills = await prisma.execution.findMany({ where: { tradeId } });
    const exit = fills.find((f) => f.kind === "EXIT")!;
    const entry = fills.find((f) => f.kind === "ENTRY")!;

    expect(await deleteExecution(account.id, tradeId, exit.id)).toMatchObject({ ok: true, status: "OPEN" });
    expect(await deleteExecution(account.id, tradeId, entry.id)).toMatchObject({ ok: false });
    const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
    expect([t.status, t.exitPrice, t.netPnl]).toEqual(["OPEN", null, null]);
  });

  it("the edit form cannot overwrite the prices of a multi-fill trade", async () => {
    const { account, tradeId } = await openLong();
    await addExecution(account.id, tradeId, {
      kind: "ENTRY",
      executedAt: "2026-03-04T11:00:00Z",
      price: "1.1020",
      volumeLots: "1",
    });
    const res = await updateTrade(
      account.id,
      tradeId,
      buildFormData(
        defaultFormValues({
          entryMode: "PRICE",
          symbol: "EURUSD",
          direction: "LONG",
          status: "OPEN",
          openedAt: "2026-03-04T10:00:00.000Z",
          entryPrice: "9.9999",
          volumeLots: "7",
          notes: "kept",
        }),
      ),
    );
    expect(res.ok).toBe(true);
    const t = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId } });
    expect([t.entryPrice?.toString(), t.volumeLots?.toString(), t.notes]).toEqual(["1.101", "2", "kept"]);
  });

  it("refuses another user's trade", async () => {
    const { account, tradeId } = await openLong();
    signInAs((await createUser()).id);
    const res = await addExecution(account.id, tradeId, {
      kind: "EXIT",
      executedAt: "2026-03-04T12:00:00Z",
      price: "1.2",
      volumeLots: "1",
    });
    expect(res.ok).toBe(false);
    expect(await prisma.execution.count({ where: { tradeId } })).toBe(1);
  });
});
