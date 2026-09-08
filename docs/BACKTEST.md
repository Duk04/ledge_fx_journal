# Backtest UI — reference

Covers the four routes and the two write paths owned by this agent:
`/backtest`, `/backtest/replay`, `/backtest/strategies`, `/backtest/runs/[id]`,
and `src/lib/actions/{backtests,strategies}.ts`. The simulation core these
build on (`src/lib/backtest/`) is documented separately in
`docs/BACKTEST-ENGINE.md` — read that first if you haven't; this doc assumes
the fill model and the no-lookahead guarantee it describes.

## The one design decision everything else follows

**A backtest's trades are ordinary `Trade` rows, in a `TradingAccount` whose
`accountType` is `BACKTEST`, tagged with `backtestRunId`.** Nothing about
`/analytics`, the equity curve, the R-distribution, the session heatmap, or
the trade table had to change to work on a backtest — they already worked on
"a `TradingAccount`'s trades", and a backtest account is exactly that. The
"View in Analytics" button on a run's results page is the whole integration:
it switches the account cookie to that run's account (the same server action
the account switcher itself uses — see `src/lib/actions/accounts.ts`'s
`setActiveAccount`) and navigates to `/analytics`. Every report there just
works.

The corollary: a BACKTEST account's numbers must never leak into a real
account's statistics, and they don't, structurally — a backtest run creates
its *own* fresh `TradingAccount`, one per run, never reuses a live one.
Deleting a run deletes its trades (FK cascade from `Trade.backtestRunId`)
and, once nothing else references it, its account too.

## Who computes a run's trades, and why that is acceptable

**Both kinds of run are computed in the browser.** Manual replay always was:
you click through bars and the client works out each fill using the same
`entryPrice`/`exitOnBar`/`closeAtPrice` primitives the engine uses, then
posts the finished trade to `recordReplayTrade`. Coded strategy runs now work
the same way: the strategy is compiled and executed in a Web Worker
(`src/lib/backtest/worker.ts`) and `recordStrategyRun` receives the resulting
trades.

That moved because the alternative was worse. Running author-supplied
JavaScript on the server is remote code execution, and it cannot be fixed by
hardening the sandbox — see BACKTEST-ENGINE.md for the three verified escapes,
one of which reaches `Function` from a bare string literal. The browser is
where that code's blast radius is the author's own tab.

### What follows: a user can fabricate their own backtest results

Nothing stops a caller posting any trades it likes. This is accepted, and
here is the whole argument so it can be re-judged rather than re-derived:

1. The rows land in a **fresh `TradingAccount` with `accountType: BACKTEST`,
   created per run and owned by the posting user**.
2. **Every read path in this app is scoped by `userId`** — all seven query
   modules and all five route handlers. There is no leaderboard, no public
   share link, no cross-user aggregate anywhere.
3. So a fabricated backtest is a user lying to themselves in their own
   private ledger, which they could already do by typing a trade in by hand.

What is *not* trusted, even so. `recordStrategyRun` recomputes win rate,
expectancy, the equity curve and drawdown from the posted trades using the
same `summarize()`/`equityCurve()`/`maxDrawdown()` the rest of the app uses,
and never accepts a statistics blob. It re-derives the currency conversion
rate — one number that scales every P&L figure in the run — from the last
stored bar. It caps the trade array. And it checks strategy ownership.

### The tripwire

> **If a shared, public, or comparative view of backtest results is ever
> added — a leaderboard, a shared strategy library showing performance, a
> "top strategies this week" panel, or any report that puts one user's run
> next to another's — the argument above collapses, because the fabricated
> number would then be making a claim to someone else.** At that point the
> simulation has to move somewhere trustworthy: a real isolate, a separate
> no-network container, or a constrained strategy DSL the server can evaluate
> itself. Do not add such a view and leave this as it is.

## Running a replay

`/backtest/replay` with no `?runId` shows a setup form: symbol, timeframe,
date range (defaulted from what's actually stored, via `listCoverage()`),
initial balance, and the fill settings below. Submitting calls
`createReplayRun()`, which opens the BACKTEST account + `BacktestRun` row
(status `DRAFT`, kind `REPLAY`) and redirects to `/backtest/replay?runId=…`.

From there the session is driven entirely in the browser
(`components/backtest/replay/use-replay-engine.ts`): bars only exist on the
chart up to the current cursor — **not hidden, not fetched** — the chart is
handed `bars.slice(0, cursor + 1)` and nothing past that index is ever in
scope. That's the same guarantee `runBacktest()`'s `Object.freeze(bars.slice(0,
i + 1))` gives a strategy; replay's whole value collapses if the chart can
show you the future.

Placing a trade (Buy/Sell, with optional stop/target) queues an order that
fills at the *next* bar's open — never the bar you clicked on — and once a
position is open, `exitOnBar()` (imported straight from `src/lib/backtest/fill.ts`,
never reimplemented) decides every stop/target hit as bars advance, with the
exact same spread/slippage/gap rules a strategy run gets. Every trade the moment
it closes is persisted via `recordReplayTrade()`, so a session that's
interrupted has already saved everything up to that point. "Save to journal"
force-closes any still-open position at the current bar (mirroring the
engine's own `END_OF_DATA` handling) and takes you to the run's results page.

Keyboard: `Space` play/pause, `→` step forward, `←` step back (only while
flat — see the code comment on why rewinding is "review", not "undo"), `B`
buy, `S` sell. The shortcut row lives in the chart panel's header.

## Writing a strategy

`/backtest/strategies` is a list of saved strategies plus an editor: a plain
`<textarea>`, three one-click templates (EMA cross, RSI mean-reversion,
London breakout — the exact `EXAMPLE_STRATEGIES` from `sandbox.ts`), a
parameter form generated from whatever the code's `params` object declares
(a number becomes a number field, a boolean a switch, anything else text —
there is no separate parameter schema, the defaults object *is* the schema),
and the strategy API reference next to the editor so a first strategy
doesn't need this doc open in another tab.

A worked example — the simplest strategy that does something:

```js
function onBar(ctx) {
  if (ctx.bars.length < 20) return; // not enough history yet

  var closes = ctx.bars.map(function (b) { return b.close; });
  var avg = sma(closes, 20)[ctx.i];
  if (avg === null) return;

  if (!ctx.position && ctx.bar.close > avg) {
    ctx.buy({ lots: 1, stopLoss: ctx.bar.close - 0.0020, reason: "above 20-SMA" });
  } else if (ctx.position && ctx.bar.close < avg) {
    ctx.close("back below 20-SMA");
  }
}
```

Saving (`createStrategy`/`updateStrategy` in `src/lib/actions/strategies.ts`)
**parses** the code first — `checkStrategySyntax()` in
`src/lib/backtest/strategy-source.ts` — so a syntax error is caught
immediately, not three minutes later when a run form is submitted. It parses
rather than compiling-and-running, which is the distinction the whole
security fix rests on: `new Function(body)` compiles `body` and hands back a
function; it does not call it, and nothing here calls the result. A
`process.exit()` at the top level of a saved strategy therefore does nothing
on the server.

The one check that genuinely cannot be made without executing the source is
"does this define a top-level `onBar`?" — the declaration only exists once
the body has run. That moved to the workbench, which compiles in its Web
Worker before submitting, so the author still learns about it at edit time.

Running does not require saving first: the run form runs whatever is in the
editor. `recordStrategyRun` takes `strategyId` only to attribute the run,
and only when the editor matches the saved copy — an ad-hoc run that was
never saved has no strategy to link back to, which is the one gap this leaves.
Save it first if you want the run's results page to remember which strategy
produced it. Note the server no longer needs the code at all, since it does
not run it; it is sent to the worker and nowhere else.

## The fill settings, and how to choose them

These are the same four knobs on both a replay and a strategy run, because
they mean the same thing to the same fill model (`src/lib/backtest/fill.ts`):

- **Spread (points)** — charged half against you on entry, half on exit, so
  a round trip pays it once. Look up your broker's typical spread for the
  pair and session you're testing; 0 is never realistic.
- **Slippage (points)** — extra adverse movement applied to *every* fill,
  entry and exit alike. Higher for news-driven pairs or thin liquidity
  hours; the engine never applies "good" slippage.
- **Commission (per lot, per side)** — a round trip pays it twice. Use
  whatever your broker actually charges, in account-currency units.
- **Pessimistic fills** — when one bar's range contains both the stop and
  the target, this decides which "won." Leave it on. Turning it off is a
  sensitivity check ("how much of my edge depends on optimistic same-bar
  ordering?"), never the number to trust — see
  `docs/BACKTEST-ENGINE.md`'s "how to tell if your backtest is lying to
  you" for the full reasoning.

A run's conversion rate (quote currency → the BACKTEST account's USD) is not
a form field: it's resolved once per run from the last bar's close (see
`resolveRunConversionRate` in `actions/backtests.ts`), the same
identity/inverse-price logic the live journal uses per trade
(`resolveConversion`), just pinned to one number for the whole run because
the fill model only has one slot for it.

## Limits of backtesting — read this before trusting a green result

- **One position at a time.** No pyramiding, no hedging, no scaling in or
  out. A strategy that wants any of those needs a different engine, not a
  setting on this one.
- **No partial fills.** An order fills for its full requested size, or (on
  the last bar) not at all. Real liquidity can be thinner than that.
- **No requotes, no rejected orders.** Every order you place is assumed to
  reach the market. A broker that requotes or rejects during volatility
  will do worse than this simulation shows.
- **Bar data hides the intrabar path.** OHLC bars cannot tell you whether
  the stop or the target was touched first when a bar's range holds both —
  `pessimisticFills` is a documented assumption standing in for information
  that plain candle data does not contain. The finer your bars relative to
  your stop distance, the less this matters; a wide stop tested on H4 bars
  is guessing more than it looks like.
- **A strategy tuned until it looks good on one range is curve-fitted, not
  validated.** If you adjusted parameters repeatedly against the same
  symbol/timeframe/date range until the equity curve turned green, you have
  measured how well the strategy memorizes that specific history, not
  whether it has an edge. Test on a range you didn't tune against, and
  expect the result to be worse — if it collapses entirely, the original
  result was noise.
- **Replay adds a second kind of hindsight risk that a strategy run
  doesn't have**: a person, unlike code, knows in general terms *how the
  chart eventually turns out* the second time they replay a familiar range.
  Treat a replay session's results as practice, not proof.

None of this means a backtest is worthless — it means a backtest answers
"is this idea's logic sound against realistic costs," not "will this make
money." Believing the second thing because the first one came back positive
is the actual failure mode this whole engine is built to make harder to fall
into by accident.
