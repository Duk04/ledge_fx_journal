# Journal, Accounts, Settings & Export — reference

Covers the four areas owned by this agent: the trading journal
(`src/app/(app)/journal`), trading accounts (`src/app/(app)/accounts`),
settings (`src/app/(app)/settings`), and data export (`src/app/api/export`).

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

Settings → Data offers two downloads, both streamed from
`src/app/api/export/**` and scoped to the signed-in user.

### CSV — `GET /api/export/trades`

The **active account's** trades (same account the cookie/account switcher
points at), one row per trade, streamed in pages of 500 so the response
never buffers the whole table in memory. The response starts with a UTF-8
byte-order mark (`EF BB BF`) before the header row — without it, Excel
sniffs the file as Latin-1/ANSI and mangles any non-ASCII character in a
trade's notes; every other CSV-aware tool ignores a leading BOM harmlessly.

Column order:

```
id, symbol, direction, status, openedAt, closedAt, entryPrice, exitPrice,
stopLoss, takeProfit, volumeLots, commission, swap, conversionRate,
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
hash), every trading account with its balance events and trades (each
trade including its tags, attachment metadata and fills), all tags, and all
journal entries. `schemaVersion` is 2 since fills and `initialStopLoss` were
added; a version-1 file has neither, and each of its trades should be read as
one entry (and one exit if closed) at the trade's own prices and times. A top-level `notIncluded` array documents what's
deliberately left out — the password hash, other users' data, the shared
instrument reference table, and attachment file bytes (only the stored URL
or storage key travels with the export, never the underlying file).

## Curated timezone list

Settings → Profile offers ~40 IANA zones (`src/components/settings/
timezones.ts`) rather than the full ~400-zone database: one representative
city per UTC offset actually used by a major population or trading center,
so the dropdown stays scannable. `Asia/Ulaanbaatar` is included explicitly —
it's the seeded demo user's timezone.
