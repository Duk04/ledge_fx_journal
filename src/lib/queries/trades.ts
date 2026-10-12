import "server-only";
import { Decimal } from "decimal.js";
import { excursionInR } from "@/lib/metrics/excursion";
import type { AttachmentKind, Direction, MarketSession, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeTrade, summarize, BREAKEVEN_EPSILON_STR } from "@/lib/metrics";
import type { Summary } from "@/lib/metrics/types";
import { toNum, toPlain } from "@/lib/decimal-bridge";
import { instrumentSpec, toTradeRow, tradeInput } from "@/lib/trade-service";

/**
 * Trade reads. Every function here takes (or derives) a userId and folds it
 * into the Prisma `where` as an `account: { userId }` join — never just an
 * `accountId` on its own — so a caller that skipped `requireAccountAccess`
 * upstream still can't read another user's trades through this layer. See
 * the scoping rule in src/lib/session.ts.
 */

// ---------------------------------------------------------------------------
// Filters / sort
// ---------------------------------------------------------------------------

export type TradeOutcomeFilter = "WIN" | "LOSS" | "BREAKEVEN" | "OPEN";

export interface TradeFilters {
  /** Matched against symbol and notes, case-insensitive. */
  q?: string;
  symbols?: string[];
  directions?: Direction[];
  outcomes?: TradeOutcomeFilter[];
  tagIds?: string[];
  sessions?: MarketSession[];
  from?: Date;
  to?: Date;
  minR?: number;
  maxR?: number;
  /** Tri-state: undefined = don't filter on it. */
  followedPlan?: boolean;
}

export const TRADE_SORT_FIELDS = [
  "openedAt",
  "closedAt",
  "netPnl",
  "rMultiple",
  "pips",
  "symbol",
  "volumeLots",
] as const;
export type TradeSortField = (typeof TRADE_SORT_FIELDS)[number];

export interface TradeSort {
  field: TradeSortField;
  direction: "asc" | "desc";
}

function outcomeClause(outcome: TradeOutcomeFilter): Prisma.TradeWhereInput {
  switch (outcome) {
    case "OPEN":
      return { status: "OPEN" };
    case "WIN":
      return { status: "CLOSED", netPnl: { gte: BREAKEVEN_EPSILON_STR } };
    case "LOSS":
      return { status: "CLOSED", netPnl: { lte: `-${BREAKEVEN_EPSILON_STR}` } };
    case "BREAKEVEN":
      return { status: "CLOSED", netPnl: { gt: `-${BREAKEVEN_EPSILON_STR}`, lt: BREAKEVEN_EPSILON_STR } };
  }
}

/**
 * Builds the shared `where` for both the page query and the stats query, so
 * "what I'm looking at" and "the numbers below it" can never drift apart.
 * Every branch is pushed onto one `AND` array rather than assigned to
 * `where.OR` directly, because both the text search and the outcome filter
 * each need their own OR-of-conditions and a bare object can only hold one
 * `OR` key.
 */
function buildWhere(userId: string, accountId: string, filters: TradeFilters): Prisma.TradeWhereInput {
  const and: Prisma.TradeWhereInput[] = [{ accountId, account: { userId } }];

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    and.push({
      OR: [{ symbol: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } }],
    });
  }
  if (filters.symbols?.length) and.push({ symbol: { in: filters.symbols } });
  if (filters.directions?.length) and.push({ direction: { in: filters.directions } });
  if (filters.sessions?.length) and.push({ marketSession: { in: filters.sessions } });
  if (filters.tagIds?.length) and.push({ tradeTags: { some: { tagId: { in: filters.tagIds } } } });
  if (filters.followedPlan !== undefined) and.push({ followedPlan: filters.followedPlan });
  if (filters.from) and.push({ openedAt: { gte: filters.from } });
  if (filters.to) and.push({ openedAt: { lte: filters.to } });
  if (filters.minR !== undefined) and.push({ rMultiple: { gte: filters.minR } });
  if (filters.maxR !== undefined) and.push({ rMultiple: { lte: filters.maxR } });
  if (filters.outcomes?.length) and.push({ OR: filters.outcomes.map(outcomeClause) });

  return { AND: and };
}

/** Rounds the observed max |R| up to one of a fixed set of "nice" scales so
 * every RBar on the page (and across pages, since it's computed over the
 * whole filtered set, not just the current one) shares the same axis. */
function roundRScale(maxAbsR: number): number {
  const steps = [1, 2, 3, 5, 10];
  for (const step of steps) if (maxAbsR <= step) return step;
  return Math.ceil(maxAbsR / 10) * 10;
}

// ---------------------------------------------------------------------------
// listTrades
// ---------------------------------------------------------------------------

export interface TradeListRow {
  id: string;
  symbol: string;
  digits: number;
  direction: Direction;
  status: string;
  openedAt: string;
  closedAt: string | null;
  entryPrice: string;
  exitPrice: string | null;
  stopLoss: string | null;
  volumeLots: string;
  netPnl: string | null;
  pips: string | null;
  rMultiple: string | null;
  holdingMinutes: number | null;
  marketSession: MarketSession | null;
  followedPlan: boolean | null;
  emotion: number | null;
  tags: { id: string; name: string; color: string }[];
  attachmentCount: number;
  notesPreview: string | null;
}

export interface ListTradesResult {
  rows: TradeListRow[];
  total: number;
  /** The |R| that should fill half of every RBar in this result set. */
  scale: number;
}

const LIST_INCLUDE = {
  instrument: { select: { digits: true } },
  tradeTags: { include: { tag: { select: { id: true, name: true, color: true } } } },
  _count: { select: { attachments: true } },
} satisfies Prisma.TradeInclude;

type ListTradeRow = Prisma.TradeGetPayload<{ include: typeof LIST_INCLUDE }>;

function serializeListRow(trade: ListTradeRow): TradeListRow {
  return {
    id: trade.id,
    symbol: trade.symbol,
    digits: trade.instrument.digits,
    direction: trade.direction,
    status: trade.status,
    openedAt: trade.openedAt.toISOString(),
    closedAt: trade.closedAt?.toISOString() ?? null,
    entryPrice: toPlain(trade.entryPrice)!,
    exitPrice: toPlain(trade.exitPrice),
    stopLoss: toPlain(trade.stopLoss),
    volumeLots: toPlain(trade.volumeLots)!,
    netPnl: toPlain(trade.netPnl),
    pips: toPlain(trade.pips),
    rMultiple: toPlain(trade.rMultiple),
    holdingMinutes: trade.holdingMinutes,
    marketSession: trade.marketSession,
    followedPlan: trade.followedPlan,
    emotion: trade.emotion,
    tags: trade.tradeTags.map((tt) => tt.tag),
    attachmentCount: trade._count.attachments,
    notesPreview: trade.notes ? trade.notes.slice(0, 140) : null,
  };
}

export async function listTrades(params: {
  userId: string;
  accountId: string;
  filters?: TradeFilters;
  sort?: TradeSort;
  page?: number;
  pageSize?: number;
}): Promise<ListTradesResult> {
  const filters = params.filters ?? {};
  const sort = params.sort ?? { field: "openedAt", direction: "desc" };
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? 50;

  const where = buildWhere(params.userId, params.accountId, filters);

  const [trades, total, rAgg] = await Promise.all([
    prisma.trade.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { [sort.field]: sort.direction },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.trade.count({ where }),
    prisma.trade.aggregate({ where, _max: { rMultiple: true }, _min: { rMultiple: true } }),
  ]);

  const maxAbsR = Math.max(Math.abs(toNum(rAgg._max.rMultiple) ?? 0), Math.abs(toNum(rAgg._min.rMultiple) ?? 0));

  return {
    rows: trades.map(serializeListRow),
    total,
    scale: roundRScale(maxAbsR),
  };
}

// ---------------------------------------------------------------------------
// getTrade
// ---------------------------------------------------------------------------

const DETAIL_INCLUDE = {
  instrument: true,
  account: { select: { currency: true } },
  tradeTags: { include: { tag: { select: { id: true, name: true, color: true } } } },
  attachments: { orderBy: { createdAt: "asc" } },
  executions: { orderBy: [{ executedAt: "asc" }, { createdAt: "asc" }] },
  playbook: { include: { rules: { orderBy: { sortOrder: "asc" } } } },
  ruleChecks: { select: { ruleId: true, followed: true } },
} satisfies Prisma.TradeInclude;

export interface TradeExecution {
  id: string;
  kind: "ENTRY" | "EXIT";
  executedAt: string;
  price: string;
  volumeLots: string;
}

export interface TradeDetail {
  id: string;
  accountId: string;
  currency: string;
  /** Where the stop was at entry — what risk and R are measured from. */
  initialStopLoss: string | null;
  maePrice: string | null;
  mfePrice: string | null;
  /** MAE/MFE in R against the initial stop; null without a stop or prices. */
  maeR: number | null;
  mfeR: number | null;
  executions: TradeExecution[];
  playbook: { id: string; name: string; rules: { id: string; text: string; followed: boolean | null }[] } | null;
  /** Lots still open: total entered minus total exited. */
  openLots: string;
  /** More than one entry or exit — the edit form can't change prices then. */
  multiFill: boolean;
  symbol: string;
  displayName: string;
  digits: number;
  assetClass: string;
  direction: Direction;
  status: string;
  openedAt: string;
  closedAt: string | null;
  entryPrice: string;
  exitPrice: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  volumeLots: string;
  commission: string;
  swap: string;
  conversionRate: string | null;
  netPnl: string | null;
  grossPnl: string | null;
  pips: string | null;
  rMultiple: string | null;
  riskAmount: string | null;
  holdingMinutes: number | null;
  marketSession: MarketSession | null;
  followedPlan: boolean | null;
  emotion: number | null;
  confidence: number | null;
  notes: string | null;
  externalTicket: string | null;
  tags: { id: string; name: string; color: string }[];
  attachments: {
    id: string;
    kind: AttachmentKind;
    externalUrl: string | null;
    storageKey: string | null;
    caption: string | null;
    mimeType: string | null;
  }[];
  /** A fresh recompute from the raw fields, plus planned R:R (never stored). */
  recomputed: {
    netPnl: string | null;
    pips: string | null;
    rMultiple: string | null;
    riskAmount: string | null;
    plannedRR: string | null;
  };
  /** True when any of the stored derived columns disagree with the recompute
   * above by more than a cent/0.01R — see docs/TRADES.md. */
  hasDisagreement: boolean;
}

/** Absolute-difference tolerance below which two decimal strings are
 * considered "the same number" for disagreement-detection purposes — enough
 * to absorb rounding at the last stored digit without enough slack to hide a
 * real formula drift. */
function differs(stored: string | null, fresh: string | null, tolerance: number): boolean {
  const a = stored === null ? null : Number(stored);
  const b = fresh === null ? null : Number(fresh);
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return Math.abs(a - b) > tolerance;
}

export async function getTrade(userId: string, id: string): Promise<TradeDetail | null> {
  const trade = await prisma.trade.findFirst({
    where: { id, account: { userId } },
    include: DETAIL_INCLUDE,
  });
  if (!trade) return null;

  const spec = instrumentSpec(trade.instrument);
  // Recompute against the account's currency so the fresh numbers use the same
  // quote conversion the stored ones did — otherwise every JPY trade would
  // report a false disagreement.
  const input = tradeInput(trade, trade.instrument, trade.account.currency);
  const fresh = computeTrade(input);

  const netPnl = toPlain(trade.netPnl);
  const pips = toPlain(trade.pips);
  const rMultiple = toPlain(trade.rMultiple);
  const freshNetPnl = toPlain(fresh.netPnl);
  const freshPips = toPlain(fresh.pips);
  const freshRMultiple = toPlain(fresh.rMultiple);

  const hasDisagreement =
    differs(netPnl, freshNetPnl, 0.01) || differs(pips, freshPips, 0.01) || differs(rMultiple, freshRMultiple, 0.01);

  return {
    id: trade.id,
    accountId: trade.accountId,
    currency: trade.account.currency,
    initialStopLoss: toPlain(trade.initialStopLoss),
    maePrice: toPlain(trade.maePrice),
    mfePrice: toPlain(trade.mfePrice),
    ...(() => {
      const { maeR, mfeR } = excursionInR({
        direction: trade.direction,
        entryPrice: trade.entryPrice.toString(),
        riskStop: (trade.initialStopLoss ?? trade.stopLoss)?.toString() ?? null,
        maePrice: trade.maePrice?.toString() ?? null,
        mfePrice: trade.mfePrice?.toString() ?? null,
      });
      return { maeR: maeR?.toNumber() ?? null, mfeR: mfeR?.toNumber() ?? null };
    })(),
    playbook: trade.playbook
      ? {
          id: trade.playbook.id,
          name: trade.playbook.name,
          rules: trade.playbook.rules.map((r) => ({
            id: r.id,
            text: r.text,
            followed: trade.ruleChecks.find((c) => c.ruleId === r.id)?.followed ?? null,
          })),
        }
      : null,
    executions: trade.executions.map((e) => ({
      id: e.id,
      kind: e.kind,
      executedAt: e.executedAt.toISOString(),
      price: toPlain(e.price)!,
      volumeLots: toPlain(e.volumeLots)!,
    })),
    openLots: trade.executions
      .reduce((acc, e) => (e.kind === "ENTRY" ? acc.plus(e.volumeLots) : acc.minus(e.volumeLots)), new Decimal(0))
      .toString(),
    multiFill:
      trade.executions.filter((e) => e.kind === "ENTRY").length > 1 ||
      trade.executions.filter((e) => e.kind === "EXIT").length > 1,
    symbol: trade.symbol,
    displayName: trade.instrument.displayName,
    digits: spec.digits,
    assetClass: trade.instrument.assetClass,
    direction: trade.direction,
    status: trade.status,
    openedAt: trade.openedAt.toISOString(),
    closedAt: trade.closedAt?.toISOString() ?? null,
    entryPrice: toPlain(trade.entryPrice)!,
    exitPrice: toPlain(trade.exitPrice),
    stopLoss: toPlain(trade.stopLoss),
    takeProfit: toPlain(trade.takeProfit),
    volumeLots: toPlain(trade.volumeLots)!,
    commission: toPlain(trade.commission)!,
    swap: toPlain(trade.swap)!,
    conversionRate: toPlain(trade.conversionRate),
    netPnl,
    grossPnl: toPlain(trade.grossPnl),
    pips,
    rMultiple,
    riskAmount: toPlain(trade.riskAmount),
    holdingMinutes: trade.holdingMinutes,
    marketSession: trade.marketSession,
    followedPlan: trade.followedPlan,
    emotion: trade.emotion,
    confidence: trade.confidence,
    notes: trade.notes,
    externalTicket: trade.externalTicket,
    tags: trade.tradeTags.map((tt) => tt.tag),
    attachments: trade.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      externalUrl: a.externalUrl,
      storageKey: a.storageKey,
      caption: a.caption,
      mimeType: a.mimeType,
    })),
    recomputed: {
      netPnl: freshNetPnl,
      pips: freshPips,
      rMultiple: freshRMultiple,
      riskAmount: toPlain(fresh.riskAmount),
      plannedRR: toPlain(fresh.plannedRR),
    },
    hasDisagreement,
  };
}

// ---------------------------------------------------------------------------
// Lookups for the filter bar and the form
// ---------------------------------------------------------------------------

/** Every symbol the user has ever traded, across all their accounts. */
export async function listSymbols(userId: string): Promise<string[]> {
  const rows = await prisma.trade.findMany({
    where: { account: { userId } },
    select: { symbol: true },
    distinct: ["symbol"],
    orderBy: { symbol: "asc" },
  });
  return rows.map((r) => r.symbol);
}

export interface TagOption {
  id: string;
  name: string;
  kind: string;
  color: string;
}

export async function listTagsForUser(userId: string): Promise<TagOption[]> {
  const tags = await prisma.tag.findMany({
    where: { userId },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, color: true },
  });
  return tags;
}

export interface InstrumentOption {
  symbol: string;
  displayName: string;
  pipSize: string;
  contractSize: string;
  digits: number;
  quoteCurrency: string;
  assetClass: string;
}

export async function listInstruments(): Promise<InstrumentOption[]> {
  const instruments = await prisma.instrument.findMany({
    where: { isActive: true },
    orderBy: { symbol: "asc" },
  });
  return instruments.map((i) => ({
    symbol: i.symbol,
    displayName: i.displayName,
    pipSize: toPlain(i.pipSize)!,
    contractSize: toPlain(i.contractSize)!,
    digits: i.digits,
    quoteCurrency: i.quoteCurrency,
    assetClass: i.assetClass,
  }));
}

// ---------------------------------------------------------------------------
// tradeStats — summarize() over the FILTERED set, not the page
// ---------------------------------------------------------------------------

/** Summary, with every Decimal field turned into a plain string (see
 * decimal-bridge.ts's doc on why: a class instance can't cross the RSC
 * boundary). Plain numbers/nulls (winRate, streak counts, …) pass through. */
export interface SerializedSummary {
  tradeCount: number;
  closedCount: number;
  openCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  grossProfit: string;
  grossLoss: string;
  netPnl: string;
  profitFactor: string | null;
  averageWin: string | null;
  averageLoss: string | null;
  averageRMultiple: string | null;
  expectancyMoney: string | null;
  expectancyR: string | null;
  largestWin: string | null;
  largestLoss: string | null;
  payoffRatio: string | null;
  standardDeviationR: string | null;
  systemQuality: string | null;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: number;
  averageHoldingMinutes: number | null;
  breakevenWinRate: number | null;
}

function serializeSummary(s: Summary): SerializedSummary {
  return {
    tradeCount: s.tradeCount,
    closedCount: s.closedCount,
    openCount: s.openCount,
    wins: s.wins,
    losses: s.losses,
    breakevens: s.breakevens,
    winRate: s.winRate,
    grossProfit: toPlain(s.grossProfit)!,
    grossLoss: toPlain(s.grossLoss)!,
    netPnl: toPlain(s.netPnl)!,
    profitFactor: toPlain(s.profitFactor),
    averageWin: toPlain(s.averageWin),
    averageLoss: toPlain(s.averageLoss),
    averageRMultiple: toPlain(s.averageRMultiple),
    expectancyMoney: toPlain(s.expectancyMoney),
    expectancyR: toPlain(s.expectancyR),
    largestWin: toPlain(s.largestWin),
    largestLoss: toPlain(s.largestLoss),
    payoffRatio: toPlain(s.payoffRatio),
    standardDeviationR: toPlain(s.standardDeviationR),
    systemQuality: toPlain(s.systemQuality),
    longestWinStreak: s.longestWinStreak,
    longestLossStreak: s.longestLossStreak,
    currentStreak: s.currentStreak,
    averageHoldingMinutes: s.averageHoldingMinutes,
    breakevenWinRate: s.breakevenWinRate,
  };
}

/**
 * Rolled-up stats over the CURRENTLY FILTERED set of trades (not just the
 * visible page) — this is deliberate: the number a reviewer wants from the
 * stat row is "what do the trades I'm looking at say", which for a filtered
 * view of 8 trades is a different (and more useful) answer than the
 * account's all-time numbers.
 */
export async function tradeStats(
  userId: string,
  accountId: string,
  filters: TradeFilters = {},
): Promise<SerializedSummary> {
  const where = buildWhere(userId, accountId, filters);
  const trades = await prisma.trade.findMany({
    where,
    select: { netPnl: true, rMultiple: true, openedAt: true, closedAt: true, holdingMinutes: true, status: true },
  });
  const rows = trades.map(toTradeRow);
  return serializeSummary(summarize(rows));
}
