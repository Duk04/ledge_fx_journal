import "server-only";
import { TZDate } from "@date-fns/tz";
import { summarize, groupBy, tradingWeekday } from "@/lib/metrics";
import type { Weekday } from "@/lib/metrics/session";
import { toTradeRow } from "@/lib/trade-service";
import { type DateWindow } from "@/lib/range";

import { type AnalyticsCtx, type EnrichedRow, enrich, fetchAccountData, withinWindow } from "./context";
import { type BreakdownRow, byNetPnlDesc, mapGroup, toBreakdownRow } from "./serialize";
import { HOLDING_BUCKETS, PLAN_LABELS, SESSION_LABELS, WEEKDAY_LABELS, WEEKDAY_ORDER } from "./labels";

/** Grouped performance: by symbol, session, weekday, plan adherence, tag and
 * holding time. Each returns `BreakdownRow[]`, sorted by net P&L. */

export interface Breakdowns {
  symbol: BreakdownRow[];
  marketSession: BreakdownRow[];
  tag: BreakdownRow[];
  weekday: BreakdownRow[];
  hourOfDay: BreakdownRow[];
  direction: BreakdownRow[];
  followedPlan: BreakdownRow[];
}

function tagBreakdown(rows: EnrichedRow[]): BreakdownRow[] {
  const groups = new Map<string, { label: string; rows: EnrichedRow[] }>();
  for (const row of rows) {
    for (const tag of row.setupTags) {
      const g = groups.get(tag.id);
      if (g) g.rows.push(row);
      else groups.set(tag.id, { label: tag.name, rows: [row] });
    }
  }
  return [...groups.entries()].map(([id, g]) => toBreakdownRow(id, g.label, summarize(g.rows))).sort(byNetPnlDesc);
}

export async function breakdowns(ctx: AnalyticsCtx): Promise<Breakdowns> {
  const { timezone, trades } = await fetchAccountData(ctx.userId, ctx.accountId);
  const window: DateWindow = { from: ctx.from, to: ctx.to };
  const rows = trades.filter((t) => withinWindow(t.openedAt, window)).map(enrich);

  const bySymbol = groupBy(rows, (r) => r.symbol);
  const bySession = groupBy(rows, (r) => r.marketSession ?? "UNKNOWN");
  const byDirection = groupBy(rows, (r) => r.direction);
  const byWeekday = groupBy(rows, (r) => tradingWeekday(r.openedAt, timezone));
  const byHour = groupBy(rows, (r) => new TZDate(r.openedAt, timezone).getHours());
  const byPlan = groupBy(rows, (r) => (r.followedPlan === true ? "yes" : r.followedPlan === false ? "no" : "unset"));

  return {
    symbol: mapGroup(bySymbol, (k) => k),
    marketSession: mapGroup(bySession, (k) => SESSION_LABELS[k] ?? k),
    tag: tagBreakdown(rows),
    weekday: mapGroup(
      byWeekday,
      (k) => WEEKDAY_LABELS[k] ?? k,
      (a, b) => WEEKDAY_ORDER.indexOf(a.key as Weekday) - WEEKDAY_ORDER.indexOf(b.key as Weekday),
    ),
    hourOfDay: mapGroup(
      byHour,
      (k) => `${String(k).padStart(2, "0")}:00`,
      (a, b) => Number(a.key) - Number(b.key),
    ),
    direction: mapGroup(byDirection, (k) => (k === "LONG" ? "Long" : "Short")),
    followedPlan: mapGroup(byPlan, (k) => PLAN_LABELS[k] ?? k),
  };
}

export async function holdingBuckets(ctx: AnalyticsCtx): Promise<BreakdownRow[]> {
  const { trades } = await fetchAccountData(ctx.userId, ctx.accountId);
  const window: DateWindow = { from: ctx.from, to: ctx.to };
  const rows = trades.filter((t) => withinWindow(t.openedAt, window) && t.holdingMinutes !== null).map(toTradeRow);

  let floor = 0;
  return HOLDING_BUCKETS.map((bucket) => {
    const inBucket = rows.filter((r) => {
      const m = r.holdingMinutes as number;
      return m >= floor && m < bucket.max;
    });
    floor = bucket.max;
    return toBreakdownRow(bucket.key, bucket.label, summarize(inBucket));
  });
}
