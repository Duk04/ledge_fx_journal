import { describe, expect, it } from 'vitest'
import { Decimal } from 'decimal.js'
import { dailyPnl, drawdownSeries, equityCurve, groupBy, maxDrawdown, rDistribution, summarize } from './aggregate'
import type { BalanceEvent, Outcome, TradeRow } from './types'

function row(overrides: Partial<TradeRow> & { pair?: string }): TradeRow & { pair?: string } {
  return {
    netPnl: null,
    rMultiple: null,
    outcome: 'OPEN',
    openedAt: new Date('2026-01-01T00:00:00Z'),
    closedAt: null,
    ...overrides,
  }
}

function closed(outcome: Outcome, netPnl: number, rMultiple: number | null, closedAt: string): TradeRow {
  return {
    outcome,
    netPnl: new Decimal(netPnl),
    rMultiple: rMultiple === null ? null : new Decimal(rMultiple),
    openedAt: new Date(closedAt),
    closedAt: new Date(closedAt),
  }
}

describe('summarize — core stats', () => {
  const rows: TradeRow[] = [
    closed('WIN', 200, 2, '2026-01-01T00:00:00Z'),
    closed('WIN', 100, 1, '2026-01-02T00:00:00Z'),
    closed('LOSS', -100, -1, '2026-01-03T00:00:00Z'),
    closed('LOSS', -50, -0.5, '2026-01-04T00:00:00Z'),
    closed('BREAKEVEN', 0.002, 0.02, '2026-01-05T00:00:00Z'),
    row({ outcome: 'OPEN' }),
  ]
  const summary = summarize(rows)

  it('counts trades correctly', () => {
    expect(summary.tradeCount).toBe(6)
    expect(summary.closedCount).toBe(5)
    expect(summary.openCount).toBe(1)
    expect(summary.wins).toBe(2)
    expect(summary.losses).toBe(2)
    expect(summary.breakevens).toBe(1)
  })

  it('winRate excludes breakevens from both numerator and denominator', () => {
    expect(summary.winRate).toBe(0.5) // 2 / (2 + 2), NOT 2 / 5
  })

  it('computes gross profit/loss and net P&L', () => {
    expect(summary.grossProfit.toString()).toBe('300')
    expect(summary.grossLoss.toString()).toBe('150')
    expect(summary.netPnl.toString()).toBe('150.002')
  })

  it('profitFactor and averages', () => {
    expect(summary.profitFactor!.toString()).toBe('2')
    expect(summary.averageWin!.toString()).toBe('150')
    expect(summary.averageLoss!.toString()).toBe('75')
    expect(summary.largestWin!.toString()).toBe('200')
    expect(summary.largestLoss!.toString()).toBe('100')
    expect(summary.payoffRatio!.toString()).toBe('2')
  })

  it('averageRMultiple includes the breakeven R value', () => {
    // (2 + 1 - 1 - 0.5 + 0.02) / 5
    expect(summary.averageRMultiple!.toNumber()).toBeCloseTo(0.304, 10)
  })

  it('expectancyMoney = winRate * avgWin - (1 - winRate) * avgLoss', () => {
    expect(summary.expectancyMoney!.toString()).toBe('37.5') // 0.5*150 - 0.5*75
  })

  it('breakevenWinRate = 1 / (1 + payoffRatio)', () => {
    expect(summary.breakevenWinRate!).toBeCloseTo(1 / 3, 10)
  })

  it('standardDeviationR and systemQuality (SQN) match hand-computed values', () => {
    // hand-verified independently: mean 0.304, sample stdev ≈ 1.2029463828, SQN ≈ 0.5650830950
    expect(summary.standardDeviationR!.toNumber()).toBeCloseTo(1.2029463828, 8)
    expect(summary.systemQuality!.toNumber()).toBeCloseTo(0.5650830950, 8)
  })
})

describe('profitFactor with no losses', () => {
  it('is null, never Infinity', () => {
    const rows: TradeRow[] = [
      closed('WIN', 100, null, '2026-01-01T00:00:00Z'),
      closed('BREAKEVEN', 0.001, null, '2026-01-02T00:00:00Z'),
      closed('WIN', 50, null, '2026-01-03T00:00:00Z'),
    ]
    const summary = summarize(rows)
    expect(summary.grossLoss.toString()).toBe('0')
    expect(summary.profitFactor).toBeNull()
    expect(summary.winRate).toBe(1) // 2 / (2 + 0), breakeven excluded
    // (1 - winRate) is exactly 0 here, so the missing averageLoss doesn't block expectancy.
    expect(summary.expectancyMoney!.toString()).toBe('75') // == averageWin
  })
})

describe('expectancy sign', () => {
  it('is negative for a net-losing system', () => {
    const rows: TradeRow[] = [
      closed('WIN', 50, null, '2026-01-01T00:00:00Z'),
      closed('LOSS', -200, null, '2026-01-02T00:00:00Z'),
      closed('LOSS', -150, null, '2026-01-03T00:00:00Z'),
    ]
    const summary = summarize(rows)
    expect(summary.expectancyMoney!.isNegative()).toBe(true)
  })

  it('is positive for a net-winning system', () => {
    const rows: TradeRow[] = [
      closed('WIN', 500, null, '2026-01-01T00:00:00Z'),
      closed('WIN', 400, null, '2026-01-02T00:00:00Z'),
      closed('LOSS', -100, null, '2026-01-03T00:00:00Z'),
    ]
    const summary = summarize(rows)
    expect(summary.expectancyMoney!.isPositive()).toBe(true)
  })
})

describe('rows without a stop loss', () => {
  it('are excluded from averageRMultiple but still counted in winRate', () => {
    const rows: TradeRow[] = [
      closed('WIN', 100, 2, '2026-01-01T00:00:00Z'),
      closed('WIN', 80, null, '2026-01-02T00:00:00Z'), // no stop loss -> no R
      closed('LOSS', -50, -1, '2026-01-03T00:00:00Z'),
    ]
    const summary = summarize(rows)
    expect(summary.wins).toBe(2)
    expect(summary.winRate).toBeCloseTo(2 / 3, 10)
    expect(summary.averageRMultiple!.toString()).toBe('0.5') // mean(2, -1), the null-R win excluded
  })
})

describe('win/loss streaks', () => {
  it('breakevens are skipped — they neither extend nor break a streak', () => {
    const rows: TradeRow[] = [
      closed('WIN', 10, null, '2026-01-01T00:00:00Z'),
      closed('WIN', 10, null, '2026-01-02T00:00:00Z'),
      closed('BREAKEVEN', 0.001, null, '2026-01-03T00:00:00Z'),
      closed('WIN', 10, null, '2026-01-04T00:00:00Z'),
      closed('LOSS', -10, null, '2026-01-05T00:00:00Z'),
      closed('LOSS', -10, null, '2026-01-06T00:00:00Z'),
      closed('BREAKEVEN', 0.001, null, '2026-01-07T00:00:00Z'),
      closed('WIN', 10, null, '2026-01-08T00:00:00Z'),
    ]
    const summary = summarize(rows)
    // Non-breakeven sequence: WIN, WIN, WIN, LOSS, LOSS, WIN
    expect(summary.longestWinStreak).toBe(3)
    expect(summary.longestLossStreak).toBe(2)
    expect(summary.currentStreak).toBe(1) // most recent run is a single win
  })

  it('reports a negative currentStreak when the most recent run is a loss', () => {
    const rows: TradeRow[] = [
      closed('WIN', 10, null, '2026-01-01T00:00:00Z'),
      closed('LOSS', -10, null, '2026-01-02T00:00:00Z'),
      closed('LOSS', -10, null, '2026-01-03T00:00:00Z'),
    ]
    expect(summarize(rows).currentStreak).toBe(-2)
  })

  it('is order-independent — streaks are computed by closedAt, not array order', () => {
    const rows: TradeRow[] = [
      closed('LOSS', -10, null, '2026-01-03T00:00:00Z'),
      closed('WIN', 10, null, '2026-01-01T00:00:00Z'),
      closed('LOSS', -10, null, '2026-01-02T00:00:00Z'),
    ]
    const summary = summarize(rows)
    expect(summary.currentStreak).toBe(-2)
  })
})

describe('groupBy', () => {
  it('groups rows by an arbitrary key and summarizes each group independently', () => {
    const rows: (TradeRow & { pair: string })[] = [
      { ...closed('WIN', 100, null, '2026-01-01T00:00:00Z'), pair: 'EURUSD' },
      { ...closed('LOSS', -40, null, '2026-01-02T00:00:00Z'), pair: 'EURUSD' },
      { ...closed('WIN', 60, null, '2026-01-03T00:00:00Z'), pair: 'GBPUSD' },
    ]
    const groups = groupBy(rows, (r) => r.pair)
    expect(groups.get('EURUSD')!.tradeCount).toBe(2)
    expect(groups.get('EURUSD')!.netPnl.toString()).toBe('60')
    expect(groups.get('GBPUSD')!.tradeCount).toBe(1)
    expect(groups.get('GBPUSD')!.wins).toBe(1)
  })
})

describe('rDistribution', () => {
  it('buckets R values and reports a dedicated "no R" bucket', () => {
    const rows: TradeRow[] = [
      closed('LOSS', -10, -1.2, '2026-01-01T00:00:00Z'),
      closed('LOSS', -5, -0.3, '2026-01-02T00:00:00Z'),
      closed('WIN', 5, 0.4, '2026-01-03T00:00:00Z'),
      closed('WIN', 10, 1.1, '2026-01-04T00:00:00Z'),
      closed('WIN', 20, 2.05, '2026-01-05T00:00:00Z'),
      closed('WIN', 20, null, '2026-01-06T00:00:00Z'), // no stop loss
    ]
    const buckets = rDistribution(rows, 0.5)
    const noR = buckets.find((b) => b.from === null)
    expect(noR).toBeDefined()
    expect(noR!.count).toBe(1)
    expect(noR!.netPnl.toString()).toBe('20')

    const rBuckets = buckets.filter((b) => b.from !== null)
    expect(rBuckets).toHaveLength(8) // covers [-1.5, 2.5) in steps of 0.5
    expect(rBuckets[0]).toMatchObject({ from: -1.5, to: -1, count: 1 })
    expect(rBuckets.find((b) => b.from === -0.5 && b.to === 0)!.count).toBe(1)
    expect(rBuckets.find((b) => b.from === 2 && b.to === 2.5)!.count).toBe(1) // last bucket is inclusive of the max
    const totalRCount = rBuckets.reduce((sum, b) => sum + b.count, 0)
    expect(totalRCount).toBe(5)
  })
})

describe('dailyPnl — timezone bucketing across UTC midnight', () => {
  const rows: TradeRow[] = [
    closed('WIN', 100, null, '2026-03-10T17:30:00Z'),
    closed('LOSS', -50, null, '2026-03-10T23:00:00Z'),
  ]

  it('buckets both trades into 2026-03-10 under UTC', () => {
    const days = dailyPnl(rows, 'UTC')
    expect(days).toHaveLength(1)
    expect(days[0].date).toBe('2026-03-10')
    expect(days[0].netPnl.toString()).toBe('50')
    expect(days[0].tradeCount).toBe(2)
  })

  it('a trade closed 2026-03-10T17:30:00Z belongs to 2026-03-11 for a UTC+8 (Asia/Ulaanbaatar) user', () => {
    const days = dailyPnl(rows, 'Asia/Ulaanbaatar')
    expect(days).toHaveLength(1)
    expect(days[0].date).toBe('2026-03-11')
    expect(days[0].netPnl.toString()).toBe('50')
    expect(days[0].tradeCount).toBe(2)
  })
})

describe('equityCurve and drawdown — an 8-point hand-computed curve with a mid-way deposit', () => {
  const rows: TradeRow[] = [
    closed('WIN', 500, null, '2026-02-01T00:00:00Z'),
    closed('LOSS', -1200, null, '2026-02-02T00:00:00Z'),
    closed('WIN', 300, null, '2026-02-03T00:00:00Z'),
    closed('LOSS', -800, null, '2026-02-05T00:00:00Z'),
    closed('LOSS', -1500, null, '2026-02-06T00:00:00Z'),
    closed('WIN', 1000, null, '2026-02-07T00:00:00Z'),
    closed('WIN', 600, null, '2026-02-08T00:00:00Z'),
  ]
  const balanceEvents: BalanceEvent[] = [{ at: new Date('2026-02-04T00:00:00Z'), amount: 2000, kind: 'DEPOSIT' }]

  const curve = equityCurve(rows, 10000, balanceEvents)

  it('produces a chronologically sorted running balance', () => {
    expect(curve).toHaveLength(8)
    expect(curve.map((p) => p.balance.toString())).toEqual([
      '10500', // +500
      '9300', // -1200
      '9600', // +300
      '11600', // +2000 deposit
      '10800', // -800
      '9300', // -1500
      '10300', // +1000
      '10900', // +600
    ])
    expect(curve[3].kind).toBe('DEPOSIT')
  })

  it('a deposit does not count as a new equity peak for drawdown purposes', () => {
    const series = drawdownSeries(curve)
    // Right before the deposit, the peak is 10500 (from day 1).
    expect(series[2].peak.toString()).toBe('10500')
    // At the deposit itself (balance 11600), the peak must NOT jump to 11600 —
    // it stays 10500, and drawdown is floored at 0 since balance > that peak.
    expect(series[3].peak.toString()).toBe('10500')
    expect(series[3].drawdown.toString()).toBe('0')
    // The very next (non-deposit) point CAN set a new peak from the
    // deposit-inflated balance: 10800 > 10500.
    expect(series[4].peak.toString()).toBe('10800')
  })

  it('drawdownSeries matches hand-computed amounts and percentages', () => {
    const series = drawdownSeries(curve)
    expect(series[1].drawdown.toString()).toBe('1200') // 10500 - 9300
    expect(series[1].drawdownPct.toNumber()).toBeCloseTo(11.428571, 5)
    expect(series[5].drawdown.toString()).toBe('1500') // 10800 - 9300
    expect(series[5].drawdownPct.toNumber()).toBeCloseTo(13.888889, 5)
  })

  it('maxDrawdown finds the worst episode and its recovery', () => {
    const dd = maxDrawdown(curve)!
    expect(dd.amount.toString()).toBe('1500')
    expect(dd.pct.toNumber()).toBeCloseTo(13.888889, 5)
    expect(dd.peakAt.toISOString()).toBe(new Date('2026-02-05T00:00:00Z').toISOString()) // when the 10800 peak was set
    expect(dd.troughAt.toISOString()).toBe(new Date('2026-02-06T00:00:00Z').toISOString())
    expect(dd.recoveredAt!.toISOString()).toBe(new Date('2026-02-08T00:00:00Z').toISOString())
    expect(dd.lengthDays).toBe(3)
  })
})
