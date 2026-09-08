# Backtest engine — the fill model, the loop, and how to tell if it's lying

Source: `src/lib/backtest/`. This is the simulation core — what `src/lib/metrics`
is to the live journal, `src/lib/backtest` is to the strategy tester. It is
plain-number arithmetic on purpose (see "Numbers, not Decimal" below), and it
hands off to the journal's Decimal-based `computeTrade()` machinery only once
a trade is *finished* — see `toJournalTrade()`.

The one idea that organizes every design decision in this module: **a
backtest doesn't usually fail by getting the math wrong. It fails by
assuming a friendlier market than the one that actually exists.** Every
fill-model default below is the pessimistic one, on purpose, and every
"convenient" shortcut a naive backtester takes is called out by name.

## Numbers, not Decimal

`src/lib/metrics` computes on `Decimal` because a journal handles dozens of
trades and correctness to the last cent matters more than speed. A backtest
walks hundreds of thousands to millions of bars; `Decimal` arithmetic at that
volume is unacceptably slow, and pip-level rounding does not accumulate
across a single unrelated trade the way currency rounding must. So `src/lib/backtest`
uses plain `number` throughout (see `types.ts`'s module doc) and crosses back
into `Decimal`-land only at the boundary where a run is finished and there
are, again, just dozens of trades: `toJournalTrade()` in `runner.ts`.

This is not "so the numbers might drift" — `fill.test.ts` has a dedicated
"agreement with computeTrade()" test that runs a simulated trade through the
*actual* `computeTrade()` from the metrics module and asserts the same
netPnl/pips/rMultiple come out. The two implementations are independent by
necessity (float vs Decimal, millions of bars vs dozens of trades) but must
never disagree about what a trade is worth.

## The fill model (`fill.ts`)

Bars are OHLC only — no bid/ask. This module treats a bar's OHLC series as
the **mid price** and applies the spread symmetrically: half against the
trader on entry, half against the trader on exit. A full round trip pays the
whole spread exactly once, however the trade's two legs land on different
bars — the same convention a charting feed that only stores mid candles
implies about how a broker actually filled you.

### 1. Entries fill at the NEXT bar's open — never the signal bar's close

`entryPrice(bar, side, fill, instrument)` takes whatever bar the *caller*
decides is next; it has no notion of "the bar after the signal" itself. The
only caller is `runner.ts`, and it always passes bar `i + 1` for an order
requested on bar `i`.

This is the single most common way a backtest lies. If a strategy sees bar
`i`'s close and is allowed to buy at that same close, it is trading on
information it could not have had in real time — the bar hadn't finished
yet. Every "the results look too good" backtest bug report ends up here.

On top of the next-bar open, `entryPrice` adds:
- **Half the spread, against the trader**: a long pays the ask
  (`open + spread/2`), a short receives the bid (`open - spread/2`).
- **Slippage, against the trader**: `FillModel.slippagePoints` is applied in
  the same adverse direction as the spread. There is no "good slippage" in
  this model, by design — see `FillModel`'s doc in `types.ts`.

Closing a position at market (`exitAtMarket`, used by `ctx.close()` and the
end-of-data close) is the same operation with the side flipped: selling to
close a long crosses the spread exactly like buying to open a short would.
One function, `crossSpread`, is the single place spread+slippage arithmetic
happens; `entryPrice` and `exitAtMarket` are both thin wrappers around it.

### 2. A gap through the stop fills at the bar's OPEN, not the stop price

This is the second most common lie. If a bar's relevant side (bid for a
long, ask for a short) has already passed the stop/target level *before the
bar starts*, there was no liquidity sitting at that price to fill against —
that is what a gap is. `exitOnBar()` checks this explicitly: if the bar's
open (adjusted for spread) is already through the level, the fill is at that
open, not at the clean stop/target price. This is checked for both the stop
and the take-profit side, even though getting the take-profit side "wrong"
is the friendlier direction — consistency mattered more than only catching
the case that hurts.

### 3. Spread applies on exit too

A long position is closed by **selling**, i.e. at the bid — so its stop and
target are checked against `bid(bar.high)` / `bid(bar.low)`, not the raw
bar prices. A short is closed by buying, at the ask. Skipping this
adjustment is a subtle way to simultaneously understate losses (a stop that
"technically" wasn't touched by the raw price, but was touched once the
spread is priced in) and overstate wins (a target that looks reached on the
raw high but wasn't, once the bid is taken). `fill.test.ts` has a dedicated
case constructing a bar whose raw low sits *above* the stop but whose
bid-adjusted low sits below it.

### 4. Both levels in one bar: `pessimisticFills`

OHLC data cannot tell you the true intra-bar path. If a bar's range contains
both the stop and the target, nobody knows which was actually touched first.
`FillModel.pessimisticFills` (default `true`) decides: true assumes the
stop — the honest default, because assuming the target inflates every
result that depends on it. Setting it to `false` is available for the
optimistic side of a sensitivity check, not as something to leave on.

### Turning a fill into a trade (`closeAtPrice`)

Mirrors `src/lib/metrics/trade.ts` exactly:
- `pips` — same signed-delta-over-pipSize convention as `computePips`.
- `grossPnl = pips × pipValuePerLot × lots`, where
  `pipValuePerLot = pipSize × contractSize × conversionRate` — identical
  formula to `pipValuePerLot()` in the metrics module.
- `commission` is charged **per lot, per side**: a round trip pays
  `2 × lots × commissionPerLot`, not once.
- `netPnl = grossPnl - commission` (there is no swap concept in the sim).
- `riskAmount` excludes commission (same reasoning as `computeRiskAmount`:
  risk is what the trader planned against, not incidental costs), and is
  `null` when there is no stop.
- `rMultiple = netPnl / riskAmount`, `null` when `riskAmount` is `null` OR
  zero (entry == stop) — the same null semantics as `computeRMultiple`.

## The loop (`runner.ts`)

`runBacktest(bars, strategy, config)` walks bars oldest to newest and, per
bar, does exactly this, in this order:

1. **Fill a pending entry order** from the previous bar, at this bar's open.
2. **Fill a pending close** (from `ctx.close()` on the previous bar), at this
   bar's open.
3. **Check the (possibly just-filled) open position against this bar's
   range** for a stop/target hit — `exitOnBar`.
4. **Run the strategy** on a view of the bars that ends at this one.

### The no-lookahead guarantee

On bar `i`, the strategy is handed `Object.freeze(bars.slice(0, i + 1))` —
never the full array with an index it could choose to ignore. This means
`ctx.bars[ctx.i + 1]` is not just conventionally off-limits, it is *actually*
`undefined` at runtime: there is no way for strategy code, malicious or
merely buggy, to read a bar that hasn't "happened" yet. `runner.test.ts`
asserts this directly rather than trusting the description.

The trade-off: slicing the array on every bar is an `O(n)` allocation per
bar (`O(n²)` over a full run). This is a deliberate choice — correctness
over cleverness — and it is bounded by `timeoutMs` and a hard bar cap
(`HARD_BAR_CAP`, 1,000,000 bars) rather than optimized away, since the
straightforward, obviously-correct implementation is exactly what a
"never let the strategy see the future" guarantee should look like.

### Fill timing

An order requested on bar `i` (`ctx.buy` / `ctx.sell` / `ctx.close`) fills at
bar `i + 1`'s open — never sooner. An order requested on the **last** bar
never fills: there is no bar `i + 1` for it to fill against. This is not a
bug; it mirrors real trading, where you cannot fill an order against a bar
that has not happened.

### Exit before signal

Step 3 above runs before step 4 on every bar, including the bar a position
was *just filled on* in step 1. This means a position that fills at a bar's
open can still be stopped out by that same bar's range — which is correct
(if you enter at the open and price immediately reverses hard enough to hit
a tight stop, you get stopped out, same bar) — but a *new* signal from the
strategy can never fire before an existing exit is resolved. An exit always
precedes a new entry on the same bar, never the reverse.

### One position at a time

This engine tracks a single open position. A `buy()`/`sell()` call while a
position is already open is silently ignored (not queued, not an error).
Pyramiding, scaling in/out, and hedging multiple simultaneous positions are
out of scope — a strategy wanting any of those needs a different engine, not
a flag on this one. This keeps the fill model, the equity accounting, and
the one-trade-per-close journal mapping (`toJournalTrade`) unambiguous.

### End of data

Anything still open when the run stops — ran out of bars, hit the bar cap,
timed out, or the strategy threw — is force-closed at the last bar actually
processed, with `exitReason: "END_OF_DATA"`. The close price is a real
market-crossing exit (`exitAtMarket` against that bar's close), not the raw
close — an open position doesn't get to skip paying the spread just because
the data ran out.

### `ctx.equity` vs `ctx.balance`

`ctx.balance` is the last *realized* balance — it only changes when a trade
closes. `ctx.equity` is mark-to-market: balance plus the unrealized P&L of
any open position, priced as if closed at market on the current bar's close.
A strategy that wants to size a new position off "how much do I actually
have right now, including this floating position" should read `ctx.equity`;
one that wants "what did my last closed trade leave me with" should read
`ctx.balance`. The `equity` **series** returned in `BacktestResult`, by
contrast, is coarser: one point per *closed trade* (plus a seed point at the
initial balance) — see `BacktestResult.equity`'s doc in `types.ts`.

### Timeouts and the hard bar cap

`timeoutMs` (default 10,000ms) is checked once per bar, between bars. This
catches a strategy that is merely slow (e.g. recomputing an indicator over
the whole history every bar). It **cannot** catch a strategy whose `onBar`
itself never returns — a true infinite loop — because that runs on the same
synchronous JS thread as the check. That is exactly what `worker.ts`
running strategies inside a Web Worker is for: a worker can be
`terminate()`d from the outside regardless of what its code is doing, and
`use-strategy-runner.ts` does so after 30 seconds. Note this is now the only
place that protection exists — the server no longer runs strategy code, so
these caps guard the author's own tab rather than a shared process. The
`HARD_BAR_CAP` (1,000,000 bars) is the second line of defence for
`runBacktest()` called directly, as every test in `runner.test.ts` does.

### Journal handoff (`toJournalTrade`)

`toJournalTrade(simTrade, opts)` converts one finished `SimTrade` into the
exact field set `prisma.trade.create` needs. Every Decimal-backed column
(`entryPrice`, `exitPrice`, `volumeLots`, `commission`, `grossPnl`, `netPnl`,
`pips`, `rMultiple`, `riskAmount`) goes out as a **string** — Prisma's
`Decimal` columns accept string input and a string round-trips exactly,
unlike a JS number, which is exactly the float error the metrics module's
Decimal discipline exists to avoid (see `src/lib/metrics/decimal.ts`'s "MONEY
RULE"). `marketSession()` is imported from `src/lib/metrics` rather than
reimplemented — there is exactly one definition of "what session was this
trade opened in" in this codebase.

## Indicators (`indicators.ts`)

Every indicator returns an array **the same length as its input**, using
`null` to mark the warm-up period. This is not cosmetic: if an indicator
silently returned a shorter array, every later index would line up against
the wrong bar — a look-ahead bug that shows up not as a crash but as
suspiciously good backtest results (the strategy would effectively be
reacting to values computed slightly in its own future). `sma`, `ema`,
`rsi`, `atr`, and `stdev` are seeded and smoothed incrementally (`O(1)` per
bar past the warm-up) rather than re-summing a window every time.
`crossOver`/`crossUnder` are the one exception to the null convention: a
cross is an *event*, not a value, so "not enough data yet" and "no cross
happened" are both correctly reported as `false`, not a third `null` state
that would just invite `if (cross)` bugs.

## The sandbox (`sandbox.ts`) — an honest threat model

**This is a guard against mistakes, not a security boundary against hostile
code.** Read that twice before changing anything here.

That sentence has always been in this file. What changed is the conclusion
drawn from it. This section used to open "the app this belongs to is
single-user", and everything after it followed from that premise. The app is
now deployed publicly with open registration, so the premise is gone — and
with it the argument that the gap was harmless.

### Where the compiler runs, and why that is the whole answer

`compileStrategy()` runs **only in a Web Worker in the author's own browser**
(`src/lib/backtest/worker.ts`), never in a server module. It is not merely
preferred; it is the security boundary, and three things enforce it:

- `src/lib/backtest/index.ts` does not re-export `./sandbox`. That single
  `export *` line was how the compiler reached two server actions without
  either import looking dangerous.
- `src/lib/actions/server-action-surface.test.ts` asserts no `"use server"`
  module reaches `compileStrategy`, and that the barrel stays clean.
- `npm run build` puts the compiler in a client chunk; grepping
  `.next/server` for its strings finds nothing.

### Why hardening the sandbox was never an option

What `compileStrategy()` buys is real: compiling against an explicit list of
named parameters (`Math`, `Number`, `JSON`, the indicator functions, ...)
plus a shadow list (`fetch`, `window`, `globalThis`, `process`, `require`,
...) bound to `undefined` means a typo or an accidentally-pasted line that
tries to hit the network, read the DOM, or import a module fails loudly
instead of silently doing something surprising. And a runaway strategy is
`terminate()`d from the host page — something the server never managed,
because `runBacktest`'s timeout is only checked between bars, so a hang
inside a single `onBar` call pinned the request thread until the platform
gave up.

What it cannot buy, with the actual escapes rather than a hand-wave:

```js
Object.constructor("return process")()    // Object has to be allowed for
                                          // strategies to be writable at all,
                                          // and .constructor IS Function
"".constructor.constructor("return 1")()  // from a bare string literal —
                                          // names nothing we passed in
(0, eval)("...")                          // indirect eval: global scope
```

All three are verified, and `src/lib/backtest/sandbox.test.ts` asserts they
**succeed** — so that nobody reads the allowlist, concludes it is a boundary,
and moves the compiler back onto the server.

The third is the one that settles the question. It reaches `Function` through
a primitive literal, referencing no identifier that any allowlist or shadow
list could cover. There is no version of this approach that closes it.

One correction worth recording, because this file previously got it backwards:
`eval` is absent from the shadow list because strict-mode code cannot bind an
identifier named `eval` at all (attempting it is a `SyntaxError` — a genuine
discovery, made while building this). But *direct* `eval` inherits the
compiled function's scope, so `eval("typeof process")` correctly yields
`"undefined"`. Direct `eval` was never the hole; indirect `eval` and the
`.constructor` routes are.

**Do not repurpose this to run someone else's code**, and do not add shadows
believing they close the hole. It was never built to survive hostile code, and
it cannot be.

### The strategy API, worked example

A strategy is a string of JS defining a top-level `function onBar(ctx) {}`
and, optionally, `function init(ctx) {}`. There is no module system inside
the sandbox — no `import`/`require`/`export` — but ordinary top-level `var`
state persists across bars within one compiled instance, which is how the
London breakout example tracks the opening range across calls:

```js
var rangeHigh = null;
var rangeLow = null;

function onBar(ctx) {
  // ctx.bars: readonly Bar[] up to and including ctx.bar, never beyond.
  // ctx.position: the open SimPosition, or null.
  // ctx.instrument, ctx.params: static config for this run.
  if (someCondition(ctx)) {
    ctx.buy({ lots: 1, stopLoss: ctx.bar.close - 0.001, reason: "breakout" });
  } else if (ctx.position && shouldExit(ctx)) {
    ctx.close("target reached");
  }
}
```

`compileStrategy(code)` throws synchronously if the code fails to parse,
throws during evaluation, or never defines `onBar`. Three real, working
examples ship as `EXAMPLE_STRATEGIES` (EMA cross, RSI mean-reversion with an
ATR stop, London-session breakout) — these are what the UI offers as
templates, and they are exercised against synthetic bars as part of building
this module, not left as untested pseudocode.

## How to tell if your backtest is lying to you

A short, concrete checklist, in the order these usually get caught:

1. **Suspiciously few losing trades, or a suspiciously smooth equity curve.**
   The most common cause is filling at the signal bar's own close instead of
   the next bar's open. Check the fill timestamps against the signal bars.
2. **A strategy with a tight stop that "never" gets stopped out on a fast
   market.** Check whether gaps are being modelled — a stop that always
   fills at its exact price on a 1-minute-bar backtest of a news-driven pair
   is a giveaway that gap-through-stop isn't implemented (or was disabled).
3. **Performance that changes a lot when you flip `pessimisticFills`.** If a
   strategy's profitability depends heavily on which of stop/target "won"
   inside single bars, that strategy is trading a timeframe too coarse for
   its own stop distance — the backtest cannot actually tell you if it
   works, regardless of which way you set the flag.
4. **Zero commission, zero spread, or zero slippage in the config "just to
   see the raw edge."** Fine as a diagnostic step, never as the number you
   trust. Compare it against the same run with realistic costs; if the edge
   evaporates, the strategy's edge was smaller than its transaction costs.
5. **A conversionRate of exactly 1 on a cross pair.** If `quoteCurrency !=`
   the account currency and `conversionRate` was left at the default, every
   number downstream is being reported in the wrong currency, silently.
6. **Any test you'd have to write by comparing two implementations to each
   other, rather than to a hand-computed value.** This is why every
   indicator test in `indicators.test.ts` is checked against arithmetic
   done by hand, not against a second version of the same formula — two
   wrong implementations can agree with each other forever.
