import { describe, expect, it } from "vitest";
import { formatIssuePath, parseExportFile, type ExportFileWrite } from "./export-schema";

/**
 * The export file contract, both directions. The writer side is enforced by
 * tsc (the route's payload is `ExportFileWrite`); these assert the reader
 * accepts what that type allows, accepts both versions, tolerates additions,
 * and rejects garbage with a path a person can find.
 */

/** Shaped like `GET /api/export/data` builds it — typed by the same type the
 * route uses, so a field the route must send cannot be left out here. */
function v3File(): ExportFileWrite {
  return {
    schemaVersion: 3,
    exportedAt: "2026-10-12T08:00:00.000Z",
    notIncluded: ["password hash"],
    profile: {
      id: "u1",
      email: "a@b.c",
      name: null,
      timezone: "UTC",
      locale: "en",
      role: "MEMBER",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    accounts: [
      {
        id: "a1",
        label: "Live",
        broker: null,
        platform: "MT5",
        accountType: "LIVE",
        currency: "USD",
        startingBalance: "10000",
        riskPerTradePct: "1",
        dailyLossLimitPct: "5",
        maxDrawdownPct: "10",
        drawdownMode: "TRAILING",
        profitTargetPct: "8",
        minTradingDays: 4,
        isArchived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        balanceEvents: [
          {
            id: "b1",
            kind: "DEPOSIT",
            amount: "500",
            occurredAt: "2026-02-01T00:00:00.000Z",
            note: null,
            externalTicket: null,
          },
        ],
        trades: [
          {
            id: "t1",
            symbol: "EURUSD",
            direction: "LONG",
            status: "CLOSED",
            openedAt: "2026-03-04T10:00:00.000Z",
            closedAt: "2026-03-04T12:00:00.000Z",
            entryMode: "PRICE",
            entryPrice: "1.1",
            plannedRR: null,
            plannedRisk: null,
            resultR: null,
            exitPrice: "1.102",
            stopLoss: "1.099",
            initialStopLoss: "1.099",
            maePrice: "1.0995",
            mfePrice: "1.1025",
            takeProfit: null,
            volumeLots: "1",
            commission: "-7",
            swap: "0",
            conversionRate: null,
            netPnl: "193",
            grossPnl: "200",
            pips: "20",
            rMultiple: "1.93",
            riskAmount: "100",
            holdingMinutes: 120,
            marketSession: "LONDON",
            followedPlan: true,
            emotion: 3,
            confidence: 4,
            notes: "ok",
            externalTicket: null,
            brokerProfit: null,
            executions: [
              {
                kind: "ENTRY",
                executedAt: "2026-03-04T10:00:00.000Z",
                price: "1.1",
                volumeLots: "1",
                externalDealId: null,
              },
              {
                kind: "EXIT",
                executedAt: "2026-03-04T12:00:00.000Z",
                price: "1.102",
                volumeLots: "1",
                externalDealId: null,
              },
            ],
            tags: ["Breakout"],
            tagRefs: [{ name: "Breakout", kind: "SETUP" }],
            playbook: "Breakout",
            ruleChecks: [{ rule: "Trend agrees", followed: true }],
            attachments: [
              {
                id: "x1",
                kind: "BEFORE",
                storageKey: null,
                externalUrl: "https://example.com/chart.png",
                mimeType: null,
                width: null,
                height: null,
                sizeBytes: null,
                caption: null,
                createdAt: "2026-03-04T12:00:00.000Z",
              },
            ],
          },
        ],
      },
    ],
    tags: [{ id: "g1", name: "Breakout", kind: "SETUP", color: "#33488F", sortOrder: 0 }],
    playbooks: [{ name: "Breakout", description: null, isArchived: false, rules: ["Trend agrees"] }],
    journalEntries: [{ date: "2026-03-04", preMarket: "plan", review: null, mood: 4 }],
    strategies: [{ name: "SMA", description: null, code: "function onBar(){}", params: { fast: 10 } }],
    symbolAliases: [{ brokerSymbol: "EURUSD.r", symbol: "EURUSD" }],
    notificationPrefs: { journalReminder: false, weeklySummary: true, sendHour: 20, inAppReminder: true },
  };
}

/** The same file as a version-2 writer produced it: no R mode. */
function v2File() {
  const file = JSON.parse(JSON.stringify(v3File()));
  file.schemaVersion = 2;
  for (const a of file.accounts) {
    for (const t of a.trades) for (const k of ["entryMode", "plannedRR", "plannedRisk", "resultR"]) delete t[k];
  }
  return file;
}

/** An R-mode trade, the shape v3 exists for: no prices, no fills. */
function rTrade() {
  return {
    ...v3File().accounts[0].trades![0],
    entryMode: "R_MULTIPLE" as const,
    entryPrice: null,
    exitPrice: null,
    stopLoss: null,
    initialStopLoss: null,
    maePrice: null,
    mfePrice: null,
    volumeLots: null,
    plannedRR: "2.5",
    plannedRisk: "100",
    resultR: "2.5",
    executions: [],
  };
}

/** The same file as a version-1 writer produced it: no fills, no initial
 * stop, none of the later additions. */
function v1File() {
  const file = v2File();
  file.schemaVersion = 1;
  delete file.strategies;
  delete file.symbolAliases;
  delete file.notificationPrefs;
  for (const a of file.accounts) {
    for (const k of ["dailyLossLimitPct", "maxDrawdownPct", "drawdownMode", "profitTargetPct", "minTradingDays"]) {
      delete a[k];
    }
    for (const t of a.trades) {
      for (const k of ["executions", "initialStopLoss", "maePrice", "mfePrice", "tagRefs"]) delete t[k];
    }
  }
  return file;
}

describe("parseExportFile", () => {
  it("accepts a version-3 file shaped like the route writes it (JSON round trip)", () => {
    const res = parseExportFile(JSON.parse(JSON.stringify(v3File())));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.schemaVersion).toBe(3);
    const [account] = res.data.accounts;
    expect(account.drawdownMode).toBe("TRAILING");
    expect(account.minTradingDays).toBe(4);
    const [trade] = account.trades;
    expect(trade.maePrice).toBe("1.0995");
    expect(trade.executions).toHaveLength(2);
    expect(trade.executions[0].executedAt).toEqual(new Date("2026-03-04T10:00:00.000Z"));
    expect(res.data.strategies).toHaveLength(1);
  });

  it("reads every version-2 trade as a PRICE trade", () => {
    const res = parseExportFile(v2File());
    if (!res.ok) throw new Error(res.issues.join("; "));
    expect(res.schemaVersion).toBe(2);
    expect(res.data.schemaVersion).toBe(3);
    expect(res.data.accounts[0].trades[0]).toMatchObject({ entryMode: "PRICE", plannedRisk: null, resultR: null });
  });

  it("accepts an R-mode trade with no prices and no fills", () => {
    const file = v3File();
    file.accounts[0].trades = [rTrade()];
    const res = parseExportFile(JSON.parse(JSON.stringify(file)));
    if (!res.ok) throw new Error(res.issues.join("; "));
    expect(res.data.accounts[0].trades[0]).toMatchObject({
      entryMode: "R_MULTIPLE",
      entryPrice: null,
      plannedRisk: "100",
    });
  });

  it("holds each mode to its own required fields", () => {
    const file = v3File();
    file.accounts[0].trades = [
      { ...rTrade(), plannedRisk: null },
      { ...v3File().accounts[0].trades![0], entryPrice: null },
    ];
    const res = parseExportFile(JSON.parse(JSON.stringify(file)));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.some((i) => i.startsWith("accounts[0].trades[0].plannedRisk:"))).toBe(true);
    expect(res.issues.some((i) => i.startsWith("accounts[0].trades[1].entryPrice:"))).toBe(true);
  });

  it("accepts an early version-2 file without the later additive fields", () => {
    const file = v1File();
    file.schemaVersion = 2;
    for (const t of file.accounts[0].trades) t.executions = v3File().accounts[0].trades![0].executions;
    const res = parseExportFile(file);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.accounts[0].dailyLossLimitPct).toBeNull();
    expect(res.data.accounts[0].trades[0].maePrice).toBeNull();
    expect(res.data.strategies).toEqual([]);
  });

  it("reads a version-1 file as one entry and one exit per closed trade", () => {
    const res = parseExportFile(v1File());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.schemaVersion).toBe(1);
    const [trade] = res.data.accounts[0].trades;
    expect(trade.initialStopLoss).toBe("1.099");
    expect(trade.executions).toEqual([
      {
        kind: "ENTRY",
        executedAt: new Date("2026-03-04T10:00:00.000Z"),
        price: "1.1",
        volumeLots: "1",
        externalDealId: null,
      },
      {
        kind: "EXIT",
        executedAt: new Date("2026-03-04T12:00:00.000Z"),
        price: "1.102",
        volumeLots: "1",
        externalDealId: null,
      },
    ]);
  });

  it("gives an open version-1 trade an entry only, and a cancelled one no fills", () => {
    const file = v1File();
    const base = file.accounts[0].trades[0];
    file.accounts[0].trades = [
      { ...base, status: "OPEN", closedAt: null, exitPrice: null },
      { ...base, status: "CANCELLED" },
    ];
    const res = parseExportFile(file);
    if (!res.ok) throw new Error(res.issues.join("; "));
    expect(res.data.accounts[0].trades.map((t) => t.executions.map((e) => e.kind))).toEqual([["ENTRY"], []]);
  });

  it("tolerates fields it does not know, at every level", () => {
    const file = JSON.parse(JSON.stringify(v3File()));
    file.futureTopLevel = { anything: true };
    file.accounts[0].futureAccountField = 1;
    file.accounts[0].trades[0].futureTradeField = "x";
    file.accounts[0].trades[0].executions[0].commission = "-3.5";
    expect(parseExportFile(file).ok).toBe(true);
  });

  it("accepts decimals as numbers or in exponent notation", () => {
    const file = JSON.parse(JSON.stringify(v3File()));
    file.accounts[0].startingBalance = 10000;
    file.accounts[0].trades[0].stopLoss = "1.2e-7";
    const res = parseExportFile(file);
    if (!res.ok) throw new Error(res.issues.join("; "));
    expect(res.data.accounts[0].startingBalance).toBe("10000");
  });

  it("names the field that is wrong", () => {
    const file = JSON.parse(JSON.stringify(v3File()));
    file.accounts[0].trades[0].entryPrice = "one point one";
    delete file.accounts[0].trades[0].symbol;
    const res = parseExportFile(file);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid");
    expect(res.issues.some((i) => i.startsWith("accounts[0].trades[0].entryPrice:"))).toBe(true);
    expect(res.issues.some((i) => i.startsWith("accounts[0].trades[0].symbol:"))).toBe(true);
  });

  it("requires fills on a version-2 trade", () => {
    const file = v2File();
    delete file.accounts[0].trades[0].executions;
    const res = parseExportFile(file);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0]).toMatch(/^accounts\[0\]\.trades\[0\]\.executions:/);
  });

  it("tells garbage, a newer version and a broken export apart", () => {
    expect(parseExportFile(null)).toMatchObject({ ok: false, reason: "notAnExport" });
    expect(parseExportFile([1, 2])).toMatchObject({ ok: false, reason: "notAnExport" });
    expect(parseExportFile({ hello: "world" })).toMatchObject({ ok: false, reason: "notAnExport" });
    expect(parseExportFile({ schemaVersion: "2" })).toMatchObject({ ok: false, reason: "notAnExport" });
    expect(parseExportFile({ ...v3File(), schemaVersion: 4 })).toMatchObject({ ok: false, reason: "newerVersion" });
    expect(parseExportFile({ schemaVersion: 2 })).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("formatIssuePath", () => {
  it("reads like the JSON it points into", () => {
    expect(formatIssuePath(["accounts", 0, "trades", 3, "entryPrice"])).toBe("accounts[0].trades[3].entryPrice");
    expect(formatIssuePath([])).toBe("");
  });
});
