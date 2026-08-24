# Analytics & Overview

Owns: `src/app/(app)/page.tsx` (Overview), `src/app/(app)/analytics/page.tsx`
(Reports), `src/components/charts/**`, `src/components/dashboard/**`,
`src/lib/queries/analytics.ts`.

## Which query feeds which view

All reads live in `src/lib/queries/analytics.ts`, one function per view. Every
function takes `{ userId, accountId, from, to }` (`from`/`to` from
`resolveRange(rangeParam, timezone)`) and returns plain, fully-serialised data
— no Prisma `Decimal` ever leaves this file.

| Query | Overview page | Analytics page |
|---|---|---|
| `overview()` | Stat row, equity chart, drawdown chart, daily P&L chart, recent trades, open positions, today/week/month P&L, discipline panel | Distribution tab's payoff/expectancy stat row (`overview().summary`) |
| `breakdowns()` | — | Breakdowns tab (symbol/tag/session/direction/plan tables + the insight sentence); Timing tab's weekday table and hour-of-day chart (`.weekday`, `.hourOfDay`) |
| `rHistogram()` | — | Distribution tab: the R histogram (`.buckets`) and the winners/losers tables (`.topWinners`/`.topLosers`) |
| `heatmap()` | — | Timing tab's session heatmap |
| `holdingBuckets()` | — | Timing tab's holding-time table |

`fetchAccountData()` (the shared trade/account/balance-event loader inside
analytics.ts) is wrapped in React's `cache()`, so calling several of the
functions above in one request — as the Analytics page does, in parallel —
shares one DB round trip instead of five.

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
- **`marketSession` spelling.** `src/lib/metrics/session.ts` classifies a
  trade's session as `'NEW_YORK'` (with an underscore); the Prisma
  `MarketSession` enum column is `NEWYORK` (without one). This is a
  pre-existing mismatch outside analytics.ts's owned files — `badge.tsx`'s
  `SESSION_CODES` map already defends against both spellings. analytics.ts
  only ever reads the column back (never writes it), so it consistently
  uses the six DB enum values (`SYDNEY/TOKYO/LONDON/NEWYORK/OVERLAP/OFFHOURS`).
- **Discipline panel scope.** `discipline` (plan-followed rate, no-stop-loss
  count, average emotion) is computed over the *activity* window like the
  main summary, so it moves with the range picker — unlike the open
  positions / today-week-month panels next to it on the page, which are
  deliberately range-independent (see above).
