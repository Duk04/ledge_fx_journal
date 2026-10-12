# Simulate and position size

Owns: `src/lib/simulate/` (pure), `src/components/simulate/`,
`src/components/calculator/`, `/simulate`, `/calculator`.

Exploration tools over your own results. Nothing here writes to the journal,
and the simulators run on plain numbers in the browser (like
`src/lib/backtest`): they recompute on every toggle, and their outputs are
estimates to think with, not stored figures.

## What if (`what-if.ts`)

Replays every CLOSED trade in the account (all time — a what-if over thirty
days is too few trades to mean anything) under rules you didn't follow:

- **Cap every loss at −1R / −1.5R / −2R** — a loss worse than the cap is
  replaced by exactly the cap, in money by that trade's own risk amount.
  Trades without a stop have no R and are left alone.
- **Leave out** weekdays, sessions, symbols, tags, or every trade where you
  didn't follow your plan.
- **Size every trade at X%** of the running balance, compounding. This needs
  R, so trades without a stop drop out of that scenario (the page says how
  many).

Order: leave-outs, then the cap, then re-sizing. The curve is over trade
number, not time — a sequence of outcomes makes no timing claim.

## Monte Carlo (`monte-carlo.ts`)

1,000 runs, each drawing trades with replacement from your own R multiples
(trades with a stop), sized at a fixed percent of the running balance,
starting from today's balance (deposits included). Reports final-balance
percentiles, typical and 95th-percentile max drawdown, the chance of a
drawdown you name, and the chance of finishing down. Seeded (mulberry32), so
the same inputs give the same picture.

It assumes your past distribution of R holds. It answers "how much of my
curve could have been sequence luck" and "how deep a drawdown should this
edge at this size expect" — not "what will happen".

## Position size (`position-size.ts`)

`lots = budget / (|entry − stop| / pipSize × pipValuePerLot)`, through the
journal's own pip-value formula and conversion rules (`lib/conversion.ts`),
so the recorded risk of a trade taken at the suggested size equals the
budget. Rounded **down** to 0.01 lots. Warns before the trade about what the
risk guard would flag after it: risk over 1.5× the account's per-trade rule,
a full loss larger than today's remaining challenge allowance, and a cross
whose conversion rate the price can't imply.
