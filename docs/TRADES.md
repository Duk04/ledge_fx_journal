# Trades feature reference

Source: `src/app/(app)/trades/**`, `src/components/trades/**`,
`src/lib/{queries,actions,schemas}/trade{,s}.ts`. This is the narrative
reference for decisions that aren't obvious from the code alone.

## URL contract for `/trades`

The list page's filters, sort and pagination live entirely in the URL —
never in component state that would vanish on reload. Every param is
optional; an absent param means "no filter" / the stated default.

| Param | Values | Default | Notes |
|---|---|---|---|
| `q` | free text | — | Matched against `symbol` and `notes`, case-insensitive. Debounced 250ms client-side before it hits the URL. |
| `symbols` | comma-separated symbols, e.g. `EURUSD,XAUUSD` | — | |
| `directions` | comma-separated `LONG,SHORT` | — | |
| `outcome` | one of `WIN`, `LOSS`, `BREAKEVEN`, `OPEN` | — (all) | Singular, not plural — the filter bar's Segmented control is single-select even though the query layer (`TradeFilters.outcomes`) accepts an array, for a future multi-select. |
| `tags` | comma-separated tag ids | — | |
| `range` | `7d`, `30d`, `90d`, `ytd`, `all`, `custom` | `all` | Relative ranges (`7d`/`30d`/`90d`/`ytd`) are resolved against **the current moment on every request** — a bookmarked "last 7 days" link always means the last 7 days from whenever it's opened, not a frozen window. Only `custom` carries fixed dates. |
| `from`, `to` | `YYYY-MM-DD` | — | Only read when `range=custom`. `to` is treated as end-of-day. |
| `followedPlan` | `yes`, `no` | — (any) | Tri-state discipline filter. |
| `sort` | `openedAt`, `closedAt`, `netPnl`, `rMultiple`, `pips`, `symbol`, `volumeLots` | `openedAt` | Every value here is a real Prisma field name on `Trade`, so the query layer maps it straight into `orderBy` with no translation table to keep in sync. |
| `dir` | `asc`, `desc` | `desc` | |
| `page` | 1-based integer | `1` | Reset to `1` whenever any filter or sort changes — a stale page number after narrowing a filter would silently show "no rows" instead of the match. |
| `pageSize` | `25`, `50`, `100` | `50` | |

Any filter change (via the filter bar) or sort change (via a column header)
clears `page` for the reason above. Pagination itself only ever touches
`page`/`pageSize`.

This contract is why `page.tsx` is a Server Component that reads
`searchParams` directly rather than fetching client-side: the URL is the
single source of truth, so the same link always renders the same table for
every viewer, and a reload never loses the view you were looking at.

## The derived-columns rule

`netPnl`, `grossPnl`, `pips`, `rMultiple`, `riskAmount`, `holdingMinutes` and
`marketSession` are never computed inline in this feature. Every write path
(`createTrade`, `updateTrade`, `closeTrade`, `closeRTrade`, and — deliberately
NOT — `duplicateTrade` of a PRICE trade, which starts a fresh OPEN trade with
no derived numbers to carry over; an R-mode duplicate does call it, because
its risk is known before anything happens) calls `derivedColumns()` from `src/lib/trade-service.ts`, which
is the one shared place that turns raw trade facts into analytics. Reads
follow the same rule: `listTrades`/`tradeStats` use the **stored** columns
(via `toTradeRow`), and `getTrade` additionally runs a **fresh recompute**
purely to compare against what's stored (see "Disagreement detection"
below) — it never substitutes the recompute for the stored value in a list
or a stat.

### `NEW_YORK` vs `NEWYORK` (fixed)

`metrics/session.ts` classifies the New York session as `'NEW_YORK'`, while
the stored enum value is `NEWYORK`. This doc used to describe a
`normaliseMarketSession` workaround in `src/lib/actions/trades.ts`; the real
fix landed instead: `prisma/schema.prisma` declares
`NEW_YORK @map("NEWYORK")`, so `derivedColumns()` passes the metrics value
straight through and Prisma maps it at the boundary. The workaround is gone.

## R-mode trades

The trade form logs new trades **in R, not prices** (`Trade.entryMode =
R_MULTIPLE`). The trader enters:

- **Risk amount** — money at risk in the account currency. Required: it is
  what turns R into P&L.
- **Planned R:R** — optional, e.g. `2.5` for a target at 1 : 2.5.
- **No lot size.** Nothing in R mode is computed from size, so the form
  does not ask for it. The column stays nullable rather than going away:
  imported and backtest PRICE trades still carry their lots.
- On close, an **Outcome**: Win (R = the planned R:R), Loss (−1R),
  Breakeven (0R) or Custom (a partial, or a gap through the stop). The
  buttons only fill the **Result** field; the R stored is whatever it holds.

`computeRTrade()` (`src/lib/metrics/trade.ts`) derives the stored columns:
`rMultiple = resultR` as entered, `grossPnl = resultR × plannedRisk`,
`netPnl = grossPnl − commission − swap`, `riskAmount = plannedRisk`,
`pips = null`. It runs through the same `derivedColumns()` as a price trade,
so the recompute, backfill and restore paths all keep the R the trader
typed instead of re-deriving it from prices the trade never had.

What an R-mode trade does **not** have: entry/exit/stop/target prices,
executions (fills), pips, MAE/MFE, the price ladder, or geometry warnings.
The detail page hides those, the close dialog asks for an outcome instead of
an exit price (`closeRTrade`), and the fills actions refuse the trade.

Why prices stay at all: statement imports and backtests still produce PRICE
trades with fills, and every trade logged before R mode is one. A trade
never changes mode — `updateTrade` parses the form the stored mode implies,
whatever the POST claims. The database enforces the per-mode requirements
with a CHECK (`trades_entry_mode_fields_check`): a PRICE row needs
`entryPrice` and `volumeLots`, an R_MULTIPLE row needs `plannedRisk`.

"No stop" counts and the risk guard ask `hasDefinedRisk()`
(`trade-service.ts`) rather than reading `stopLoss`: an R-mode trade always
has defined risk, so it is never flagged as naked.

## Executions (fills), scaling in, partial closes

A trade is built from `Execution` rows: ENTRY fills (the open, and any
scale-ins) and EXIT fills (a partial close, the final close). Every OPEN or
CLOSED trade has at least one ENTRY; a CANCELLED order never filled and has
none. The fills are the source of truth. The trade row's `entryPrice`,
`exitPrice`, `volumeLots`, `openedAt`, `closedAt` and `status` are their
aggregate — volume-weighted prices, total size, first entry, last exit —
written only by `syncTradeFromFills` (`src/lib/actions/fills-store.ts`), and
then the derived columns are recomputed through the same trade-service path
as any other write. `src/lib/metrics/fills.ts` explains why the aggregate is
exact rather than an approximation for a fully closed trade.

Where fills are created and changed:

- **Import / backtest / duplicate of a PRICE trade**: one ENTRY (and one
  EXIT if closed) — what a one-shot trade stands for. A trade logged through
  the form is R-mode and has no fills at all (see above).
- **Close trade** (detail page): adds an EXIT. The dialog's "Lots to close"
  defaults to everything open; fewer is a partial close.
- **Fills panel** (detail page): add an ENTRY (scale in) or EXIT, or remove a
  fill. The only ENTRY cannot be removed — delete the trade instead.
- **Edit form**: for a trade with one entry and at most one exit, editing
  prices/size/times replaces its fills. With more fills than that the form
  cannot describe the trade, so those fields are read-only (and the update
  action ignores them even if posted — it is an endpoint).

**A partly closed trade stays OPEN with no P&L.** Realised P&L on the closed
part is well defined (average cost), but nothing downstream — stats, equity,
the risk guard — has a notion of part of a trade being closed, and a number
that only some reports honour is worse than none. It is reported, in full,
when the last lot closes.

## Screenshots

Every trade can carry chart screenshots. Each one is tagged **Before**, **After** or **Other**. You can drop a file, pick one, or paste it with Ctrl/⌘+V. Paste is how a chart usually leaves MT5 or TradingView, so it works anywhere on the page.

- **While logging a trade** (`/trades/new`), the Screenshots panel holds the files in the browser (`PendingScreenshots`).
  - Each one starts as Before, because a chart picked while logging is usually the setup.
  - They are uploaded one by one right after `createTrade` returns the new trade's id. An attachment belongs to a trade, and the upload route checks that the trade is yours, so there is nothing to upload to until the trade is saved.
  - If the trade never saves, nothing is sent.
  - If an upload fails, the trade is still saved. The toast says how many screenshots are missing, and they can be added on the trade page.
- **On a saved trade**, the detail page and the edit page carry the full uploader (`AttachmentUploader`). It can add files or an https link, change the kind, edit the caption and delete.
  - On the edit page the uploader sits beside the form, not inside it. Each change saves on its own and does not wait for the form's Save.
- **Where the bytes live.** Uploaded bytes are stored under `.uploads/` or S3 (`lib/storage.ts`), never in `public/`. They are served only by `GET /api/attachments/[id]`, which re-checks ownership on every request.
- **Checks.** The browser checks the type and the 8MB limit first (`attachment-files.ts`). The server checks again by sniffing the bytes.

## Why geometry problems are warnings, not errors

`validateTradeGeometry()` (from `src/lib/metrics`) flags things like a long
stop above its entry, or a closed-before-opened timestamp. The trade form
runs it live and shows whatever it finds inline, in warn tone, next to the
relevant fields — but it never blocks `Save`, and `parseTradeForm()` never
turns a geometry problem into a hard validation (`fieldErrors`) failure.

This is deliberate: a journal's job is to hold what actually happened, and a
real trading history is full of trades that don't look like a clean plan —
a stop moved mid-trade, a partial fill, a broker statement imported after
the fact with an already-invalid price relationship. Refusing to save those
would make the tool useless for exactly the trades most worth reviewing. The
six fields that ARE hard-required on a PRICE trade (`symbol`, `direction`,
`volumeLots`, `entryPrice`, `openedAt`, and `exitPrice`+`closedAt` together
when `status = CLOSED`) are the minimum needed to compute anything at all;
every other check is advisory. An R-mode trade's equivalent is `symbol`,
`direction`, `openedAt`, `plannedRisk`, and `resultR`+`closedAt` when
closed — and it has no geometry to warn about.

## The two empty states on `/trades`

The trade list distinguishes:

- **No trades at all** (`total === 0` and no filter is active) — "No trades
  logged yet", with a primary "Log your first trade" call to action. This is
  a brand-new account.
- **No trades match these filters** (`total === 0` and at least one filter
  is active) — "No trades match these filters", with a "Clear filters"
  link back to the bare `/trades` URL.

Collapsing these into one generic "No trades" message is the difference
between a tool that feels finished and one that doesn't: the first case
needs encouragement to start, the second needs an easy way out of a filter
combination that's too narrow. `filtersActive` is computed the same way
(and from the same URL params) in both `page.tsx` (to choose the empty
state) and `filter-bar.tsx` (to decide whether to show its own "Clear"
button) — see the `FILTER_KEYS` list in `filter-bar.tsx`.

## Disagreement detection (trade detail page)

`getTrade()` always recomputes `computeTrade()` from the trade's raw fields
(price, volume, commission, swap, timestamps) in addition to reading the
stored derived columns. If the two disagree by more than a cent (money) or
0.01 (pips/R) — `hasDisagreement` — the detail page shows a warn-tone strip
and the facts panel shows the fresh value in parentheses next to the stored
one. This exists to catch exactly one class of bug: a formula change in
`src/lib/metrics` that ran a backfill against some rows but not others, or a
direct database edit that bypassed `derivedColumns()`. The fix is always the
same — re-run the metrics backfill (`npm run backfill`) — which is why the
strip says so directly rather than describing the mechanism.

## Tag/trade id format

The trade form's `tagIds` are validated as "looks like an id"
(`[a-zA-Z0-9_-]{1,64}`) rather than a strict UUID/CUID pattern. `prisma/seed.ts`
gives every seeded row a fixed, human-readable id (e.g.
`seed-tag-ob-retest`) specifically so re-seeding is reproducible — Prisma's
`id` columns are plain `String`, not a generated-format constraint, so a
strict format check would reject perfectly real rows from this app's own
fixtures.
