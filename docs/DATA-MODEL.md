# Data model reference

This is a concise map of the database layer in `prisma/schema.prisma` — what
each table is for, how access control works, and why a couple of things are
built the way they are. For the full field list, read the schema itself; it's
short and the `@map`/`@@map` names below match the actual Postgres columns.

## Tables

| Table | Purpose |
|---|---|
| `users` | One row per journal user. Holds auth profile fields (email, name, image, password hash for the dev credentials login) plus app preferences (role, timezone — used to compute market-session boundaries in local time). |
| `auth_accounts`, `sessions`, `verification_tokens` | Auth.js (`@auth/prisma-adapter`) tables. Field names/shapes follow the adapter's contract exactly (see the comment in the schema); only table names are remapped. Not user-data in the same sense as the rest — the adapter owns them. |
| `accounts` (model `TradingAccount`) | A broker account the user tracks (demo/live/prop, MT4/MT5/cTrader, its own currency and starting balance). Trades and balance events both hang off an account, not directly off a user. |
| `instruments` | Reference data: one row per tradable symbol with its pip size, contract size, quote precision, and asset class. Shared across all users — not user-scoped, no RLS. Seeded from `src/lib/instruments.ts`. |
| `trades` | The core record: one row per position, from raw broker-reported fields (entry/exit price, stop, target, volume, commission, swap) plus a block of derived analytics fields — see "Computed columns" below. |
| `tags` | User-defined labels for setups and mistakes (`kind`: SETUP / MISTAKE / SESSION / CUSTOM), attached to trades via `trade_tags`. |
| `trade_tags` | Trade↔Tag join table. |
| `attachments` | Screenshots/files attached to a trade (before/after chart, etc.), either an object-storage key or an external URL. |
| `journal_entries` | Free-form daily journal: pre-market plan, end-of-day review, mood — one per user per calendar date. |
| `balance_events` | Deposits/withdrawals/adjustments against an account, for reconciling equity curve against raw trade P&L. |

## Row-level security approach

The app enforces per-user scoping in the **query layer** today: every query
that touches user data is written with an explicit `where: { userId }` (or a
join back to a row that has one), and the app connects as the Postgres owner
role. `prisma/rls.sql` adds a second, independent layer — real Postgres
`ROW LEVEL SECURITY` policies keyed off `current_setting('app.current_user_id',
true)` — but it is **not applied automatically by migrations**, and with the
current superuser/owner connection it is a deliberate no-op (Postgres never
applies RLS to a table owner or a `BYPASSRLS` role, which `postgres` is).

It exists for the day the app is switched to a least-privilege database role:
apply `rls.sql` once that role exists, have every request set
`app.current_user_id` at the start of its transaction, and from then on a
missing `where userId` in application code fails closed instead of leaking
rows — defense in depth under the query-layer scoping, not a replacement for
it. See the header comment in `prisma/rls.sql` for the exact setup steps.

`instruments`, plus the Auth.js tables (`auth_accounts`, `sessions`,
`verification_tokens`), are intentionally left without RLS: instruments are
shared reference data with no owner, and the Auth.js tables are only ever
touched by the adapter itself (and `verification_tokens` has no user
reference at all — its `identifier` is an email, not a user id).

## Computed trade columns: stored, backfilled by one function

`trades` stores both the raw, broker-reported facts (price, volume,
commission, swap, timestamps) **and** a set of derived analytics columns:
`net_pnl`, `gross_pnl`, `pips`, `r_multiple`, `risk_amount`,
`holding_minutes`, `market_session`. These are deliberately **stored columns,
not view/query-time calculations**, and deliberately **populated by exactly
one shared backfill function** (`lib/metrics`, added in a later step) rather
than computed inline wherever a trade is read or written.

Why stored:
- They're read constantly (every list view, every chart, every aggregate
  stat) and each one requires either a currency conversion, a session-in-
  local-time-zone lookup, or both — recomputing them per read is wasted work
  at journal scale, and makes indexing by e.g. `net_pnl` impossible.
- They can change size/definition (e.g. how `market_session` handles the
  London/New York overlap) independent of raw trade data — that's a
  reprocessing job, not a schema migration.

Why one shared function instead of computing them at every write site:
- P&L, R-multiple, and session classification all have real business logic
  (pip size and contract size per instrument, direction sign, conversion
  rate to account currency, session boundaries in the *account's* timezone).
  Duplicating that logic in the seed script, an import job, and a manual
  trade-edit endpoint is exactly how those three drift out of sync with each
  other. A single backfill function called after every write (create,
  import, edit) keeps one implementation as the source of truth.
- It also means the seed data can honestly represent "a trade the user
  entered" without the seed script re-implementing pip/R-multiple math —
  `prisma/seed.ts` leaves all seven computed columns `NULL` on purpose, with
  a comment pointing at this doc, rather than guessing at the formulas.

## Index rationale

- `trades(account_id, opened_at DESC)` — the default trade list view: "this
  account's trades, newest first."
- `trades(account_id, symbol)` — per-symbol filtering/stats within an
  account (e.g. "how have I done on XAUUSD").
- `trades(account_id, status)` — separating OPEN from CLOSED (and CANCELLED)
  trades, used on every dashboard load.
- `trades(account_id, external_ticket)` **unique** — the broker-ticket dedupe
  key for statement imports: re-importing the same statement must not
  duplicate, per account. Written by `src/lib/actions/statements.ts`;
  `balance_events(account_id, external_ticket)` is its twin for deposits and
  withdrawals. `trade_imports`, `symbol_aliases` and `trades.broker_profit`
  belong to the same feature — `docs/IMPORT.md`.
- `tags(user_id, kind, name)` **unique** — a user can't create the same
  named tag twice within one kind (e.g. two SETUP tags both called "OB
  retest"), while the same name is still allowed across different kinds.
- `journal_entries(user_id, entry_date)` **unique** — one journal entry per
  calendar day per user; this is also how the seed/edit flow upserts "today's
  entry" without a separate lookup.
- `balance_events(account_id, occurred_at DESC)` — equity-curve
  reconstruction reads an account's balance events in reverse-chronological
  order.
- Every other table gets a plain index on its owning foreign key
  (`user_id`/`account_id`/`trade_id`/`tag_id`) so cascading deletes and
  ownership joins (used by both app queries and the RLS policies in
  `rls.sql`) don't full-scan.

## Running it

```
npm run db:migrate   # prisma migrate dev
npm run db:seed       # tsx prisma/seed.ts (idempotent — safe to re-run)
npm run db:reset       # prisma migrate reset (drops + reseeds)
npm run db:studio     # prisma studio
```

See the top of `prisma.config.ts` and `src/lib/db.ts` for why this project's
Prisma Client uses `engineType = "client"` with an explicit `@prisma/adapter-pg`
driver adapter instead of the classic native query engine — a network-policy
detail of this particular sandbox, not a schema decision.


## Query engine: native by default, JS as a fallback

This project uses Prisma's standard native query engine. The `generator client`
block carries no `engineType`, the datasource block's `url`/`directUrl` are the
real connection strings, and `src/lib/db.ts` constructs a plain `PrismaClient`.

It did not start that way. It was originally built on a machine with no route to
`binaries.prisma.sh`, so it ran the pure-JS engine with the `@prisma/adapter-pg`
driver adapter. That worked on that machine and broke on a normal one, twice
over: `node-postgres` reads `sslmode=require` as `verify-full` (TLS failure
against Supabase), and `@prisma/adapter-pg` omits OIDs 18/`char` and 19/`name`
from its type map, so the migration engine could not even read `pg_catalog`
("Column type 'name' could not be deserialized").

The lesson worth keeping: a workaround for one environment is a defect in every
other one, so it belongs behind a flag rather than in the default path.

The flag is `PRISMA_JS_ENGINE=1`, read by both `prisma.config.ts` and
`src/lib/db.ts`. Enabling it fully also needs `engineType = "client"` on the
generator, `sslmode=no-verify` in the URLs, and a hand-patch of the adapter's
OID table — SETUP.md spells all four out.
