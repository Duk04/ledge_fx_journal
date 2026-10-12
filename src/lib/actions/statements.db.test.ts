/**
 * Statement import against Postgres: preview writes nothing, import writes the
 * plan, a second import of the same file creates nothing, a later statement
 * closes a position that was imported open, undo removes exactly what one
 * import created, and another user's account is refused.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { MT4_DETAILED } from "@/lib/statements/fixtures";
import { signInAs } from "../../../test/db/auth";
import { createAccount, createUser, ensureInstruments } from "../../../test/db/factories";
import { importStatement, undoImport } from "./statements";

function form(text: string, mode: "preview" | "import", aliases: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("file", new File([text], "statement.htm", { type: "text/html" }));
  fd.set("tzMode", "ny-close");
  fd.set("mode", mode);
  fd.set("aliases", JSON.stringify(aliases));
  return fd;
}

async function setup() {
  await ensureInstruments("EURUSD", "EURJPY", "XAUUSD");
  const user = await createUser();
  const account = await createAccount(user.id);
  signInAs(user.id);
  return { user, account };
}

describe("importStatement", () => {
  it("previews without writing anything", async () => {
    const { account } = await setup();
    const result = await importStatement(account.id, form(MT4_DETAILED, "preview"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.counts).toEqual({ new: 3, close: 0, duplicate: 0, unmapped: 0 });
    expect(result.balanceEvents.new).toBe(1);
    expect(await prisma.trade.count({ where: { accountId: account.id } })).toBe(0);
    expect(await prisma.tradeImport.count({ where: { accountId: account.id } })).toBe(0);
  });

  it("imports, then a second import of the same file creates nothing", async () => {
    const { account } = await setup();
    const first = await importStatement(account.id, form(MT4_DETAILED, "import"));
    expect(first.ok).toBe(true);

    const trades = await prisma.trade.findMany({ where: { accountId: account.id }, orderBy: { openedAt: "asc" } });
    expect(trades.map((t) => [t.externalTicket, t.symbol, t.status])).toEqual([
      ["50000002", "EURUSD", "CLOSED"],
      ["50000003", "EURJPY", "CLOSED"],
      ["50000005", "XAUUSD", "OPEN"],
    ]);
    // The cross got the broker-implied rate, so its stored P&L is exact.
    const eurjpy = trades[1];
    expect(eurjpy.grossPnl?.toString()).toBe("201.34");
    expect(eurjpy.brokerProfit?.toString()).toBe("201.34");
    expect(await prisma.balanceEvent.count({ where: { accountId: account.id, kind: "DEPOSIT" } })).toBe(1);

    const again = await importStatement(account.id, form(MT4_DETAILED, "import"));
    expect(again.ok).toBe(false);
    expect(await prisma.trade.count({ where: { accountId: account.id } })).toBe(3);
  });

  it("closes a position that an earlier import brought in open, keeping the user's notes", async () => {
    const { account } = await setup();
    await importStatement(account.id, form(MT4_DETAILED, "import"));
    const open = await prisma.trade.findFirstOrThrow({ where: { accountId: account.id, externalTicket: "50000005" } });
    await prisma.trade.update({ where: { id: open.id }, data: { notes: "my write-up" } });

    // Next week's statement: 50000005 now appears under Closed Transactions.
    const later = MT4_DETAILED.replace(
      "<tr align=left><td colspan=13><b>Open Trades:</b></td></tr>",
      `<tr bgcolor=#FFFFFF align=right><td>50000005</td><td class=msdate nowrap>2026.03.10 11:00:00</td><td>sell</td><td class=mspt>2.00</td><td>XAUUSD</td><td>2950.50</td><td>2960.00</td><td>0.00</td><td class=msdate nowrap>2026.03.11 09:00:00</td><td>2940.50</td><td class=mspt>0.00</td><td class=mspt>0.00</td><td class=mspt>0.00</td><td class=mspt>2000.00</td></tr>
<tr align=left><td colspan=13><b>Open Trades:</b></td></tr>`,
    ).replace(/<tr bgcolor=#FFFFFF align=right><td>50000005<\/td>(?:(?!<\/tr>)[\s\S])*?2948\.10[\s\S]*?<\/tr>/, "");

    const preview = await importStatement(account.id, form(later, "preview"));
    expect(preview.ok && preview.counts).toMatchObject({ close: 1, duplicate: 2 });

    await importStatement(account.id, form(later, "import"));
    const closed = await prisma.trade.findUniqueOrThrow({ where: { id: open.id } });
    expect(closed.status).toBe("CLOSED");
    expect(closed.exitPrice?.toString()).toBe("2940.5");
    expect(closed.netPnl).not.toBeNull();
    expect(closed.notes).toBe("my write-up");
  });

  it("undo removes exactly what that import created", async () => {
    const { account } = await setup();
    const manual = await prisma.trade.create({
      data: {
        accountId: account.id,
        symbol: "EURUSD",
        direction: "LONG",
        status: "OPEN",
        openedAt: new Date(),
        entryPrice: "1.1",
        volumeLots: "1",
      },
    });
    const imported = await importStatement(account.id, form(MT4_DETAILED, "import"));
    if (!imported.ok) throw new Error(imported.formError);

    const undone = await undoImport(imported.importId!);
    expect(undone).toMatchObject({ ok: true, trades: 3, balanceEvents: 1 });
    expect(await prisma.trade.findMany({ where: { accountId: account.id }, select: { id: true } })).toEqual([
      { id: manual.id },
    ]);
  });

  it("saves a symbol mapping the user made in the preview", async () => {
    const { user, account } = await setup();
    const renamed = MT4_DETAILED.replace("<td>eurusd</td>", "<td>EU50.raw</td>");
    const preview = await importStatement(account.id, form(renamed, "preview"));
    expect(preview.ok && preview.unmappedSymbols).toEqual(["EU50.RAW"]);

    await importStatement(account.id, form(renamed, "import", { "EU50.RAW": "EURUSD" }));
    expect(
      await prisma.symbolAlias.findMany({ where: { userId: user.id }, select: { brokerSymbol: true, symbol: true } }),
    ).toEqual([{ brokerSymbol: "EU50.RAW", symbol: "EURUSD" }]);
    expect(await prisma.trade.count({ where: { accountId: account.id } })).toBe(3);
  });

  it("refuses another user's account and writes nothing", async () => {
    const { account } = await setup();
    const intruder = await createUser();
    signInAs(intruder.id);
    const result = await importStatement(account.id, form(MT4_DETAILED, "import"));
    expect(result.ok).toBe(false);
    expect(await prisma.trade.count({ where: { accountId: account.id } })).toBe(0);
  });

  it("refuses to undo someone else's import", async () => {
    const { account } = await setup();
    const imported = await importStatement(account.id, form(MT4_DETAILED, "import"));
    if (!imported.ok) throw new Error(imported.formError);
    signInAs((await createUser()).id);
    expect((await undoImport(imported.importId!)).ok).toBe(false);
    expect(await prisma.trade.count({ where: { accountId: account.id } })).toBe(3);
  });
});
