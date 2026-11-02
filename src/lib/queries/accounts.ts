import "server-only";
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/db";
import { equityCurve, maxDrawdown } from "@/lib/metrics";
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
 * The metrics layer wants signed amounts (a withdrawal reduces the balance).
 * `addBalanceEvent` stores them signed already, but a row written any other
 * way — an older export restored, a hand-edited one — may hold a WITHDRAWAL
 * as a positive magnitude. So the sign comes from `kind`, here, and every
 * reader that feeds `equityCurve()` goes through this: the equity curve can
 * never be off by twice a withdrawal. (This comment used to say the database
 * stores a positive magnitude; it has stored the signed amount for a while.)
 */
export function toBalanceEvents(
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

/**
 * Every account with its headline numbers — without loading its trades.
 *
 * This feeds the app layout (the account switcher, on every full render and
 * every revalidation) and the accounts page. It used to include every trade
 * of every account, archived and BACKTEST included, just to sum P&L and draw
 * a 24-point sparkline; a strategy run writes up to 10,000 trades, so a few
 * runs meant six-figure row counts per page load. Now the database counts
 * and sums, and only ~24 points of each curve come back.
 *
 * The numbers are still the metrics layer's, not a second copy of its rules:
 *  - `netPnl`, `tradeCount`, `openCount` are `summarize()`'s — closed means
 *    status CLOSED with a net P&L; everything else is open.
 *  - `equity` and `spark` are `equityCurve()`'s: start + net P&L of trades
 *    with a close time, in close order, + signed balance events.
 * `accounts.db.test.ts` holds both against the in-memory functions.
 */
export async function listAccounts(
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<AccountSummary[]> {
  const includeArchived = opts.includeArchived ?? true;
  const accountWhere: Prisma.TradingAccountWhereInput = { userId, ...(includeArchived ? {} : { isArchived: false }) };

  const [accounts, all, closed, samples] = await Promise.all([
    prisma.tradingAccount.findMany({
      where: accountWhere,
      orderBy: [{ isArchived: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        label: true,
        broker: true,
        platform: true,
        accountType: true,
        currency: true,
        isArchived: true,
        startingBalance: true,
        balanceEvents: { select: { kind: true, amount: true, occurredAt: true } },
      },
    }),
    prisma.trade.groupBy({ by: ["accountId"], where: { account: accountWhere }, _count: { _all: true } }),
    prisma.trade.groupBy({
      by: ["accountId"],
      where: { account: accountWhere, status: "CLOSED", netPnl: { not: null } },
      _sum: { netPnl: true },
      _count: { _all: true },
    }),
    sampledRealisedCurves(userId, includeArchived),
  ]);

  const totalBy = new Map(all.map((g) => [g.accountId, g._count._all]));
  const closedBy = new Map(closed.map((g) => [g.accountId, g]));

  return accounts.map((account) => {
    const start = toDecOr(account.startingBalance, 0);
    const events = toBalanceEvents(account.balanceEvents);
    const curve = samples.get(account.id) ?? [];
    const realised = curve.length ? curve[curve.length - 1].cum : new Decimal(0);
    const cash = events.reduce((acc, e) => acc.plus(e.amount), new Decimal(0));
    const tradeCount = totalBy.get(account.id) ?? 0;
    const closedRow = closedBy.get(account.id);

    return {
      id: account.id,
      label: account.label,
      broker: account.broker,
      platform: account.platform,
      accountType: account.accountType,
      currency: account.currency,
      isArchived: account.isArchived,
      startingBalance: toPlain(start)!,
      equity: toPlain(start.plus(realised).plus(cash))!,
      netPnl: toPlain(toDecOr(closedRow?._sum.netPnl ?? null, 0))!,
      tradeCount,
      openCount: tradeCount - (closedRow?._count._all ?? 0),
      spark: thin(sparkPoints(start, curve, events), 24),
    };
  });
}

/**
 * Each account's running realised P&L, sampled: about 24 evenly spaced
 * closed trades per account, always including the first (where the curve
 * starts) and the last (whose running total is the account's whole realised
 * P&L). The running sum is taken over every
 * row in SQL; only the sample travels.
 *
 * The filter and the order are `equityCurve()`'s — a close time and a net
 * P&L, ascending by close — with the id as a tiebreaker so equal close
 * times sum in a stable order.
 */
async function sampledRealisedCurves(
  userId: string,
  includeArchived: boolean,
): Promise<Map<string, { at: Date; cum: Decimal }[]>> {
  const rows = await prisma.$queryRaw<{ accountId: string; at: Date; cum: string }[]>`
    SELECT s.account_id AS "accountId", s.closed_at AS "at", s.cum::text AS "cum"
    FROM (
      SELECT t.account_id, t.closed_at,
             sum(t.net_pnl) OVER w AS cum,
             row_number() OVER w AS n,
             count(*) OVER (PARTITION BY t.account_id) AS total
      FROM trades t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.user_id = ${userId}
        AND (${includeArchived} OR a.is_archived = false)
        AND t.closed_at IS NOT NULL
        AND t.net_pnl IS NOT NULL
      WINDOW w AS (PARTITION BY t.account_id ORDER BY t.closed_at, t.id ROWS UNBOUNDED PRECEDING)
    ) s
    WHERE s.total <= ${SPARK_POINTS} OR s.n = 1 OR s.n = s.total OR s.n % ceil(s.total / ${SPARK_POINTS}::numeric)::int = 0
    ORDER BY s.account_id, s.n`;

  const out = new Map<string, { at: Date; cum: Decimal }[]>();
  for (const r of rows) {
    const list = out.get(r.accountId) ?? [];
    list.push({ at: r.at, cum: new Decimal(r.cum) });
    out.set(r.accountId, list);
  }
  return out;
}

const SPARK_POINTS = 24;

/** The sampled realised curve with the balance events woven in, as balances
 * — the same walk `equityCurve()` takes, over the sample. */
function sparkPoints(start: Decimal, curve: { at: Date; cum: Decimal }[], events: BalanceEvent[]): number[] {
  type Entry = { at: Date; cum?: Decimal; cash?: Decimal };
  const entries: Entry[] = [
    ...curve.map((p) => ({ at: p.at, cum: p.cum })),
    ...events.map((e) => ({ at: e.at, cash: new Decimal(e.amount) })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  let realised = new Decimal(0);
  let cash = new Decimal(0);
  return entries.map((e) => {
    if (e.cum) realised = e.cum;
    if (e.cash) cash = cash.plus(e.cash);
    return toNum(start.plus(realised).plus(cash)) ?? 0;
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

/**
 * A trading account's currency, by id.
 *
 * Two journal pages each ran this exact two-line query inline against Prisma.
 * Small, but it is the shape that accumulates: a page reaching past the query
 * layer for "just one field" is how six of them ended up doing it.
 *
 * Deliberately NOT user-scoped: the caller has already resolved this id
 * through `resolveActiveAccountId`, which validates ownership. Taking a
 * userId here would imply a check this does not make.
 */
export async function getAccountCurrency(accountId: string): Promise<string | null> {
  const row = await prisma.tradingAccount.findUnique({
    where: { id: accountId },
    select: { currency: true },
  });
  return row?.currency ?? null;
}

/**
 * Today's trades on one account, for the risk guard.
 *
 * `dayStart`/`dayEnd` are computed by the caller, because "today" depends on
 * the user's timezone and this module has no business knowing it. Scoped by
 * `account: { userId }` rather than by `accountId` alone, per the scoping rule
 * in lib/session.ts — even though the caller has already validated the
 * account, so that this query is correct read on its own.
 */
export async function listTradesOpenedBetween(params: { userId: string; accountId: string; from: Date; to: Date }) {
  return prisma.trade.findMany({
    where: {
      accountId: params.accountId,
      account: { userId: params.userId },
      openedAt: { gte: params.from, lt: params.to },
    },
    orderBy: { openedAt: "asc" },
    select: { id: true, netPnl: true, riskAmount: true, stopLoss: true, entryMode: true },
  });
}

/** Every balance event on the user's accounts, newest first — no `include`,
 * for callers that already have the account list and only need to bucket by
 * `accountId`. */
export async function listBalanceEventsFlat(userId: string) {
  return prisma.balanceEvent.findMany({
    where: { account: { userId } },
    orderBy: { occurredAt: "desc" },
  });
}

/** Per-account risk settings — risk per trade and the challenge rules — for
 * a page that renders them all. */
export async function listAccountRiskSettings(userId: string) {
  return prisma.tradingAccount.findMany({
    where: { userId },
    select: {
      id: true,
      riskPerTradePct: true,
      dailyLossLimitPct: true,
      maxDrawdownPct: true,
      drawdownMode: true,
      profitTargetPct: true,
      minTradingDays: true,
    },
  });
}
