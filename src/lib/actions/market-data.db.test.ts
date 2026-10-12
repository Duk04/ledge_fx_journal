/**
 * downloadCandles against Postgres with OANDA faked (global fetch). The
 * claims that matter: only the owner writes shared candles, and a download
 * fills gaps without ever replacing a bar someone imported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { signInAs } from "../../../test/db/auth";
import { createUser, ensureInstruments } from "../../../test/db/factories";
import { downloadCandles } from "./market-data";

const fetchMock = vi.fn();
const T0 = Date.UTC(2024, 0, 8); // Monday

function oandaPage(start: number, n: number, stepMs: number) {
  return {
    candles: Array.from({ length: n }, (_, i) => ({
      complete: true,
      volume: 10,
      time: ((start + i * stepMs) / 1000).toFixed(9),
      bid: { o: "1.10000", h: "1.10050", l: "1.09950", c: "1.10020" },
      ask: { o: "1.10010", h: "1.10060", l: "1.09960", c: "1.10030" },
    })),
  };
}

async function owner() {
  const user = await createUser({ role: "OWNER" });
  signInAs(user.id);
  return user;
}

beforeEach(async () => {
  await ensureInstruments("EURUSD");
  vi.stubEnv("OANDA_API_TOKEN", "test-token");
  vi.stubEnv("OANDA_ENVIRONMENT", "practice");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("downloadCandles", () => {
  it("is refused for a member, and without a token, before calling OANDA", async () => {
    const member = await createUser();
    signInAs(member.id);
    expect(
      await downloadCandles({ symbol: "EURUSD", timeframe: "H1", from: "2024-01-08", to: "2024-01-09" }),
    ).toMatchObject({ ok: false, formError: expect.stringContaining("instance owner") });

    await owner();
    vi.stubEnv("OANDA_API_TOKEN", "");
    expect(
      await downloadCandles({ symbol: "EURUSD", timeframe: "H1", from: "2024-01-08", to: "2024-01-09" }),
    ).toMatchObject({ ok: false, formError: expect.stringContaining("OANDA_API_TOKEN") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores new bars with the spread, and leaves an imported bar exactly as it was", async () => {
    await owner();
    // An MT5 import already has the first hour of the range.
    await prisma.candle.create({
      data: {
        symbol: "EURUSD",
        timeframe: "H1",
        ts: new Date(T0),
        open: "1.2",
        high: "1.2",
        low: "1.2",
        close: "1.2",
        spread: 7,
        source: "MT5_CSV",
      },
    });
    fetchMock.mockResolvedValueOnce(Response.json(oandaPage(T0, 24, 3_600_000)));

    const result = await downloadCandles({ symbol: "eurusd", timeframe: "H1", from: "2024-01-08", to: "2024-01-08" });
    expect(result).toMatchObject({ ok: true, fetched: 24, inserted: 23, existing: 1 });

    const kept = await prisma.candle.findUniqueOrThrow({
      where: { symbol_timeframe_ts: { symbol: "EURUSD", timeframe: "H1", ts: new Date(T0) } },
    });
    expect(kept.source).toBe("MT5_CSV");
    expect(kept.close.toString()).toBe("1.2");
    const added = await prisma.candle.findUniqueOrThrow({
      where: { symbol_timeframe_ts: { symbol: "EURUSD", timeframe: "H1", ts: new Date(T0 + 3_600_000) } },
    });
    expect(added).toMatchObject({ source: "API", spread: 10 });
    expect(added.close.toString()).toBe("1.1002");
  });

  it("refuses a range over the bar limit without asking OANDA", async () => {
    await owner();
    const result = await downloadCandles({ symbol: "EURUSD", timeframe: "M1", from: "2023-01-01", to: "2023-12-31" });
    expect(result).toMatchObject({ ok: false, formError: expect.stringContaining("60,000") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes OANDA's own refusal through", async () => {
    await owner();
    fetchMock.mockResolvedValueOnce(
      Response.json({ errorMessage: "Invalid value specified for 'accountID'" }, { status: 400 }),
    );
    const result = await downloadCandles({ symbol: "EURUSD", timeframe: "H1", from: "2024-01-08", to: "2024-01-08" });
    expect(result).toMatchObject({ ok: false, formError: expect.stringContaining("Invalid value specified") });
  });
});
