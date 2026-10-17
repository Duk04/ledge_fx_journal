# Metrics core — formulas, rationale, and judgement calls

Source: `src/lib/metrics/`. Pure, dependency-light TypeScript — no Prisma, no
database, no framework. Every price/money/volume value is a decimal.js
`Decimal`; native JS floating point is never used for that arithmetic (see
"The money rule" below). Conversion to plain numbers happens only in
`formatters.ts`, at the UI boundary.

## The money rule

Binary floating point cannot represent most decimal fractions exactly:

```js
1.0850 - 1.0849       // 0.00009999999999998899, not 0.0001
(1.0850 - 1.0849) / 0.0001  // 0.9999999999998899, not 1
```

A single pip of drift like that, multiplied by contract size and lot size and
summed over thousands of trades, silently corrupts P&L. So every public
function in this module accepts `Decimal | string | number` (`DecimalInput`)
and immediately normalises via `d()` (`decimal.ts`), then does all arithmetic
in `Decimal`. Functions return `Decimal` (or `Decimal | null`) — never a
plain number — for anything that represents money, price, or volume.
`formatters.ts` is the only place that calls `.toNumber()`/`.toFixed()`.

`src/lib/metrics/trade.test.ts` has a dedicated regression test for this: a
0.01-lot, 1-pip EURUSD move must compute to exactly `1` pip and exactly `0.1`
gross P&L, not the float-drifted values shown above.

## Per-trade calculations (`trade.ts`)

### Pip value

```
pipValuePerLot(instrument, conversionRate = 1)
  = pipSize × contractSize × conversionRate
```

This is the account-currency value of a one-pip move on 1.0 lot.
`conversionRate` converts one unit of the instrument's **quote currency**
into the account currency and defaults to `1` (quote currency == account
currency — the common case, e.g. a USD account trading EURUSD).

**Quote-currency conversion worked example (USDJPY, USD account):**
USDJPY pip value is naturally in JPY: `0.01 × 100000 = 1000 JPY` per lot. A
0.5-lot, 50-pip move is `25000 JPY` gross — correct, but in the wrong
currency for a USD-denominated account. Passing
`conversionRate = 1 / 151.70` (the JPY→USD rate) converts it:
`25000 × (1/151.70) ≈ 164.80 USD`. The caller is responsible for supplying an
up-to-date conversion rate; this module does not fetch rates.

### Pips and P&L

```
computePips(trade)      = ±(exitPrice − entryPrice) / pipSize
                           (sign flipped for SHORT, so a favourable move is
                            always positive regardless of direction)
computeGrossPnl(trade)  = pips × pipValuePerLot × volumeLots
computeNetPnl(trade)    = grossPnl − commission − swap
```

**Sign convention for commission/swap:** both are POSITIVE numbers
representing a cost to the trader (the normal case for a broker fee or
negative swap), and are *subtracted*. A rebate or a swap credit is simply
passed as a **negative** number — subtracting a negative adds it back
algebraically. There's no separate "credit" flag; the sign carries the whole
meaning. This keeps the formula a single line with no branching.

### Risk and R multiple

```
computeRiskAmount(trade)
  = |entryPrice − riskStop| / pipSize × pipValuePerLot × volumeLots
  riskStop = initialStopLoss ?? stopLoss
  = null if there is no stop at all

computeRMultiple(trade) = netPnl / riskAmount
  = null if riskAmount is null or zero
```

**Judgement call: risk is measured from the stop the trade was OPENED with.**
`stopLoss` is where the stop is now; trailing it to breakeven is normal and
would otherwise make risk zero (R undefined) or tiny (R in the dozens) on a
trade that risked a full 1R when it was taken. `Trade.initialStopLoss` is
recorded at entry (the form's "Initial stop", defaulting to the stop loss)
and is what risk, R and planned R:R use. Existing trades were migrated with
`initialStopLoss = stopLoss`, so no stored R changed.

**Judgement call: risk excludes commission and swap on purpose.** Risk is
defined here as "what you lose if price simply reaches your stop" — the
number a trader actually plans against before the trade, independent of
whatever fee structure their broker happens to charge. Folding commission
into risk would make R multiples on economically identical trades differ
between brokers (or between an ECN and a commission-free account), which
defeats the point of R as a broker-agnostic measure of trade quality. netPnl
(the numerator of R) *does* include commission/swap, so a costly fill still
correctly drags R down — it just isn't double-counted into the risk
denominator too.

### R-mode trades (no prices)

```
computeRTrade(trade)
  rMultiple  = resultR                      (as entered; null while open)
  grossPnl   = resultR × plannedRisk
  netPnl     = grossPnl − commission − swap
  riskAmount = plannedRisk
  pips       = null
```

**Judgement call: R is stored as entered, not recomputed as netPnl / risk.**
In price mode R includes costs only through its numerator; in R mode the
trader states R directly, and recomputing it from a cost-reduced P&L would
make "+2R" mean slightly less than 2R in one mode and exactly 2R in the
other. Costs still reach P&L, equity and every money figure. See
docs/TRADES.md, "R-mode trades", for what the mode is and is not.

### Planned reward:risk and geometry validation

```
computePlannedRR(trade) = |takeProfit − entryPrice| / |riskStop − entryPrice|
```

Returns `null` if either leg is missing, if the stop distance is zero, or if
`validateTradeGeometry` finds the stop or target on the wrong side of entry.
`validateTradeGeometry(trade)` returns a list of problems rather than
throwing, so a caller can choose to block a save, show a warning, or just let
`plannedRR`/other fields come back `null`:

| Code                       | Condition                                                            |
|----------------------------|-----------------------------------------------------------------------|
| `SL_WRONG_SIDE`            | Long stop loss ≥ entry, or short stop loss ≤ entry                    |
| `TP_WRONG_SIDE`            | Long take profit ≤ entry, or short take profit ≥ entry                |
| `ZERO_OR_NEGATIVE_VOLUME`  | `volumeLots ≤ 0`                                                       |
| `CLOSED_BEFORE_OPENED`     | `closedAt < openedAt`                                                  |

**Judgement call:** a stop or target placed *exactly at* entry is treated as
invalid (`≥`/`≤`, not `>`/`<`), because it implies zero risk or zero reward —
not a usable plan.

### Holding time and outcome

`computeHoldingMinutes` rounds `(closedAt − openedAt)` to the nearest whole
minute; `null` while open.

```
classifyOutcome(netPnl, status)
  = 'OPEN'      if status is 'OPEN' (or netPnl is null)
  = 'BREAKEVEN' if |netPnl| < 0.005
  = 'WIN'       if netPnl ≥ 0.005
  = 'LOSS'      if netPnl ≤ −0.005
```

**Judgement call: the 0.005 breakeven epsilon.** Sub-cent rounding noise from
commission/swap conversion or broker fills can leave a "flat" trade at
`netPnl = 0.0000000001` or `-0.0031`; without an epsilon these would
misleadingly count as a win or a loss. `0.005` (half a cent) was chosen as a
deliberately small, currency-scale-appropriate threshold — small enough that
no real win/loss is ever misclassified, large enough to absorb rounding
dust. The comparison is strict (`<`), so `netPnl = 0.005` exactly is already
a (barely) real win, not a breakeven — an arbitrary but necessary and
documented boundary choice.

`computeTrade(trade)` is the single entry point that runs all of the above
and returns a complete `TradeResult`. It is meant to be the only function the
API route (on save) and a backfill script (re-deriving historical trades)
ever need to call.

## Trading sessions (`session.ts`)

Session ranges are UTC-hour `[start, end)` windows, exported as
`SESSION_RANGES_UTC` so they can be tuned without touching the classification
logic:

| Session   | UTC hours | Notes                          |
|-----------|-----------|---------------------------------|
| Sydney    | 21 – 06   | wraps past midnight             |
| Tokyo     | 00 – 09   |                                  |
| London    | 07 – 16   |                                  |
| New York  | 12 – 21   |                                  |
| Overlap   | 12 – 16   | London ∩ New York               |

These five windows fully cover all 24 UTC hours on a weekday, but they
overlap each other (Tokyo/London 07–09, London/New York 12–16). Precedence,
checked in order, first match wins:

1. **Weekend → `OFFHOURS`**, regardless of hour (see caveat below).
2. **`OVERLAP`** (12–16 UTC) — the highest-liquidity window, reported ahead
   of its two parents.
3. **`LONDON`** (07–16 UTC) — also covers the Tokyo/London overlap; London is
   reported there as the larger, more liquid session.
4. **`NEW_YORK`** (12–21 UTC) — the remaining New York hours.
5. **`TOKYO`** (00–09 UTC) — the remaining Tokyo hours.
6. **`SYDNEY`** (21–06 UTC).
7. `OFFHOURS` as an unreachable fallback.

Verified boundaries (see `session.test.ts`): `07:00` → LONDON, `11:59` →
LONDON, `12:00` → OVERLAP, `16:00` → NEW_YORK, `20:59` → NEW_YORK, `21:00` →
SYDNEY.

**Judgement call / caveat:** `isWeekend()` uses the plain UTC calendar
weekend (Saturday/Sunday), not the real FX trading week (which closes Friday
~21:00 UTC and reopens Sunday ~21:00–22:00 UTC with the Sydney session). This
is a deliberate simplification — it is off by a few hours right at the
open/close edges of the week — documented here rather than modelled exactly,
to keep the rule simple and testable.

`tradingWeekday(date, timeZone)` converts `date` into the given IANA
timezone using `@date-fns/tz`'s `TZDate` (which handles DST correctly) and
returns the weekday as observed there — which can differ from the UTC
weekday, e.g. `23:30 UTC` on a Monday is already Tuesday in `Asia/Ulaanbaatar`
(UTC+8).

## Aggregate statistics (`aggregate.ts`)

### `summarize(rows)`

- **`winRate = wins / (wins + losses)`** — breakevens are excluded from
  **both** the numerator and the denominator. **Judgement call:** a scratch
  trade shouldn't be able to either inflate or dilute the win rate; a system
  that wins 8, loses 2, and breaks even on 5 others has a genuine 80% win
  rate on the trades that actually resolved one way or the other, not 8/15.
- **`profitFactor = grossProfit / grossLoss`, `null` when `grossLoss` is
  zero.** **Judgement call:** never `Infinity`. A system with zero losing
  trades doesn't have "infinite" edge, it has an undefined profit factor
  (too little data on the downside to say anything) — `null` communicates
  that honestly and is trivially safe to render/sort/serialize, where
  `Infinity` is not (it fails JSON serialization and comparison logic
  silently).
- **`averageRMultiple` / `standardDeviationR` / `systemQuality`** only
  consider rows with a non-null `rMultiple` (i.e. rows that had a stop
  loss). A stop-less row still counts toward `wins`/`losses`/`winRate` — it
  just can't contribute an R value. `standardDeviationR` is the **sample**
  standard deviation (`n − 1` denominator, since a trade log is a sample of
  a strategy's true underlying distribution, not the whole population) and
  is `null` with fewer than 2 R-bearing rows.
- **`systemQuality` (SQN) `= averageRMultiple / standardDeviationR × √n`**
  (n = count of R-bearing rows). This is Van Tharp's System Quality Number.
  **It is only meaningful with n ≥ 30 trades** — below that, both the mean R
  and its standard deviation are too noisy for the ratio to say much, and
  early values should be shown with a visible caveat, not as a confident
  score.
- **`expectancyMoney = winRate × averageWin − (1 − winRate) × averageLoss`**,
  and **`expectancyR`** is built the same way from average WIN/LOSS R
  multiples. **Judgement call:** when there are no losses at all (or no
  wins), the corresponding average is treated as `0` rather than blocking
  the whole calculation — `(1 − winRate)` or `winRate` is exactly `0` in
  that case anyway, so the missing average would be multiplied away
  regardless. `expectancyMoney`/`expectancyR` are only `null` when `winRate`
  itself is `null` (no wins and no losses to build a rate from at all).
- **`payoffRatio = averageWin / averageLoss`**; **`breakevenWinRate =
  1 / (1 + payoffRatio)`** — the win rate this system would need just to
  break even, given how much bigger its average win is than its average
  loss. A genuinely actionable number: a system with a 2:1 payoff ratio only
  needs to win 33.3% of the time to break even.
- **Win/loss streaks skip breakevens entirely** (`longestWinStreak`,
  `longestLossStreak`, `currentStreak`). **Judgement call, one of two
  reasonable choices:** a breakeven neither extends nor breaks a run — e.g.
  `WIN, BREAKEVEN, WIN` counts as a single streak of 2 wins, not two streaks
  of 1. The alternative (a breakeven resets the streak to 0) is equally
  defensible; this module picks "skip" because a scratch trade communicates
  "no real information," not "the streak broke." `currentStreak` is signed:
  positive = current win streak length, negative = current loss streak
  length, `0` if there are no closed win/loss trades yet.

### `equityCurve(rows, startingBalance, balanceEvents)`

Merges closed trades (by `closedAt`) and external balance events into one
chronological list of `{ at, balance, change, kind }` points, running the
balance forward from `startingBalance`. On an exact timestamp tie, trades are
ordered before balance events (an arbitrary but stable, documented choice).

### `drawdownSeries(curve)` and `maxDrawdown(curve)`

**Judgement call: a deposit never sets a new high-water mark (peak).**
Capital injected via deposit is not trading performance, so it shouldn't
reset what counts as "a new high" for drawdown purposes. Concretely: when
iterating the curve, only non-`DEPOSIT` points are allowed to raise `peak`;
`drawdown = max(peak − balance, 0)`. One visible side effect, tested
explicitly: the drawdown reading *at* a deposit point can read `0` (floored)
even though `peak` itself didn't move, because the deposit-inflated balance
can exceed the stale peak. The very next non-deposit point (a trade,
withdrawal, or adjustment) resumes comparing against that same stale peak;
if its balance — which naturally includes the deposited cash — exceeds it,
peak updates normally right there. This keeps the rule simple (one `if` per
point) while still preventing a deposit from manufacturing a fake "all-time
high" purely out of injected cash.

`maxDrawdown` walks the drawdown series to find the single worst episode and
reports `peakAt` (when the high-water mark it fell from was set),
`troughAt` (the worst point), `recoveredAt` (the first later point whose
balance returns to/above that peak value, or `null` if not yet recovered),
and `lengthDays` (`peakAt` → `recoveredAt`, `null` while unrecovered — an
open drawdown has no defined length yet).

**Worked example** (see `aggregate.test.ts` for the full hand-computed
8-point curve): starting balance `10000`; trades of `+500, −1200, +300` bring
the balance to `9600` (drawdown `900` off a `10500` peak); a `+2000` deposit
lands at `11600` but does **not** raise the peak past `10500`; trades of
`−800, −1500, +1000, +600` follow. The `−800` trade brings the balance to
`10800`, which *does* set a new peak (since it's a trade, not the deposit
itself); the `−1500` trade then drops to `9300` — the worst point, a drawdown
of `1500` (`13.89%`) off that `10800` peak — and the final `+1000, +600`
trades recover past `10800`, closing the episode after 3 days.

### `groupBy(rows, keyFn)`

A thin `Map`-building wrapper around `summarize` — the single building block
behind pair/session/tag/weekday/hour breakdowns, so every breakdown gets the
exact same win-rate/expectancy/streak logic instead of a re-implementation
per screen.

### `rDistribution(rows, bucketSize = 0.5)`

Buckets R multiples into fixed-width `[from, to)` ranges covering the
observed min/max (the final bucket is `[from, to]`, inclusive of the
maximum), plus one dedicated bucket (`from: null, to: null`) for rows with no
stop loss at all. Keeping "no R" as its own bucket rather than dropping those
trades (or lumping them into bucket 0) makes it visible how much of the
trade log has no defined risk to analyze.

### `dailyPnl(rows, timeZone)`

Sums `netPnl` per calendar day **as observed in the caller's timezone**, not
UTC — needed for both a daily-loss guard and a calendar heatmap that make
sense to a specific trader. A trade closed at `2026-03-10T17:30:00Z` falls on
`2026-03-10` for a UTC-based user but on `2026-03-11` for a trader in
`Asia/Ulaanbaatar` (UTC+8, `01:30` local the next day) — both are correct,
they're just different users' calendars.

## Worked example (end to end)

EURUSD long, entry `1.0850`, stop `1.0800`, exit `1.0950`, 1.0 lot,
`$12` commission, standard `pipSize = 0.0001`, `contractSize = 100000`:

```
pips        = (1.0950 − 1.0850) / 0.0001        = 100
pipValue    = 0.0001 × 100000                    = 10   (USD per lot)
grossPnl    = 100 × 10 × 1                       = 1000
netPnl      = 1000 − 12                          = 988
riskPips    = |1.0850 − 1.0800| / 0.0001         = 50
riskAmount  = 50 × 10 × 1                        = 500
rMultiple   = 988 / 500                          = 1.976
plannedRR   = |1.0950 − 1.0850| / |1.0800 − 1.0850| (=100/50) = 2
outcome     = WIN   (netPnl = 988 ≥ 0.005)
```

Without the `$12` commission this trade would have been a clean `R = 2.00` —
exactly matching its `2:1` planned reward:risk. The commission is what pulls
realised R (`1.976`) slightly below planned R (`2.00`), which is exactly the
gap `summarize()`'s `expectancy`/`payoffRatio` numbers are meant to surface
in aggregate: real trading costs quietly erode a plan that looks perfect on
paper.
