/**
 * Shared reference data: reads unscoped, every WRITE gated by requireOwner()
 * (AGENTS.md, "The scoping rule"). This is the test docs/TESTING.md named
 * as missing — a MEMBER's deleteCandles must write nothing.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { signInAs } from "../../../test/db/auth";
import { createUser, ensureInstruments } from "../../../test/db/factories";
import { deleteCandles } from "./candles";

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
