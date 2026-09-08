import "server-only";
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/db";
import { equityCurve, maxDrawdown, summarize } from "@/lib/metrics";
import { toDec, toDecOr, toNum, toPlain } from "@/lib/decimal-bridge";
import { toTradeRow } from "@/lib/trade-service";
import type { BalanceEvent } from "@/lib/metrics/types";
import type { Prisma } from "@prisma/client";

type PrismaDecimal = Prisma.Decimal;

/**
 * Account-level reads. Every function here takes a userId and filters on it —
 * see the scoping rule in src/lib/session.ts. There is no unscoped read.
 */

/**
 * The metrics layer wants signed amounts (a withdrawal reduces the balance),
 * while the database stores a positive magnitude plus a `kind`. Converting in
 * one place means the equity curve can never be off by twice a withdrawal.
 */
function toBalanceEvents(
  rows: { kind: "DEPOSIT" | "WITHDRAWAL" | "ADJUSTMENT"; amount: PrismaDecimal; occurredAt: Date }[],
): BalanceEvent[] {
  return rows.map((e) => {
    const magnitude = toDecOr(e.amount, 0);
    return {
      kind: e.kind,
      amount: e.kind === "WITHDRAWAL" ? magnitude.abs().neg() : magnitude,
      at: e.occurredAt,
    };
  });
}

export type AccountSummary = {
  id: string;
  label: string;
  broker: string | null;
  platform: string;
  accountType: string;
  currency: string;
  isArchived: boolean;
  startingBalance: string;
  /** startingBalance + realised P&L + deposits/withdrawals. */
  equity: string;
  /** Realised P&L only, i.e. equity minus cash movements and the starting float. */
  netPnl: string;
  tradeCount: number;
  openCount: number;
  /** Equity over time, thinned for a sparkline. */
  spark: number[];
};

export async function listAccounts(userId: string): Promise<AccountSummary[]> {
  const accounts = await prisma.tradingAccount.findMany({
    where: { userId },
    orderBy: [{ isArchived: "asc" }, { createdAt: "asc" }],
    include: {
      trades: {
        select: {
          netPnl: true,
          rMultiple: true,
          openedAt: true,
          closedAt: true,
          holdingMinutes: true,
          status: true,
        },
      },
      balanceEvents: { select: { kind: true, amount: true, occurredAt: true } },
    },
  });

  return accounts.map((account) => {
    const rows = account.trades.map(toTradeRow);
    const events = toBalanceEvents(account.balanceEvents);
    const start = toDecOr(account.startingBalance, 0);
    const curve = equityCurve(rows, start, events);
    const equity = curve.length ? curve[curve.length - 1].balance : start;
    const stats = summarize(rows);

    return {
      id: account.id,
      label: account.label,
      broker: account.broker,
      platform: account.platform,
      accountType: account.accountType,
      currency: account.currency,
      isArchived: account.isArchived,
      startingBalance: toPlain(start)!,
      equity: toPlain(equity)!,
      netPnl: toPlain(stats.netPnl)!,
      tradeCount: stats.tradeCount,
      openCount: stats.openCount,
      spark: thin(curve.map((p) => toNum(p.balance) ?? 0), 24),
    };
  });
}

/** Full equity/drawdown picture for one account. */
export async function getAccountEquity(userId: string, accountId: string) {
  const account = await prisma.tradingAccount.findFirst({
    where: { id: accountId, userId },
    include: {
      trades: {
        select: {
          netPnl: true,
          rMultiple: true,
          openedAt: true,
          closedAt: true,
          holdingMinutes: true,
          status: true,
        },
      },
      balanceEvents: { select: { kind: true, amount: true, occurredAt: true } },
    },
  });
  if (!account) return null;

  const rows = account.trades.map(toTradeRow);
  const events = toBalanceEvents(account.balanceEvents);
  const curve = equityCurve(rows, toDecOr(account.startingBalance, 0), events);

  return {
    currency: account.currency,
    startingBalance: toPlain(account.startingBalance)!,
    curve: curve.map((p) => ({
      at: p.at.toISOString(),
      balance: toNum(p.balance) ?? 0,
      change: toNum(p.change) ?? 0,
      kind: p.kind,
    })),
    maxDrawdown: (() => {
      const dd = maxDrawdown(curve);
      if (!dd) return null;
      return {
        amount: toPlain(dd.amount),
        pct: toNum(dd.pct),
        peakAt: dd.peakAt.toISOString(),
        troughAt: dd.troughAt.toISOString(),
        recoveredAt: dd.recoveredAt ? dd.recoveredAt.toISOString() : null,
        lengthDays: dd.lengthDays,
      };
    })(),
  };
}

/**
 * Reduce a series to at most `max` points by even sampling, always keeping the
 * first and last. A sparkline with 400 points is a smudge; one with 24 has the
 * same shape and a tenth of the DOM.
 */
export function thin(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const step = (values.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * step)]);
}

/** Money-in/out for the accounts page. */
export function cashFlow(events: { kind: string; amount: Decimal }[]) {
  return events.reduce(
    (acc, e) => {
      if (e.kind === "DEPOSIT") acc.deposits = acc.deposits.plus(e.amount);
      else if (e.kind === "WITHDRAWAL") acc.withdrawals = acc.withdrawals.plus(e.amount);
      else acc.adjustments = acc.adjustments.plus(e.amount);
      return acc;
    },
    { deposits: new Decimal(0), withdrawals: new Decimal(0), adjustments: new Decimal(0) },
  );
}

export { toDec };
