/**
 * The trade list's link-only filters against Postgres: one import's trades,
 * trades without a screenshot, and one calendar day. Each is a Prisma `where`
 * fragment whose point is which rows it does NOT match, which a mock would
 * only repeat back.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildFormData, defaultFormValues } from "@/components/trades/trade-form-values";
import { createTrade } from "@/lib/actions/trades";
import { signInAs } from "../../../test/db/auth";
import { createAccount, createUser, ensureInstruments } from "../../../test/db/factories";
import { listTrades, type TradeFilters } from "./trades";

async function setup() {
  await ensureInstruments("EURUSD");
  const user = await createUser(); // timezone UTC
  const account = await createAccount(user.id);
  signInAs(user.id);
  return { user, account };
}

/** An EURUSD long opened at `openedAt`, closed at `closedAt` when given. */
async function trade(accountId: string, openedAt: string, closedAt?: string) {
  const created = await createTrade(
    accountId,
    buildFormData(
      defaultFormValues({
        entryMode: "PRICE",
        symbol: "EURUSD",
        direction: "LONG",
        status: closedAt ? "CLOSED" : "OPEN",
        openedAt,
        closedAt: closedAt ?? "",
        entryPrice: "1.10000",
        exitPrice: closedAt ? "1.10200" : "",
        stopLoss: "1.09900",
        volumeLots: "1",
      }),
    ),
  );
  if (!created.ok) throw new Error(JSON.stringify(created));
  return created.id;
}

const day = (date: string) => ({
  from: new Date(`${date}T00:00:00.000Z`),
  to: new Date(`${date}T23:59:59.999Z`),
});

async function ids(userId: string, accountId: string, filters: TradeFilters) {
  const { rows } = await listTrades({ userId, accountId, filters });
  return rows.map((r) => r.id).sort();
}

describe("listTrades — importId", () => {
  it("returns only the trades that import created", async () => {
    const { user, account } = await setup();
    const imported = await trade(account.id, "2026-03-02T13:30:00.000Z", "2026-03-02T15:00:00.000Z");
    await trade(account.id, "2026-03-03T13:30:00.000Z", "2026-03-03T15:00:00.000Z");
    const imp = await prisma.tradeImport.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "CSV",
        tzMode: "ny-close",
        tradesCreated: 1,
        tradesSkipped: 0,
        balanceEvents: 0,
      },
    });
    await prisma.trade.update({ where: { id: imported }, data: { importId: imp.id } });

    expect(await ids(user.id, account.id, { importId: imp.id })).toEqual([imported]);
  });
});

describe("listTrades — withoutScreenshot", () => {
  it("leaves out a trade once it has a screenshot, and carries the rows the dialog opens with", async () => {
    const { user, account } = await setup();
    const withShot = await trade(account.id, "2026-03-02T13:30:00.000Z", "2026-03-02T15:00:00.000Z");
    const without = await trade(account.id, "2026-03-03T13:30:00.000Z", "2026-03-03T15:00:00.000Z");
    await prisma.attachment.create({
      data: { tradeId: withShot, kind: "BEFORE", externalUrl: "https://example.com/chart.png", caption: "entry" },
    });

    expect(await ids(user.id, account.id, { withoutScreenshot: true })).toEqual([without]);

    const { rows } = await listTrades({ userId: user.id, accountId: account.id });
    expect(rows.find((r) => r.id === withShot)?.attachments).toMatchObject([{ kind: "BEFORE", caption: "entry" }]);
    expect(rows.find((r) => r.id === without)?.attachments).toEqual([]);
  });
});

describe("listTrades — day", () => {
  it("puts a trade on the day it closed, as the calendar does, not the day it opened", async () => {
    const { user, account } = await setup();
    // Opened Monday, closed Tuesday.
    const overnight = await trade(account.id, "2026-03-02T20:00:00.000Z", "2026-03-03T09:00:00.000Z");

    expect(await ids(user.id, account.id, { day: day("2026-03-03") })).toEqual([overnight]);
    expect(await ids(user.id, account.id, { day: day("2026-03-02") })).toEqual([]);
  });

  it("puts a still-open trade on the day it opened", async () => {
    const { user, account } = await setup();
    const open = await trade(account.id, "2026-03-02T20:00:00.000Z");

    expect(await ids(user.id, account.id, { day: day("2026-03-02") })).toEqual([open]);
  });

  it("leaves a cancelled order off every day", async () => {
    // monthView() does not count it on the calendar cell, so the list a cell
    // links to must not show it either.
    const { user, account } = await setup();
    const cancelled = await trade(account.id, "2026-03-02T20:00:00.000Z");
    await prisma.trade.update({ where: { id: cancelled }, data: { status: "CANCELLED" } });

    expect(await ids(user.id, account.id, { day: day("2026-03-02") })).toEqual([]);
  });
});
