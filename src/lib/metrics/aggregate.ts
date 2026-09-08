/**
 * Aggregate statistics over many trades: summary stats, equity curve,
 * drawdown, grouping, R-multiple histogram and daily P&L. Pure functions,
 * fed with plain `TradeRow` objects (or a computed `TradeResult` — the
 * shapes are structurally compatible) — no database access here.
 */
import { Decimal } from 'decimal.js'
import { TZDate } from '@date-fns/tz'
import { d, ZERO } from './decimal'
import type {
  BalanceEvent,
  DailyPnl,
  DecimalInput,
  DrawdownPoint,
  EquityPoint,
  MaxDrawdown,
  RBucket,
  Summary,
  TradeRow,
} from './types'

function sum(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), ZERO)
}

function mean(values: Decimal[]): Decimal | null {
  if (values.length === 0) return null
  return sum(values).div(values.length)
}

/** Sample standard deviation (n-1 denominator). null with fewer than 2 values. */
function sampleStdev(values: Decimal[]): Decimal | null {
  if (values.length < 2) return null
  const avg = mean(values)!
  const sqDiffs = values.map((v) => v.minus(avg).pow(2))
  const variance = sum(sqDiffs).div(values.length - 1)
  return variance.sqrt()
}

/**
 * Rolls up performance statistics over `rows`.
 *
 * Judgement calls (see docs/METRICS.md for the full rationale):
 *  - winRate excludes breakevens from BOTH numerator and denominator:
 *    wins / (wins + losses). A scratch trade shouldn't dilute the win rate
 *    in either direction.
 *  - profitFactor is null (never Infinity) when grossLoss is 0 — a system
 *    with zero losses has an undefined, not infinite, profit factor.
 *  - averageRMultiple / standardDeviationR / systemQuality only consider
 *    rows with a non-null rMultiple (i.e. rows that had a stop loss). Rows
 *    without a stop loss still count toward winRate/wins/losses.
 *  - expectancyMoney and expectancyR are both built the same way: rate *
 *    average(win) - (1 - rate) * average(loss), so a trade population that
 *    excludes breakevens from the rate still gets a sensible, non-zero
 *    expectancy even when breakevens are present. expectancyR is additionally
 *    null when no row had a stop loss at all: there is no R to average, and
 *    printing 0.00R would assert something the data cannot support.
 *  - Win/loss streaks skip breakevens entirely: a breakeven neither extends
 *    nor breaks a run of wins or losses (documented + tested).
 */
export function summarize(rows: TradeRow[]): Summary {
  const closed = rows.filter((r) => r.outcome !== 'OPEN')
  const openCount = rows.length - closed.length

  const winRows = closed.filter((r) => r.outcome === 'WIN')
  const lossRows = closed.filter((r) => r.outcome === 'LOSS')
  const breakevenRows = closed.filter((r) => r.outcome === 'BREAKEVEN')

  const wins = winRows.length
  const losses = lossRows.length
  const breakevens = breakevenRows.length

  const winRate = wins + losses > 0 ? wins / (wins + losses) : null

  const winPnls = winRows.map((r) => r.netPnl ?? ZERO)
  const lossPnlsAbs = lossRows.map((r) => (r.netPnl ?? ZERO).abs())

  const grossProfit = sum(winPnls)
  const grossLoss = sum(lossPnlsAbs)
  const netPnl = sum(closed.map((r) => r.netPnl ?? ZERO))

  const profitFactor = grossLoss.isZero() ? null : grossProfit.div(grossLoss)

  const averageWin = wins > 0 ? grossProfit.div(wins) : null
  const averageLoss = losses > 0 ? grossLoss.div(losses) : null

  const rBearingRows = rows.filter((r): r is TradeRow & { rMultiple: Decimal } => r.rMultiple !== null)
  const rValues = rBearingRows.map((r) => r.rMultiple)
  const averageRMultiple = mean(rValues)
  const standardDeviationR = sampleStdev(rValues)
  const systemQuality =
    averageRMultiple !== null && standardDeviationR !== null && !standardDeviationR.isZero()
      ? averageRMultiple.div(standardDeviationR).times(new Decimal(rValues.length).sqrt())
      : null

  // When there are no losses (or no wins) at all, (1 - winRate) (or winRate)
  // is exactly 0, so the missing average is multiplied away — treat it as 0
  // rather than blocking the whole calculation. expectancy is only null when
  // winRate itself is null (no wins AND no losses to build a rate from).
  const expectancyMoney =
    winRate !== null
      ? new Decimal(winRate).times(averageWin ?? ZERO).minus(new Decimal(1 - winRate).times(averageLoss ?? ZERO))
      : null

  const winRRows = rBearingRows.filter((r) => r.outcome === 'WIN')
  const lossRRows = rBearingRows.filter((r) => r.outcome === 'LOSS')
  const averageWinR = mean(winRRows.map((r) => r.rMultiple))
  const averageLossR = mean(lossRRows.map((r) => r.rMultiple.abs()))
  // Null, not zero, when NO row carried an R multiple. Reporting "+0.00R
  // expectancy" for a set of trades that never had a stop loss states a fact
  // about the strategy that the data cannot support — the honest answer is
  // that R is unknowable here, which is what null renders as ("—").
  const expectancyR =
    winRate !== null && rBearingRows.length > 0
      ? new Decimal(winRate).times(averageWinR ?? ZERO).minus(new Decimal(1 - winRate).times(averageLossR ?? ZERO))
      : null

  const largestWin = wins > 0 ? Decimal.max(...winPnls) : null
  const largestLoss = losses > 0 ? Decimal.max(...lossPnlsAbs) : null

  const payoffRatio =
    averageWin !== null && averageLoss !== null && !averageLoss.isZero() ? averageWin.div(averageLoss) : null
  const breakevenWinRate = payoffRatio !== null ? 1 / (1 + payoffRatio.toNumber()) : null

  const { longestWinStreak, longestLossStreak, currentStreak } = computeStreaks(rows)

  const holdingMinutesValues = rows
    .map((r) => r.holdingMinutes)
    .filter((v): v is number => v !== null && v !== undefined)
  const averageHoldingMinutes =
    holdingMinutesValues.length > 0
      ? holdingMinutesValues.reduce((a, b) => a + b, 0) / holdingMinutesValues.length
      : null

  return {
    tradeCount: rows.length,
    closedCount: closed.length,
    openCount,
    wins,
    losses,
    breakevens,
    winRate,
    grossProfit,
    grossLoss,
    netPnl,
    profitFactor,
    averageWin,
    averageLoss,
    averageRMultiple,
    expectancyMoney,
    expectancyR,
    largestWin,
    largestLoss,
    payoffRatio,
    standardDeviationR,
    systemQuality,
    longestWinStreak,
    longestLossStreak,
    currentStreak,
    averageHoldingMinutes,
    breakevenWinRate,
  }
}

/**
 * Win/loss streaks, chronological by closedAt (falling back to openedAt for
 * open rows, which are then excluded from the WIN/LOSS sequence anyway).
 *
 * Documented behaviour: BREAKEVEN rows are skipped entirely when building
 * the streak sequence — they neither extend nor break a run of wins or
 * losses. E.g. WIN, BREAKEVEN, WIN counts as a single streak of 2 wins.
 */
function computeStreaks(rows: TradeRow[]): {
  longestWinStreak: number
  longestLossStreak: number
  currentStreak: number
} {
  const sorted = [...rows]
    .filter((r) => r.outcome === 'WIN' || r.outcome === 'LOSS' || r.outcome === 'BREAKEVEN')
    .sort((a, b) => (a.closedAt?.getTime() ?? a.openedAt.getTime()) - (b.closedAt?.getTime() ?? b.openedAt.getTime()))
    .filter((r) => r.outcome !== 'BREAKEVEN')

  let longestWinStreak = 0
  let longestLossStreak = 0
  let runOutcome: 'WIN' | 'LOSS' | null = null
  let runLength = 0

  for (const row of sorted) {
    const outcome = row.outcome as 'WIN' | 'LOSS'
    if (outcome === runOutcome) {
      runLength += 1
    } else {
      runOutcome = outcome
      runLength = 1
    }
    if (outcome === 'WIN') longestWinStreak = Math.max(longestWinStreak, runLength)
    else longestLossStreak = Math.max(longestLossStreak, runLength)
  }

  const currentStreak = runOutcome === 'WIN' ? runLength : runOutcome === 'LOSS' ? -runLength : 0

  return { longestWinStreak, longestLossStreak, currentStreak }
}

/**
 * Builds a chronological equity curve from closed trades and external
 * balance events. Trades are ordered by closedAt; on an exact time tie
 * trades are placed before balance events (an arbitrary but stable,
 * documented choice — Array.sort is stable so this ordering is
 * deterministic).
 */
export function equityCurve(
  rows: TradeRow[],
  startingBalance: DecimalInput,
  balanceEvents: BalanceEvent[] = [],
): EquityPoint[] {
  type Entry = { at: Date; change: Decimal; kind: EquityPoint['kind'] }

  const tradeEntries: Entry[] = rows
    .filter((r) => r.closedAt !== null && r.netPnl !== null)
    .map((r) => ({ at: r.closedAt as Date, change: r.netPnl as Decimal, kind: 'TRADE' as const }))

  const eventEntries: Entry[] = balanceEvents.map((e) => ({ at: e.at, change: d(e.amount), kind: e.kind }))

  const combined = [...tradeEntries, ...eventEntries].sort((a, b) => a.at.getTime() - b.at.getTime())

  let balance = d(startingBalance)
  const points: EquityPoint[] = []
  for (const entry of combined) {
    balance = balance.plus(entry.change)
    points.push({ at: entry.at, balance, change: entry.change, kind: entry.kind })
  }
  return points
}

/**
 * Derives a drawdown series from an equity curve.
 *
 * Judgement call: a DEPOSIT point is never allowed to set a new high-water
 * mark (peak). Capital injected via deposit is not trading performance, so
 * it shouldn't reset what counts as "a new high". The very next non-deposit
 * point (a trade, withdrawal or adjustment) resumes comparing its balance
 * against the pre-deposit peak; if that balance (which naturally includes
 * the deposited cash) exceeds it, the peak updates normally at that point.
 * One visible side effect: the drawdown reading right at a deposit can drop
 * to 0 (floored) even though the peak variable itself didn't move, since
 * the deposit-inflated balance can exceed the stale peak.
 */
export function drawdownSeries(curve: EquityPoint[]): DrawdownPoint[] {
  let peak: Decimal | null = null
  const out: DrawdownPoint[] = []
  for (const point of curve) {
    if (point.kind !== 'DEPOSIT') {
      peak = peak === null ? point.balance : Decimal.max(peak, point.balance)
    }
    const effectivePeak = peak ?? point.balance
    const drawdown = Decimal.max(effectivePeak.minus(point.balance), ZERO)
    const drawdownPct = effectivePeak.isZero() ? ZERO : drawdown.div(effectivePeak).times(100)
    out.push({ at: point.at, balance: point.balance, peak: effectivePeak, drawdown, drawdownPct })
  }
  return out
}

/**
 * Finds the single worst drawdown episode. `peakAt` is when the high-water
 * mark that the trough fell from was set; `recoveredAt` is the first later
 * point whose balance returns to/above that peak value (null if not yet
 * recovered); `lengthDays` spans peakAt -> recoveredAt and is null while
 * unrecovered.
 */
export function maxDrawdown(curve: EquityPoint[]): MaxDrawdown | null {
  if (curve.length === 0) return null

  const series = drawdownSeries(curve)

  // Track, for each point, when its `peak` value was actually set (the most
  // recent point up to and including this one whose balance == peak).
  const peakAts: Date[] = []
  let lastPeakValue: Decimal | null = null
  let lastPeakAt: Date = curve[0].at
  for (const point of series) {
    if (lastPeakValue === null || !point.peak.equals(lastPeakValue)) {
      lastPeakValue = point.peak
      lastPeakAt = point.at
    }
    peakAts.push(lastPeakAt)
  }

  let worstIndex = 0
  for (let i = 1; i < series.length; i++) {
    if (series[i].drawdown.gt(series[worstIndex].drawdown)) worstIndex = i
  }

  const worst = series[worstIndex]
  if (worst.drawdown.isZero()) {
    return {
      amount: ZERO,
      pct: ZERO,
      peakAt: peakAts[worstIndex],
      troughAt: worst.at,
      recoveredAt: worst.at,
      lengthDays: 0,
    }
  }

  const peakValue = worst.peak
  let recoveredAt: Date | null = null
  for (let i = worstIndex + 1; i < series.length; i++) {
    if (series[i].balance.gte(peakValue)) {
      recoveredAt = series[i].at
      break
    }
  }

  const peakAt = peakAts[worstIndex]
  const lengthDays = recoveredAt ? (recoveredAt.getTime() - peakAt.getTime()) / 86_400_000 : null

  return {
    amount: worst.drawdown,
    pct: worst.drawdownPct,
    peakAt,
    troughAt: worst.at,
    recoveredAt,
    lengthDays,
  }
}

/** Groups rows by `keyFn(row)` and runs summarize() on each group — the shared building block for pair/session/tag/weekday/hour breakdowns. */
export function groupBy<K, T extends TradeRow>(rows: T[], keyFn: (row: T) => K): Map<K, Summary> {
  const groups = new Map<K, T[]>()
  for (const row of rows) {
    const key = keyFn(row)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }
  const result = new Map<K, Summary>()
  for (const [key, group] of groups) {
    result.set(key, summarize(group))
  }
  return result
}

function round10(n: number): number {
  return Math.round(n * 1e10) / 1e10
}

/**
 * Histogram of R multiples in buckets of width `bucketSize`, covering the
 * observed range, plus a dedicated "no R" bucket (from/to = null) for rows
 * with no stop loss (rMultiple === null).
 */
export function rDistribution(rows: TradeRow[], bucketSize = 0.5): RBucket[] {
  const withR = rows.filter((r): r is TradeRow & { rMultiple: Decimal } => r.rMultiple !== null)
  const withoutR = rows.filter((r) => r.rMultiple === null)

  const buckets: RBucket[] = []

  if (withR.length > 0) {
    const values = withR.map((r) => r.rMultiple.toNumber())
    const min = Math.min(...values)
    const max = Math.max(...values)
    const start = round10(Math.floor(min / bucketSize) * bucketSize)
    const end = round10(Math.ceil(max / bucketSize) * bucketSize)
    const bucketCount = Math.max(1, Math.round((end - start) / bucketSize))

    for (let i = 0; i < bucketCount; i++) {
      const from = round10(start + i * bucketSize)
      const to = round10(start + (i + 1) * bucketSize)
      const isLast = i === bucketCount - 1
      const inBucket = withR.filter((r) => {
        const v = r.rMultiple.toNumber()
        return isLast ? v >= from && v <= to : v >= from && v < to
      })
      buckets.push({
        from,
        to,
        count: inBucket.length,
        netPnl: sum(inBucket.map((r) => r.netPnl ?? ZERO)),
      })
    }
  }

  if (withoutR.length > 0) {
    buckets.push({
      from: null,
      to: null,
      count: withoutR.length,
      netPnl: sum(withoutR.map((r) => r.netPnl ?? ZERO)),
    })
  }

  return buckets
}

function dateKey(zoned: TZDate): string {
  const y = zoned.getFullYear()
  const m = String(zoned.getMonth() + 1).padStart(2, '0')
  const dd = String(zoned.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/**
 * Per-calendar-day net P&L totals in `timeZone` (an IANA zone name), for a
 * daily-loss guard and a calendar heatmap. Only closed trades (closedAt +
 * netPnl both present) are included; the bucket a trade falls into is
 * determined by its closedAt converted into the local calendar day of
 * `timeZone`, which can differ from its UTC calendar day.
 */
export function dailyPnl(rows: TradeRow[], timeZone: string): DailyPnl[] {
  const map = new Map<string, { netPnl: Decimal; tradeCount: number }>()
  for (const row of rows) {
    if (row.closedAt === null || row.netPnl === null) continue
    const zoned = new TZDate(row.closedAt, timeZone)
    const key = dateKey(zoned)
    const existing = map.get(key) ?? { netPnl: ZERO, tradeCount: 0 }
    map.set(key, { netPnl: existing.netPnl.plus(row.netPnl), tradeCount: existing.tradeCount + 1 })
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, v]) => ({ date, netPnl: v.netPnl, tradeCount: v.tradeCount }))
}
