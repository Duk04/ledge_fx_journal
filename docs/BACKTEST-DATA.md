# Candle data layer

How historical OHLC bars get into this app and back out again — CSV formats,
the timezone problem, the upsert strategy, aggregation, and storage.
Implementation lives in:

- `src/lib/candles/parse.ts` — CSV → bars (pure, runs in the browser too)
- `src/lib/candles/aggregate.ts` — finer bars → coarser bars
- `src/lib/queries/candles.ts` — reads (`getBars`, `listCoverage`, `candleStorageBytes`, `listImports`)
- `src/lib/actions/candles.ts` — the actions (`importCandles`, `deleteCandles`)
- `src/lib/candles/upsert.ts` — the bulk upsert itself, deliberately NOT
  exported from the action module: every export of a `"use server"` file is
  a callable POST endpoint, and this helper does no authorization of its own
- `src/app/(app)/backtest/data/page.tsx` + `src/components/backtest/*` — the UI

## The two supported CSV formats

### MT5 export

Tab-separated, with MT5's own header row. Prices are the instrument's raw
quote (5 digits for most FX pairs, 3 for JPY pairs, etc).

```
<DATE>	<TIME>	<OPEN>	<HIGH>	<LOW>	<CLOSE>	<TICKVOL>	<VOL>	<SPREAD>
2024.01.02	00:00:00	1.10450	1.10480	1.10400	1.10460	120	0	8
2024.01.02	00:01:00	1.10460	1.10500	1.10450	1.10490	95	0	9
```

A **daily** export from MT5 has no `<TIME>` column at all:

```
<DATE>	<OPEN>	<HIGH>	<LOW>	<CLOSE>	<TICKVOL>	<VOL>	<SPREAD>
2024.01.02	1.10450	1.10900	1.10100	1.10800	48000	0	0
2024.01.03	1.10800	1.11200	1.10700	1.11050	51000	0	0
```

The parser detects this by checking whether a `<TIME>` column exists in the
header, not by the timeframe you selected in the UI, and defaults each bar to
midnight when it's missing. `<TICKVOL>` (the number of price changes in the
bar) is what gets stored as `volume` — MT5 rarely has real traded volume for
FX/CFDs, and tick volume is the closest proxy it does have. `<SPREAD>` is
points at bar close, stored as-is for the fill model to use.

### Generic OHLCV

Comma- or semicolon-separated (auto-detected from the header row), with
loosely-matched, case-insensitive column names:

- time: `time`, `date`, `timestamp`, or `datetime`
- `open`/`o`, `high`/`h`, `low`/`l`, `close`/`c`, `volume`/`vol`/`v`

```csv
time,open,high,low,close,volume
2024-01-02T00:00:00Z,1.1045,1.1048,1.1040,1.1046,120
2024-01-02T00:01:00Z,1.1046,1.1050,1.1045,1.1049,95
```

The time column accepts:

- **ISO 8601 with an explicit offset or `Z`** — used as-is, unambiguous.
- **Epoch seconds or milliseconds** (a bare integer) — used as-is; the
  parser tells the two apart by magnitude (anything under ~10^11 is
  seconds).
- **A naive timestamp** (`2024-01-02 03:00:00`, no offset) — treated exactly
  like an MT5 timestamp: it's somebody's wall clock, and `tzOffsetMinutes`
  is applied to it. See below.

## The timezone problem

**An MT5 export carries no timezone information at all.** Every
`<DATE>`/`<TIME>` pair is the broker's own server clock — commonly UTC+2 or
UTC+3, and it typically follows the broker's own DST schedule, which lines up
with neither the traded instrument's home exchange nor the importing user's
own timezone. A naive generic-CSV timestamp (no `Z`, no explicit offset) has
the identical problem.

If those timestamps were stored as if they were already UTC, **every bar
would be silently shifted** by whatever the broker's offset happens to be.
This failure is invisible in a plain OHLC chart — the candles still look
like candles, the highs and lows are still real — but it quietly poisons
anything session-based: a "London open" strategy backtested against data
that's really two or three hours off will trade against the wrong bars and
produce a result that means nothing. There is no way to detect this after
the fact by looking at the bars alone, which is exactly why it's dangerous.

So the rule this codebase enforces:

- `tzOffsetMinutes` (minutes to **add** to UTC to reach the file's local wall
  clock — e.g. `180` for a UTC+3 broker) is a **required** parameter of
  `parseCandleCsv`. There is no default, and there never should be one.
- The import UI (`CandleImportPanel`) asks for it on every import, with
  presets for UTC, UTC+2 and UTC+3 ("most MT5 brokers") and a custom option
  — never assumes yesterday's answer still holds, since a broker's own
  offset moves with its DST calendar.
- The conversion is `utcMs = Date.UTC(y, m, d, h, mi, s) - tzOffsetMinutes *
  60_000` — read the file's fields as if they were UTC, then subtract the
  offset.
- The exact offset used is recorded on the `CandleImport` row
  (`tz_offset_minutes`), so "why is this bar at this hour" has an answer
  months later, not just at import time.
- Only genuinely tz-less timestamps go through that conversion. An epoch
  value or an ISO string with its own offset/`Z` is already an absolute
  instant — applying `tzOffsetMinutes` to it would double-shift the data.

## The upsert strategy

`Candle`'s primary key is `(symbol, timeframe, ts)` specifically so
re-importing an overlapping range — pulling "last 3 months" again next week,
or re-exporting after finding a bad tick — is idempotent. That means an
import has to be an **upsert**, not an insert:

- `prisma.candle.createMany({ skipDuplicates: true })` is the wrong tool,
  even though it looks obvious: `skipDuplicates` means a row whose key
  already exists is left untouched. A corrected re-export would silently
  keep the *old*, wrong values.
- Prisma's client has no bulk-upsert call — only a single-row `upsert`,
  which would mean one round trip per bar (hundreds of thousands for a year
  of M1).
- So `upsertCandles()` drops to raw SQL: one `INSERT ... ON CONFLICT
  (symbol, timeframe, ts) DO UPDATE` statement per batch of ~1000 rows.
  `xmax = 0` in the `RETURNING` clause is the standard Postgres trick for
  telling an insert from an on-conflict update apart in the same
  statement, which is how `importCandles` reports accurate
  inserted/updated counts back to the UI.

**Upload size, and a follow-up this module can't finish alone**: Next.js
Server Actions cap the request body at 1MB by default
(`experimental.serverActions.bodySizeLimit` in `next.config.ts`). The 25MB
cap enforced inside `importCandles` is this module's own business rule, but
it can only be *reached* — as opposed to the upload failing earlier, inside
the framework, with a generic error — once that framework-level limit is
raised in `next.config.ts`. That file is shared app-wide configuration
outside this module's ownership, so raising it (e.g. to `"30mb"`) is a
one-line follow-up for whoever owns `next.config.ts`, not something this
module changes on its own.

## Aggregation rules

`aggregateBars(bars, from, to)` builds coarser bars from finer ones:

- **open** = the first source bar's open, **close** = the last source bar's
  close, **high**/**low** = max/min across the bucket, **volume** = sum,
  **spread** = max.
- **Refuses to aggregate into a finer timeframe.** Building M1 out of H1
  would mean fabricating an intrabar path that was never recorded — that's
  a hard error, not a best-effort guess.
- **Bucket boundaries are aligned to the UTC calendar**, never to whatever
  timestamp the first source bar happens to carry. An H4 bucket always
  starts at `00:00`/`04:00`/`08:00`/`12:00`/`16:00`/`20:00` UTC; D1 buckets
  start at UTC midnight; W1 buckets start at `00:00` UTC on a Monday. If
  alignment instead floated with the input, importing the same M1 data
  starting from two different dates would produce two different sets of H4
  bars — reproducibility across imports depends entirely on this.
- **Gaps** (weekends, holidays) are handled by simply never emitting a
  bucket that has no source bars in it — there is nothing to "fill", since
  a fabricated empty bar would be invented data.

`getBars()` in `lib/queries/candles.ts` uses this to fall back on the fly:
if the requested timeframe has no stored rows, it tries every finer stored
timeframe from closest to farthest (e.g. H1 before M15 before M1 when asked
for H4) and aggregates from the first one that has data, reporting which
timeframe it actually used via `aggregatedFrom` in its return value.
Aggregating from any finer stored timeframe produces identical
open/high/low/close/volume to aggregating from M1 directly — the operations
are associative across an aligned bucket grid — so preferring the closest
available granularity is purely a performance choice: it reads and merges
the fewest rows that still cover the requested range.

## Storage guidance

Postgres bills `pg_total_relation_size('candles')` — heap, indexes and TOAST
together — which is what `candleStorageBytes()` reports and what the
storage note on the Market Data page compares against Supabase's free-tier
cap.

| Timeframe | Approx. rows/year (1 symbol) | Approx. size/year |
| --------- | ----------------------------- | ------------------ |
| M1        | ~370,000                      | ~35 MB              |
| M5        | ~74,000                       | ~7 MB               |
| H1        | ~6,200                        | ~0.6 MB             |
| D1        | ~260                          | ~25 KB              |

(M1 figures are the ones `prisma/schema.prisma`'s own size warning quotes;
the rest scale down roughly linearly with bar count.)

Supabase's free tier caps the **entire database** at 500 MB, shared with
every other table in the app — trades, journal entries, attachments'
metadata, all of it. A handful of symbols' worth of M1 history for a couple
of years is enough to matter. Practical guidance:

- Import the date range a backtest actually needs, not a broker's entire
  available history.
- Prefer importing at the timeframe a strategy trades at; let `getBars`'
  on-the-fly aggregation build anything coarser instead of also storing H1/H4/D1
  copies of the same data.
- Delete a symbol/timeframe's data (`deleteCandles`, behind a confirm dialog
  in the coverage table) once a backtest project is done with it.
