/**
 * Shared reference data: reads unscoped, every WRITE gated by requireOwner()
 * (AGENTS.md, "The scoping rule"). A MEMBER's deleteCandles and importCandles
 * must write nothing — the import is an upsert, so a member's file would
 * otherwise replace bars every other user reads.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { signInAs } from "../../../test/db/auth";
import { createUser, ensureInstruments } from "../../../test/db/factories";
import { deleteCandles, importCandles } from "./candles";

async function seedBars(symbol: string, count: number) {
  await prisma.candle.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      symbol,
      timeframe: "H1" as const,
      ts: new Date(Date.UTC(2026, 0, 5, i)),
      open: "1.1",
      high: "1.2",
      low: "1.0",
      close: "1.15",
      source: "GENERIC_CSV" as const,
    })),
    skipDuplicates: true,
  });
}

describe("deleteCandles", () => {
  it("refuses a MEMBER and leaves every bar in place", async () => {
    await ensureInstruments("GBPUSD");
    await seedBars("GBPUSD", 5);
    const member = await createUser({ role: "MEMBER" });
    signInAs(member.id);

    const result = await deleteCandles({ symbol: "GBPUSD", timeframe: "H1" });
    expect(result.ok).toBe(false);
    expect(await prisma.candle.count({ where: { symbol: "GBPUSD", timeframe: "H1" } })).toBe(5);
  });

  it("lets the OWNER delete", async () => {
    await ensureInstruments("USDJPY");
    await seedBars("USDJPY", 3);
    const owner = await createUser({ role: "OWNER" });
    signInAs(owner.id);

    const result = await deleteCandles({ symbol: "USDJPY", timeframe: "H1" });
    expect(result.ok).toBe(true);
    expect(await prisma.candle.count({ where: { symbol: "USDJPY", timeframe: "H1" } })).toBe(0);
  });
});

function csvForm(symbol: string, close: string): FormData {
  const form = new FormData();
  const csv = ["time,open,high,low,close", `2026-01-05T00:00:00Z,1.1,1.2,1.0,${close}`].join("\n");
  form.set("file", new File([csv], "bars.csv", { type: "text/csv" }));
  form.set("symbol", symbol);
  form.set("timeframe", "H1");
  form.set("tzOffsetMinutes", "0");
  return form;
}

describe("importCandles", () => {
  it("refuses a MEMBER and leaves the stored bar untouched", async () => {
    await ensureInstruments("AUDUSD");
    await seedBars("AUDUSD", 1);
    const member = await createUser({ role: "MEMBER" });
    signInAs(member.id);

    const result = await importCandles(csvForm("AUDUSD", "9.99"));
    expect(result.ok).toBe(false);
    const bar = await prisma.candle.findFirstOrThrow({ where: { symbol: "AUDUSD", timeframe: "H1" } });
    expect(bar.close.toString()).toBe("1.15");
    expect(await prisma.candleImport.count({ where: { userId: member.id } })).toBe(0);
  });

  it("lets the OWNER import, replacing the stored bar", async () => {
    await ensureInstruments("NZDUSD");
    await seedBars("NZDUSD", 1);
    const owner = await createUser({ role: "OWNER" });
    signInAs(owner.id);

    const result = await importCandles(csvForm("NZDUSD", "1.18"));
    expect(result.ok).toBe(true);
    const bar = await prisma.candle.findFirstOrThrow({ where: { symbol: "NZDUSD", timeframe: "H1" } });
    expect(bar.close.toString()).toBe("1.18");
  });
});
