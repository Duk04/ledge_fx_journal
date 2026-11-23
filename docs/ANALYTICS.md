# Analytics & Overview

Owns: `src/app/(app)/(overview)/page.tsx` (Overview), `src/app/(app)/analytics/page.tsx`
(Reports), `src/components/charts/**`, `src/components/dashboard/**`,
`src/lib/queries/analytics/`.

## Which query feeds which view

All reads live in `src/lib/queries/analytics/` — one module per view
(`overview.ts`, `breakdowns.ts`, `distributions.ts`, `periods.ts`,
`journal-stats.ts`, `simulation.ts`), sharing one cached account load
(`context.ts`) and one serialiser (`serialize.ts`), re-exported from
`index.ts`. Every
function takes `{ userId, accountId, from, to }` and returns plain,
fully-serialised data — no Prisma `Decimal` ever leaves these modules. On
Analytics `from` is `resolveRange(rangeParam, timezone)`, a rolling window; on
the Overview it is `resolveRangeDays()`, the same keys cut at local midnight
(see "The Overview" below for why).

| Query | Overview page | Analytics page |
|---|---|---|
| `journalStats()` | The figure cards, the daily balance and cumulative P&L charts, the daily P&L bars, the two holding-time bar panels | — (also the `/journal` page's cards and balance chart) |
| `overview()` | Challenge panel (`.prop`), open positions, recent trades | Equity tab: stat row, equity and drawdown charts, today/week/month P&L, discipline panel. Distribution tab's payoff/expectancy stat row (`overview().summary`) |
| `monthView()` (`queries/journal.ts`) | The month calendar | — |
| `breakdowns()` | — | Breakdowns tab (symbol/tag/session/direction/plan tables + the insight sentence); Timing tab's weekday table and hour-of-day chart (`.weekday`, `.hourOfDay`) |
| `rHistogram()` | — | Distribution tab: the R histogram (`.buckets`) and the winners/losers tables (`.topWinners`/`.topLosers`) |
| `heatmap()` | — | Timing tab's session heatmap |
| `holdingBuckets()` | — | Timing tab's holding-time table |

`fetchAccountData()` (the shared trade/account/balance-event loader inside
analytics.ts) is wrapped in React's `cache()`, so calling several of the
functions above in one request — as the Analytics page does, in parallel —
shares one DB round trip instead of five.

## The Overview

One page, top to bottom in the order a prop-firm dashboard lays it out: six
headline cards, the daily balance, the weekday/duration/average cards and the
best and worst trade, cumulative and daily P&L, trades and win rate by holding
time, the month calendar, the last ten trades. A challenge panel and open
positions sit above the cards only when the account has rules or a position
open. A brand-new account gets one panel — import a statement, or log a trade
— and none of the rest.

- **Everything range-scoped is `journalStats()`**: closed trades by close
  date, the calendar's own rule, so a card, a bar and a day cell agree
  (docs/JOURNAL.md, "Stats").
- **The range is whole local days.** `resolveRangeDays()` makes "7D" today
  and the six days before it. The figures are per day — day win %, best day,
  the bars, end-of-day balance — and a rolling "168 hours ago" window would
  cut the first day in half and let those numbers drift by the hour.
- **The calendar pages on its own** with `?month`, starting on the current
  month; `?range` survives paging and `?month` survives a range change. A day
  with trades links to `/trades?day=YYYY-MM-DD` (docs/TRADES.md).
- **Holding-time buckets** are cut by `groupByDuration()`
  (`src/lib/metrics/duration.ts`), shared with Analytics' Timing table — which
  buckets trades OPENED in the range, while these bars bucket trades CLOSED
  in it.

The summary, equity curve, drawdown, streaks and discipline figures that used
to be the Overview are Analytics' **Equity** tab. They still read
`overview()` and still use the windows described next.

## Two different notions of "in range"

The `range` picker (7d/30d/90d/YTD/All) is applied two different ways on
purpose:

- **Activity window** (`openedAt`-based): the performance summary, every
  breakdown dimension, the R histogram, the heatmap, and the holding-time
  buckets. A trade belongs to the period it was *taken* in — which is also
  why a still-open trade counts here even with no `closedAt` yet.
- **Chronological window** (`closedAt`/`occurredAt`-based): the equity curve,
  the drawdown series, and max drawdown. Balance only moves the instant a
  trade closes or a deposit/withdrawal lands, so slicing by "when did this
  event happen" is the only way the chart agrees with the account's real
  balance history. The window's starting balance is the running balance the
  moment before `from` (account's starting balance itself when `from` is
  null) — that value is also where the equity chart draws its reference
  line, and it is passed down as `overview().equityStartBalance`.

The Overview's and the journal page's figures (`journalStats()`) are a third
case and use only the chronological window, by `closedAt` — see
docs/JOURNAL.md, "Stats".

`recentTrades`, `openTrades`, and `todayPnl`/`weekPnl`/`monthPnl` ignore the
range entirely — they answer "what's happening right now", so switching the
range shouldn't hide the open-positions list or make today's P&L disappear.

## Rule: cash movements are visible on the equity curve

An equity curve that goes up because someone wired in $10k, with no visual
distinction from a curve that went up because the trades were good, is a
lie. `equity-chart.tsx` renders a short vertical tick at every
deposit/withdrawal/adjustment point (`kind !== "TRADE"`), and the custom
tooltip always names the event ("Deposit", "Withdrawal", "Adjustment") next
to the amount, never just folding it into "Trade close". The reference line
at `equityStartBalance` gives the chart something to compare the whole
window against, so a deposit-inflated curve doesn't read as "up" without
qualification either.

## Rule: the small-sample guard on generated sentences

`components/dashboard/insight-sentence.tsx` builds the one generated
sentence at the top of the Breakdowns tab — deliberately the most
load-bearing copy on the page, so it is not hand-wavy:

- Every group across every dimension shown on that tab (symbol, tag,
  session, direction, plan-followed) is pooled together.
- A group with **fewer than 10 trades is excluded from consideration
  entirely** — not flagged, excluded — before picking a "strongest" and
  "weakest". Three lucky trades is not a strategy.
- If fewer than two groups clear that bar, the sentence says exactly that
  ("not enough trades yet... check back after a few more closed trades")
  instead of naming a winner and loser that aren't statistically real.
- Three polarity branches keep the phrasing honest even when the pooled
  eligible groups are lopsided: everything net-positive ("X leads with...,
  Y trails at..."), everything net-negative ("X is the deepest drag..., Y is
  the least bad..."), and the normal positive-vs-negative case ("X is
  carrying this account..., while Y is...").

## Rule: colour-blind-safe magnitude encoding (heatmap)

`session-heatmap.tsx` never lets hue alone carry information. Magnitude is
encoded twice — as a tint (weak profit/loss token, opacity scaled by
`|netPnl| / max|netPnl|` across the grid) and as a small neutral-ink corner
bar whose **length** repeats the magnitude and whose **edge** (bottom vs
top) repeats the polarity. The corner bar is legible in greyscale, print, or
any type of colour-vision deficiency, where the profit/loss tint alone would
not be — a reader who can't distinguish jade from clay can still tell "big
bar at the bottom" (a big win) from "big bar at the top" (a big loss).

## Other judgment calls worth knowing about

- **`breakdowns().tag`** only considers `SETUP`-kind tags (not `MISTAKE`,
  `SESSION`, or `CUSTOM`) — the Analytics page's Breakdowns tab specifically
  asks for a "setup tag" table. A trade can carry more than one setup tag,
  so this dimension is built by hand (not via the shared `groupBy()`
  helper, which assumes one key per row) but still calls `summarize()` per
  group like every other dimension — no parallel statistics code.
- **`marketSession` spelling.** The stored value is `NEWYORK`; the Prisma
  enum maps it to `NEW_YORK` (`@map` in schema.prisma), which is the
  spelling `src/lib/metrics/session.ts` and every TypeScript reader use.
  (This used to be a live mismatch that `badge.tsx` defended against; the
  `@map` settled it.)
- **Discipline panel scope.** `discipline` (plan-followed rate, no-stop-loss
  count, average emotion) is computed over the *activity* window like the
  main summary, so it moves with the range picker — unlike the open
  positions / today-week-month panels next to it on the page, which are
  deliberately range-independent (see above).

## The Periods tab

`src/lib/queries/analytics/periods.ts`, rendered by
`src/components/dashboard/periods-view.tsx`. Three reports:

- **By month** — net P&L per calendar month, all time, bucketed by **close**
  date in the user's timezone (a month's P&L is what was realised in it — the
  daily-P&L convention). Not range-scoped: the grid *is* the time axis.
- **Against the previous period** — the selected range's summary next to
  the window of equal length immediately before it, by **open** date like
  every other range-scoped report, so its "this range" column matches
  Breakdowns. "All" has nothing before it and says so.
- **Exit efficiency** — MAE/MFE in R, over closed trades in range that have
  both prices and a stop: how far winners went against you first (stop
  placement), the average best excursion against the average realised R,
  and the share of the available move winners kept. R is measured against
  the initial stop (`docs/METRICS.md`).

MAE/MFE prices are entered on the trade form or measured from stored M1
candles ("Measure from candles" on a closed trade's page,
`src/lib/metrics/excursion.ts`). Only bars wholly inside the holding period
are read — the entry and exit bars contain prices from before the fill and
after the close — and the measurement is refused, not guessed, when the
candles don't cover the trade.

## The challenge panel (prop-firm rules)

An account can carry evaluation rules — daily loss limit, max drawdown
(static from the starting balance, or trailing the highest closed balance),
profit target, minimum trading days — set in the account dialog. When any is
set, the dashboard shows a Challenge panel (`src/lib/prop.ts`):

- All-time and never range-scoped: an evaluation is one continuous thing.
- Percentages are of the **starting balance**, as the firms define them.
- Realised only: the journal has no live prices, so a floating loss on an
  open position does not count until it closes. The panel says so.
- A breach is sticky — a balance that closed below the floor once has failed,
  however it recovered.
- The risk guard (`src/lib/risk.ts`) uses the account's daily loss limit in
  place of its own heuristic when one is set, so the two never disagree about
  whether today's limit is gone.
