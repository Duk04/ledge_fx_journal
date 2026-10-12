import "server-only";
import { TZDate } from "@date-fns/tz";
import { Decimal } from "decimal.js";
import { groupBy, summarize } from "@/lib/metrics";
import { excursionInR } from "@/lib/metrics/excursion";
import { toTradeRow } from "@/lib/trade-service";
import { type AnalyticsCtx, fetchAccountData, withinWindow } from "./context";
import { type BreakdownRow, type SerializedSummary, serializeSummary, toBreakdownRow } from "./serialize";

/**
 * Time-period reports: the month-by-month grid, this range against the one
 * before it, and MAE/MFE (exit efficiency).
 *
 * Months are bucketed by CLOSE time in the user's timezone — a month's P&L is
 * what was realised in it, the same convention as the dashboard's daily P&L —
 * whereas the comparison uses OPEN time like every other range-scoped report
 * (Breakdowns), so its numbers match those tabs for the same range.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MonthCell extends BreakdownRow {
  month: number; // 0-11
}

export interface YearRow {
  year: number;
  months: (MonthCell | null)[];
  total: BreakdownRow;
}

export interface PeriodComparison {
  current: SerializedSummary;
  /** The window of equal length ending where the current one starts; null
   * for "All", which has nothing before it. */
  previous: SerializedSummary | null;
  previousFrom: string | null;
  previousTo: string | null;
}

export interface ExcursionStats {
  /** Closed trades in range with a stop and both excursion prices. */
  sample: number;
  /** Mean MAE of WINNING trades, in R (≤ 0): how much heat winners took. */
  winnersAvgMaeR: number | null;
  /** Deepest MAE among winners, in R. */
  winnersWorstMaeR: number | null;
  /** Mean MFE across the sample, in R: how far trades ran in your favour. */
  avgMfeR: number | null;
  /** Mean realised R across the same sample. */
  avgRealisedR: number | null;
  /** Of the favourable move winners offered, the share they kept (0-1). */
  winnersCapture: number | null;
}

export interface PeriodsData {
  years: YearRow[];
  comparison: PeriodComparison;
  excursion: ExcursionStats;
}

const mean = (xs: Decimal[]) => (xs.length ? xs.reduce((a, b) => a.plus(b), new Decimal(0)).div(xs.length) : null);
const num = (d: Decimal | null) => (d === null ? null : d.toDecimalPlaces(4).toNumber());

export async function periods(ctx: AnalyticsCtx): Promise<PeriodsData> {
  const { timezone, trades } = await fetchAccountData(ctx.userId, ctx.accountId);

  // --- Year × month, all time ------------------------------------------------
  const closed = trades.filter((t) => t.closedAt !== null);
  const byMonth = groupBy(
    closed.map((t) => ({ ...toTradeRow(t), closedAt: t.closedAt })),
    (r) => {
      const z = new TZDate(r.closedAt!, timezone);
      return z.getFullYear() * 100 + z.getMonth();
    },
  );
  const yearsSet = new Set([...byMonth.keys()].map((k) => Math.floor(k / 100)));
  const years: YearRow[] = [...yearsSet]
    .sort((a, b) => b - a)
    .map((year) => {
      const months = MONTHS.map((label, m) => {
        const s = byMonth.get(year * 100 + m);
        return s ? { ...toBreakdownRow(`${year}-${m + 1}`, `${label} ${year}`, s), month: m } : null;
      });
      const rows = closed.filter((t) => new TZDate(t.closedAt!, timezone).getFullYear() === year).map(toTradeRow);
      return { year, months, total: toBreakdownRow(String(year), String(year), summarize(rows)) };
    });

  // --- This range vs the one before it -----------------------------------------
  const current = trades.filter((t) => withinWindow(t.openedAt, { from: ctx.from, to: ctx.to })).map(toTradeRow);
  let previous: SerializedSummary | null = null;
  let previousFrom: Date | null = null;
  let previousTo: Date | null = null;
  if (ctx.from) {
    const end = ctx.to ?? new Date();
    const length = end.getTime() - ctx.from.getTime();
    previousTo = new Date(ctx.from.getTime() - 1);
    previousFrom = new Date(ctx.from.getTime() - length);
    previous = serializeSummary(
      summarize(trades.filter((t) => withinWindow(t.openedAt, { from: previousFrom, to: previousTo })).map(toTradeRow)),
    );
  }

  // --- MAE / MFE over the range ------------------------------------------------
  const sample = trades
    .filter((t) => withinWindow(t.openedAt, { from: ctx.from, to: ctx.to }))
    .filter((t) => t.status === "CLOSED" && t.maePrice !== null && t.mfePrice !== null && t.rMultiple !== null)
    .map((t) => {
      const { maeR, mfeR } = excursionInR({
        direction: t.direction,
        entryPrice: t.entryPrice.toString(),
        riskStop: (t.initialStopLoss ?? t.stopLoss)?.toString() ?? null,
        maePrice: t.maePrice!.toString(),
        mfePrice: t.mfePrice!.toString(),
      });
      return { maeR, mfeR, r: new Decimal(t.rMultiple!.toString()) };
    })
    .filter((x): x is { maeR: Decimal; mfeR: Decimal; r: Decimal } => x.maeR !== null && x.mfeR !== null);
  const winners = sample.filter((x) => x.r.gt(0));
  const winnersWithRoom = winners.filter((x) => x.mfeR.gt(0));

  return {
    years,
    comparison: {
      current: serializeSummary(summarize(current)),
      previous,
      previousFrom: previousFrom?.toISOString() ?? null,
      previousTo: previousTo?.toISOString() ?? null,
    },
    excursion: {
      sample: sample.length,
      winnersAvgMaeR: num(mean(winners.map((x) => x.maeR))),
      winnersWorstMaeR: winners.length ? num(Decimal.min(...winners.map((x) => x.maeR))) : null,
      avgMfeR: num(mean(sample.map((x) => x.mfeR))),
      avgRealisedR: num(mean(sample.map((x) => x.r))),
      winnersCapture: winnersWithRoom.length
        ? num(
            winnersWithRoom
              .reduce((a, x) => a.plus(x.r), new Decimal(0))
              .div(winnersWithRoom.reduce((a, x) => a.plus(x.mfeR), new Decimal(0))),
          )
        : null,
    },
  };
}
