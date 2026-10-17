/**
 * Reads that power the Overview dashboard and the Analytics reports.
 *
 * Every entry point takes `{ userId, accountId, from, to }` and returns plain,
 * serialisable DTOs — no Decimal instances and no Prisma rows cross to a
 * client component.
 *
 * This was one 711-line file. It is split by report, with the shared parts
 * factored out:
 *
 *   context.ts        The per-request account load and the row enrichment.
 *                     Holds the ONE `cache()` binding all five reports share
 *                     — read the warning there before touching it.
 *   serialize.ts      Summary and breakdown DTOs.
 *   labels.ts         Display labels for the enum-ish grouping keys.
 *   overview.ts       The dashboard.
 *   breakdowns.ts     Grouped performance, and holding-time buckets.
 *   distributions.ts  R histogram and the session/weekday heatmap.
 *
 * The barrel keeps the module's public surface exactly as it was, so the
 * fourteen files importing from `@/lib/queries/analytics` are untouched —
 * including the range re-exports below, which several pages take from here
 * rather than from `@/lib/range`.
 */
export { RANGE_OPTIONS, isRangeKey, resolveRange } from "@/lib/range";
export type { RangeKey, DateWindow } from "@/lib/range";

export type { AnalyticsCtx } from "./context";
export type { BreakdownRow, SerializedSummary } from "./serialize";

export { overview } from "./overview";
export type {
  DrawdownPointDTO,
  EquityPointDTO,
  MaxDrawdownDTO,
  OpenTrade,
  OverviewData,
  PropDTO,
  RecentTrade,
} from "./overview";

export { breakdowns, holdingBuckets } from "./breakdowns";
export type { Breakdowns } from "./breakdowns";

export { heatmap, rHistogram } from "./distributions";
export type { HeatmapCell, RHistogramBucket, RHistogramResult, TradeExtreme } from "./distributions";

export { periods } from "./periods";
export type { ExcursionStats, MonthCell, PeriodComparison, PeriodsData, YearRow } from "./periods";

export { journalStats } from "./journal-stats";
export type { JournalStats, JournalTradeCard } from "./journal-stats";

export { simulationInputs } from "./simulation";
export type { SimulationInputs } from "./simulation";
