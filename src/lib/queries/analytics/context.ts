import "server-only";
import { cache } from "react";

import type { Direction, TagKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { TradeRow } from "@/lib/metrics/types";

import { hasDefinedRisk, toTradeRow } from "@/lib/trade-service";
import { NotFoundError } from "@/lib/session";
import { type DateWindow } from "@/lib/range";

/**
 * The shared per-request load, and the row shape every report is built from.
 *
 * DO NOT WRAP `fetchAccountData` AGAIN, and do not copy it into another
 * module. React's `cache()` deduplicates per *binding*, not per call: the
 * five entry points share one database round trip only because they all
 * or a helpfully "local" copy in one of the report modules — silently turns
 * one query into five identical ones on every analytics render, with nothing
 * failing to show it.
 *
 * ES modules are singletons, so importing this from the report modules
 * preserves the behaviour the single file had.
 */

export function withinWindow(at: Date, window: DateWindow): boolean {
  if (window.from && at < window.from) return false;
  if (window.to && at > window.to) return false;
  return true;
}

export interface AnalyticsCtx {
  userId: string;
  accountId: string;
  from: Date | null;
  to: Date | null;
}

// ---------------------------------------------------------------------------

/** The full set of fields every view in this file needs from one trade. */
export type RawTrade = Awaited<ReturnType<typeof fetchAccountData>>["trades"][number];

export const fetchAccountData = cache(async (userId: string, accountId: string) => {
  const account = await prisma.tradingAccount.findFirst({
    where: { id: accountId, userId },
    select: {
      startingBalance: true,
      currency: true,
      dailyLossLimitPct: true,
      maxDrawdownPct: true,
      drawdownMode: true,
      profitTargetPct: true,
      minTradingDays: true,
    },
  });
  if (!account) throw new NotFoundError(`Trading account "${accountId}" was not found.`);

  const [user, trades, balanceEvents] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    prisma.trade.findMany({
      where: { accountId, account: { userId } },
      select: {
        id: true,
        symbol: true,
        direction: true,
        status: true,
        openedAt: true,
        closedAt: true,
        entryMode: true,
        entryPrice: true,
        plannedRR: true,
        plannedRisk: true,
        stopLoss: true,
        takeProfit: true,
        volumeLots: true,
        netPnl: true,
        rMultiple: true,
        riskAmount: true,
        holdingMinutes: true,
        marketSession: true,
        followedPlan: true,
        emotion: true,
        instrument: { select: { digits: true } },
        initialStopLoss: true,
        maePrice: true,
        mfePrice: true,
        tradeTags: { select: { tag: { select: { id: true, name: true, kind: true } } } },
      },
      orderBy: { openedAt: "asc" },
    }),
    prisma.balanceEvent.findMany({
      where: { accountId },
      select: { kind: true, amount: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
  ]);

  return { account, timezone: user?.timezone ?? "UTC", trades, balanceEvents };
});

/** One trade plus the extra metadata the breakdown/heatmap/holding-bucket views group by, layered on top of the plain `TradeRow` the metrics module consumes. */
export type EnrichedRow = TradeRow & {
  id: string;
  symbol: string;
  direction: Direction;
  marketSession: string | null;
  followedPlan: boolean | null;
  emotion: number | null;
  hasStopLoss: boolean;
  setupTags: { id: string; name: string }[];
};

export function enrich(trade: RawTrade): EnrichedRow {
  return {
    ...toTradeRow(trade),
    id: trade.id,
    symbol: trade.symbol,
    direction: trade.direction,
    marketSession: trade.marketSession,
    followedPlan: trade.followedPlan,
    emotion: trade.emotion,
    hasStopLoss: hasDefinedRisk(trade),
    setupTags: trade.tradeTags
      .map((tt) => tt.tag)
      .filter((tag): tag is { id: string; name: string; kind: TagKind } => tag.kind === "SETUP"),
  };
}
