# Journal, Accounts, Settings & Export — reference

Covers the four areas owned by this agent: the trading journal
(`src/app/(app)/journal`), trading accounts (`src/app/(app)/accounts`),
settings (`src/app/(app)/settings`), data export (`src/app/api/export`) and
restore (`src/lib/actions/restore.ts`).

## The calendar's timezone rule

The month calendar and day view bucket trades by **local calendar day in the
user's timezone** (`User.timezone`, e.g. `Asia/Ulaanbaatar`), not by UTC date
and not by the account's currency or the broker's server time. A trade closed
at `2026-08-24T23:30:00Z` lands on August 25th for a user in
`Asia/Ulaanbaatar` (UTC+8) but August 24th for a user in `America/New_York`.

Concretely (`src/lib/queries/journal.ts`):

- A trade is bucketed by its `closedAt` if it has one, else by `openedAt`
  (so an open position still shows up as activity on the day it was opened).
- Bucketing converts that timestamp into `timeZone`'s local calendar day
  using `@date-fns/tz`'s `TZDate`, the same primitive `dailyPnl()` in
  `src/lib/metrics/aggregate.ts` uses — the two are deliberately consistent.
- **Journal entries themselves are not timezone-converted.** `JournalEntry
  .entryDate` is a plain calendar date the user is writing about ("today's
  plan"), stored as a bare date with no time component — there is no instant
  in time to convert. The `date` route param and the `entryDate` column are
  the same string, always.
- The Settings → Profile timezone field carries an explicit note: changing
  timezone changes which day a trade/chart bucket falls into and nothing
  else. It does **not** change market-session tagging (London / New York /
  …), which is fixed to UTC hours in `src/lib/metrics/session.ts` regardless
  of any user setting, and it never rewrites a stored timestamp.

## Daily checklist

Each user keeps their own list of what to look at before trading ("check
the 1H trend", "wait for a 1m FVG") and ticks it off per day.

- **The list is the user's; the ticks are the day's.** `ChecklistItem` rows
  come back every day; `DailyCheck` records one item ticked on one calendar
  date. `date` is a plain calendar date like `JournalEntry.entryDate` — no
  timezone conversion, for the same reason.
- **Where it shows.** First on the day page (`/journal/[date]`), before the
  plan, since it is what you go through first; as "Today's checklist" at
  the top of `/journal`; and as a ✓ count on each calendar day that had
  ticks.
- **Removing an item never rewrites history.** An item ticked on any day is
  archived (`archivedAt`), not deleted: it drops off new days but still
  shows, ticked and read-only, on the days it was part of. One never ticked
  is deleted outright.
- **Ticking is optimistic**, because it is the everyday action and must not
  wait on a round trip; a failed save puts the box back and says so. Editing
  the list (add, rename, reorder, remove) waits for the server.
- **Scoping.** `DailyCheck` has no `userId`; every action looks the item up
  with `userId` in the WHERE clause first, and another user's id reads as
  "not found" (`src/lib/actions/checklist.ts`). A list holds at most 30
  items of up to 200 characters.

## Stats, balance chart and the calendar's weekly column

`/journal` opens with a range bar (two dates plus Today / Last week / Last
month), a grid of figure cards, and a daily account balance chart, above the
calendar.

- **The range is calendar dates, not a rolling duration.** `?from=&to=` are
  `YYYY-MM-DD` in the user's timezone, both inclusive;
  `resolveJournalRange()` (`src/lib/range.ts`) turns them into instants and
  falls back to "the same day last month through today" for anything
  missing, malformed or reversed. The presets are computed on the server in
  the user's zone and passed to the client, which never does timezone
  arithmetic itself.
- **One convention: closed trades, by close date.** `journalStats()`
  (`src/lib/queries/analytics/journal-stats.ts`) takes trades whose
  `closedAt` falls in the range — the same rule the calendar cells below use,
  so a card, the chart and a day cell always agree. This is deliberately not
  the Overview's activity window (docs/ANALYTICS.md); a trade's money
  belongs to the day it was realised.
- **The cards** are computed in `src/lib/metrics/journal-stats.ts`, whose
  header lists the judgement calls: scratch days count toward neither green
  nor red, "best day % of total profit" divides by net P&L and is blank when
  that is not positive, and weekday cards rank only weekdays that traded.
  "Average R" sits where a lot total would: trades are logged in R and carry
  no size.
- **The balance chart** plots the balance at the end of each local day that
  had a trade close or a cash movement, opening at the balance the account
  had at the start of the range (the full-history equity curve, not the
  starting balance).
- **The calendar** tints a day green or red by its closed-trade P&L and adds
  a weekly total per row (`monthView().weeks`, summed in decimal). The
  calendar pages by `?month` and keeps the range; without `?month` it shows
  the month the range ends in. Cancelled trades are not counted on a day —
  they used to be, inflating the badge.

## The autosave contract

The day view (`/journal/[date]`) never makes the user click "create entry"
first — the form (two textareas, a mood selector) is always present, backed
by an upsert on `(userId, entryDate)`.

- **Pre-market plan** and **post-session review** are independent fields,
  each with its own save cycle: typing marks the field dirty, and it saves
  on `blur` — not on every keystroke — via `saveJournalEntry({ date, field,
  value })`. A save is skipped entirely if the value hasn't changed since the
  last successful save (no network round trip for a click-into/click-out of
  an untouched textarea).
- Save state is shown inline next to the field's label: `Saving…` while the
  request is in flight, `Saved HH:MM` (from the row's real `updatedAt`) on
  success, or the server's error message in the loss colour on failure — no
  toast, no modal, nothing that requires acknowledging.
- **Mood** has no separate save step: selecting a value calls `setMood`
  immediately. Clicking the already-selected value clears it (mood becomes
  `null`) rather than being stuck once set.
- All three actions (`saveJournalEntry`, `setMood`, `deleteEntry`) live in
  `src/lib/actions/journal.ts`, validate with `zod`, and return `{ ok,
  fieldErrors?, formError? }` — never throw at the form.

## Why account deletion is refused when trades exist

`deleteAccount` (`src/lib/actions/accounts.ts`) counts the account's trades
first. If there are any, it refuses with a message naming the exact count
and pointing at archiving instead of deleting:

> This account still has 43 trades — archive it instead, or delete its
> trades first.

The schema's `Trade.accountId` relation is `onDelete: Cascade`, so a
Prisma-level delete of the account row **would** silently take every trade,
tag attachment, and balance event with it in one shot — years of trading
history gone because someone clicked the wrong menu item once. Archiving
(`isArchived: true`) gets an account out of the active list and the account
switcher without destroying anything, and is fully reversible. Deletion is
left available for the one case it's actually safe: a test/duplicate account
that was created and never traded on.

## Balance event amount sign convention

`BalanceEvent.amount` is stored **signed**, matching the contract documented
on `src/lib/metrics/types.ts`'s `BalanceEvent` type (positive increases
balance, negative decreases it) — this is what `equityCurve()` in
`src/lib/metrics/aggregate.ts` assumes when folding balance events into the
running balance. Concretely, in `addBalanceEvent`:

- The form always asks for a plain magnitude (never asks the user to
  remember to type a minus sign for a withdrawal).
- `DEPOSIT` is stored positive, `WITHDRAWAL` is always stored **negative**
  regardless of the sign typed, and `ADJUSTMENT` keeps whatever sign the
  user enters (a correction can go either direction) with a hint suggesting
  a negative value for a decrease.
- The Accounts page displays "Withdrawals" as an absolute value (a stat
  users read as "how much came out"), even though the stored value is
  negative.

## Upstream issues this feature once worked around (both since fixed)

Earlier versions of this doc described two workarounds. Both underlying bugs
are fixed and the workarounds are gone; the history is kept because the
symptoms are worth recognising:

1. `src/lib/active-account.ts` imported a `db` export that `src/lib/db.ts`
   never had, so `resolveActiveAccountId()` threw. It now imports `prisma`,
   and `src/lib/queries/journal.ts` re-exports it as
   `resolveActiveTradingAccountId` instead of re-implementing the cookie
   contract.
2. `lib/metrics/session.ts` says `NEW_YORK` while the database stores
   `NEWYORK`. The enum in `prisma/schema.prisma` now declares
   `NEW_YORK @map("NEWYORK")`, so the TypeScript name and the stored value
   are reconciled in one place and nothing needs normalising before a write.

## Export format

Settings → Data offers two downloads, both served from
`src/app/api/export/**` and scoped to the signed-in user, and a restore that
reads the JSON one back (below).

### CSV — `GET /api/export/trades`

The **active account's** trades (same account the cookie/account switcher
points at), one row per trade, streamed in pages of 500 so the response
never buffers the whole table in memory. The response starts with a UTF-8
byte-order mark (`EF BB BF`) before the header row — without it, Excel
sniffs the file as Latin-1/ANSI and mangles any non-ASCII character in a
trade's notes; every other CSV-aware tool ignores a leading BOM harmlessly.

Column order:

```
id, symbol, direction, status, openedAt, closedAt, entryMode, entryPrice,
exitPrice, stopLoss, takeProfit, plannedRR, plannedRisk, resultR,
volumeLots, commission, swap, conversionRate,
netPnl, grossPnl, pips, rMultiple, riskAmount, holdingMinutes,
marketSession, followedPlan, emotion, confidence, notes, externalTicket,
tags
```

`tags` is a `;`-joined list of tag names. Any field containing a comma,
quote, or newline is quoted per RFC 4180 (embedded quotes doubled). Empty
fields (no exit price on an open trade, no stop loss, etc.) render as an
empty CSV field, not the literal word "null".

### JSON — `GET /api/export/data`

Everything the user owns, as one JSON document: profile (minus password
hash), every trading account with its challenge rules, balance events and
trades (each trade including its tags, playbook, checklist answers,
MAE/MFE, attachment metadata and fills), all tags, playbooks with their
rules, journal entries, the daily checklist with the days each item was
ticked, coded strategies, symbol aliases and notification
preferences. A top-level `notIncluded` array documents what's deliberately
left out — the password hash, other users' data, the shared instrument
reference table, and attachment file bytes (only the stored URL or storage
key travels with the export, never the underlying file).

The file's shape is a zod schema, `src/lib/export-schema.ts`, shared by the
route and by Restore. The route builds its payload as a value of the
schema's input type, so a column added to one and not the other is a tsc
error rather than a restore that silently drops it — challenge rules, MAE/MFE
and strategies were all missing from the export before that existed.

**Versions.** `schemaVersion` is 3 since R-mode trades (docs/TRADES.md),
which carry `entryMode`, `plannedRR`, `plannedRisk` and `resultR` and may
have no `entryPrice` or `volumeLots` — a loosening of two core fields, hence
a bump rather than another optional field. A version-2 file restores with
every trade as PRICE. Version 2 added fills and `initialStopLoss`; a
version-1 file has neither, and each of its trades is read as one
entry (and one exit if closed) at the trade's own prices and times
(`normalizeExport`). Fields added to version 2 since it shipped — account
challenge rules, `maePrice`/`mfePrice`, `tagRefs` (a tag is unique by kind
*and* name, so `tags`, names only, is ambiguous), attachment dimensions,
balance-event tickets, `strategies`, `symbolAliases`, `notificationPrefs` —
were additive, and the reader treats every one as optional so an earlier v2
file still restores. Unknown fields are ignored; a *higher* `schemaVersion`
is refused, because a bump means a field changed meaning.

Still not exported, on purpose: backtest runs (reproducible from a strategy
plus candles, and candles are shared reference data), statement- and
candle-import history (audit rows pointing at ids that would not exist after
a restore), notification send logs, sign-in attempts and sessions. There is
no per-fill commission to export: `Execution` has no such column —
commission and swap are per trade.

### Restore — Settings → Data → Restore

`restoreFromExport` (`src/lib/actions/restore.ts`, the endpoint) reads an
uploaded export back into the **signed-in** user; `restore-store.ts` does the
writing and states the rules. In short:

- **Every account becomes a new account**, labelled `<label> (restored)` in
  the reader's language (`settings.restore.labelSuffix`, trimmed to the
  80-character label limit). Nothing is ever merged: there is no reliable
  "same trade" across two journals (hand-entered trades have no ticket), and
  a duplicate account is easy to delete where a wrong merge is not. Restoring
  the same file twice gives two copies.
- **BACKTEST accounts are skipped**: their runs and fill settings are not in
  the export, so the trades would belong to no run.
- **Tags** are reused when this user already has one of the same kind and
  name, otherwise created with the file's colour and order. **Playbooks**
  are reused by name (and left unchanged), otherwise created with their
  rules. Checklist answers map by rule text; an answer for a rule a reused
  playbook doesn't have is skipped.
- **Derived columns are recomputed, never copied.** netPnl, grossPnl, pips,
  rMultiple, riskAmount, holdingMinutes and marketSession in the file are
  ignored; each trade's aggregate and derived columns come from its fills
  through `columnsFromFills` (`actions/fills-store.ts`) — the body of
  `syncTradeFromFills`, so the same code every fill edit runs. A cancelled
  trade has no fills and is computed from its own row, as `createTrade` does.
- **Fills** come from the file (v2) or are synthesized (v1). A trade whose
  fills cannot describe a position (`validateFills`) is skipped, as is a
  trade on a symbol missing from the shared Instrument table — the summary
  lists those symbols, since the owner can add them and the file can be
  restored again.
- **Journal days** this user has already written are kept; the file's entry
  for that date is skipped.
- **Attachments**: only https `externalUrl` links are restored. An upload's
  storage key is never copied — it points at another user's bytes, and
  copying it would grant read access to them.
- **Strategies** and **symbol aliases** are added unless the name / broker
  symbol is already in use. Profile and notification preferences are not
  applied: they belong to the login being restored into.
- **One transaction for the whole file**, so a failure at any row leaves
  nothing behind. Every table is written set-based (`createMany` with
  client-generated ids, chunked), a handful of statements however large the
  file, which is what keeps one transaction inside its timeout. Uploads are
  capped at 20 MB.

The action returns the counts created and a `skipped` breakdown, which the
panel shows until the next restore — the toast alone would be gone before
anyone read why something was skipped.

## Curated timezone list

Settings → Profile offers ~40 IANA zones (`src/components/settings/
timezones.ts`) rather than the full ~400-zone database: one representative
city per UTC offset actually used by a major population or trading center,
so the dropdown stays scannable. `Asia/Ulaanbaatar` is included explicitly —
it's the seeded demo user's timezone.
