# Ledger — an FX trading journal

Ledger is a trading journal for forex (and metals/indices/crypto/energy)
traders: log every position with its full context — entry/exit, stop,
target, size, screenshots, tags, mood — and let the app do the arithmetic
(P&L, R-multiple, session, drawdown, expectancy) instead of a spreadsheet.

## What it does

- **Statement import** — MT4 Detailed Statements, MT5 Reports and CSV, with a
  preview before anything is written, broker-time handling that follows DST,
  conversion rates for crosses taken from the broker's own profit, re-imports
  that close previously-open positions, and undo. See `docs/IMPORT.md`.
- **Trade logging** — full trade entry with instrument, direction, size,
  entry/exit/stop/target, commission/swap, tags, and discipline fields
  (followed the plan? emotion, confidence, notes).
- **Computed analytics, not eyeballed ones** — net/gross P&L, pips, R
  multiple, risk amount, holding time and market session are all derived by
  one shared formula layer (`src/lib/metrics`) and stored on the trade, never
  recomputed ad hoc or guessed by hand. See `docs/DATA-MODEL.md`.
- **A real dashboard** — equity curve, drawdown, daily P&L, win rate,
  profit factor, expectancy, discipline stats (plan-followed rate, trades
  with no stop, average emotion), and a "what's happening right now" panel
  that ignores the date-range picker on purpose.
- **Prop-firm challenges** — daily loss limit, static or trailing max
  drawdown, profit target and minimum trading days per account, tracked on
  the dashboard. See `docs/ANALYTICS.md`.
- **Periods and exit efficiency** — month-by-month P&L, the selected range
  against the one before it, and MAE/MFE in R (entered, or measured from M1
  candles).
- **Playbooks** — your setups as named rule lists; tick each trade against
  its rules and see whether trades taken by the book actually do better.
  See `docs/PLAYBOOKS.md`.
- **Trade charts** — the candles around a trade with every fill marked and
  the stop and target drawn, whenever bars for the symbol are imported.
- **Simulate** — replay your own trades under a different rule (cap losses,
  skip weekdays/sessions/tags, fixed % sizing), Monte Carlo on your R
  multiples, and a position-size calculator that warns before the trade.
  See `docs/SIMULATE.md`.
- **Reminders** — a dashboard nudge on a day you traded but didn't journal,
  plus opt-in email: the same reminder at an hour you pick, and a Monday
  summary of last week. See `docs/NOTIFICATIONS.md`.
- **English and Mongolian** — pick the language in Settings; it follows you
  to other devices at sign-in. See `docs/I18N.md`.
- **A same-day risk guard** — a plain-language strip that appears only when
  something's actually off today: a daily loss limit reached, two-plus
  losses in a row, a trade sized well past the account's per-trade risk
  rule, or a trade with no stop loss. Silent the rest of the time. See
  `src/lib/risk.ts`.
- **Screenshots on every trade** — drag/drop, file picker, or paste a chart
  screenshot straight from the clipboard; before/after tagging and captions;
  stored locally on disk or in an S3-compatible bucket depending on
  configuration. See `docs/PWA.md`'s sibling concerns and `src/lib/storage.ts`.
- **A daily journal** — a pre-market plan and an end-of-day review per
  calendar day, autosaving field-by-field.
- **Multi-account** — track several broker accounts (demo/live/prop,
  MT4/MT5/cTrader) with independent starting balances, currencies, and
  per-trade risk settings.
- **Installable as a PWA** — works from the home screen on iOS/Android and
  as a standalone window on desktop, with a conservative offline story (see
  `docs/PWA.md`: there's no offline write queue, on purpose — the app tells
  you plainly when it can't save instead of pretending to).
- **Backtesting, two ways** — step through historical bars by hand and place
  orders as if live, or write a strategy in JavaScript and run it over a
  range. Either way the resulting trades are written as real `Trade` rows in
  a dedicated BACKTEST account, so every analytics report works on them
  unchanged. Strategy code is compiled and executed in a Web Worker in your
  own browser, never on the server — see `docs/BACKTEST-ENGINE.md` for why
  that is not a preference. Bars come from MT5 or generic CSV exports with an
  explicit timezone offset (`docs/BACKTEST-DATA.md`).
- **A living styleguide** at `/design` — every UI primitive, in every state,
  rendered from the real component source. See `docs/DESIGN-SYSTEM.md`.

## Stack

- **Next.js 16** (App Router, Turbopack), **React 19**, **TypeScript** (strict)
- **Tailwind v4** — a token-driven design system (`src/app/globals.css`),
  never a raw hex or a stock palette colour in component code
- **Prisma 6** on **Postgres**, via `@prisma/adapter-pg` (see "Two things
  to know" below for why, and `docs/DATA-MODEL.md` for the full rationale)
- **Auth.js (next-auth) v5** — email + password (throttled per email and per
  IP), Google OAuth and Resend magic links, each only registered when
  configured. `docs/AUTH.md` states the threat model and what is
  deliberately not built yet
- **Vitest** — 766 unit tests across the pure layers (metrics, the backtest
  engine, candle parsing, conversions, validation schemas, the auth rules),
  no I/O and no mocking, running in about a second; plus a Postgres-backed
  tier for the authorization wiring and Playwright e2e for the main user flows.
  `docs/TESTING.md` explains what each covers and, more usefully, what not
- **lightweight-charts** for the replay candlestick view
- **Recharts** for the handful of real charts; a hand-rolled inline-SVG
  `Sparkline` everywhere a chart-per-table-row would be absurd

## Quick start

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL / AUTH_SECRET at minimum
npm run db:migrate           # applies the schema to your Postgres database
npm run db:seed              # seeded demo user + accounts + trades
npm run backfill              # computes net_pnl/R/session/etc. on the seeded trades
npm run dev                   # http://localhost:3000
```

Sign in with the seeded account: **duk@example.com** / **password**.

New to setting up Postgres, or on Windows/macOS with nothing installed yet?
**See `SETUP.md`** for a from-zero walkthrough, including a no-local-Postgres
path (Supabase/Neon) and a Vercel deploy guide.

### If you change a formula or an instrument spec

`npm run backfill` (`scripts/backfill-metrics.ts`) recomputes every trade's
stored analytics columns (`net_pnl`, `r_multiple`, `market_session`, …) from
the current formulas in `src/lib/metrics`. These are **stored, not
view-time-computed** columns (see `docs/DATA-MODEL.md` for why) — which
means editing a formula, or an instrument's pip size/contract size, does
nothing to existing rows until you run this. Always re-run it after such a
change, in dev and in any migration plan for production data.

## npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run verify` | typecheck + lint + format check + tests — **the gate** |
| `npm run lint` | ESLint |
| `npm run format` | Prettier, write |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the unit tests (pure, no database) |
| `npm run test:db` | Authorization tests against Postgres, in a scratch schema (`docs/TESTING.md`) |
| `npm run test:e2e` | Playwright: the main user flows against a production build, in a scratch schema |
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:migrate` | `prisma migrate deploy` — apply committed migrations (no shadow DB needed) |
| `npm run db:migrate:new` | `prisma migrate dev` — author a NEW migration; needs a local Postgres |
| `npm run db:seed` | `tsx prisma/seed.ts` — idempotent demo data |
| `npm run db:reset` | `prisma migrate reset` — drop, re-migrate, re-seed |
| `npm run db:studio` | Prisma Studio |
| `npm run backfill` | Recompute every trade's derived analytics columns — **run after any formula or instrument-spec change** |

## Project layout

```
prisma/                  schema.prisma, migrations, seed.ts, rls.sql
scripts/                 backfill-metrics.ts, make-icons.mjs
src/
  app/
    (auth)/login/        sign-in / registration
    (app)/               everything behind auth — shares AppShell + nav
      page.tsx            Overview dashboard
      accounts/, analytics/, journal/, settings/, trades/
      design/             the living styleguide (/design)
    api/
      auth/[...nextauth]/  Auth.js route handler
      attachments/         screenshot upload/serve/delete
      export/               CSV/JSON export routes
    layout.tsx            root HTML shell, fonts, manifest link, ToastProvider
  components/
    ui/                   design-system primitives (button, input, table, …)
    shell/                app chrome: nav rail, account switcher, theme toggle
    charts/                Recharts wrappers
    dashboard/            Overview-page panels + the risk guard
    trades/                trade list/detail/form pieces + the attachment uploader
    pwa/                   service-worker registration, offline banner
  lib/
    metrics/               pure P&L/R/session formulas + tests
    queries/                server-only reads, always scoped to a userId
    actions/                server actions ("use server"), one file per domain
    risk.ts                same-day risk-guard formulas + tests
    storage.ts              attachment storage abstraction (local disk / S3)
    session.ts              requireUser / requireAccountAccess — the one place auth is checked
    db.ts                   the Prisma client singleton
docs/                     one topic per file — read AUTH.md/DATA-MODEL.md/etc. before touching that area
```

## Before production

This repo is built for local development against a real (if small) Postgres
instance. Before deploying it for real:

- **Decide on password login.** `ALLOW_PASSWORD_LOGIN` (default on) controls
  email + password sign-in. It is throttled per email and per IP
  (`src/lib/auth/throttle.ts`), so it is a supported production method — but
  set it to `false` if you only want Google / magic-link sign-in. The old
  `ALLOW_DEV_LOGIN` variable is rejected at boot (see `docs/AUTH.md`).
- **Optional: error reporting.** Set `SENTRY_DSN` (server) and
  `NEXT_PUBLIC_SENTRY_DSN` (browser, needed at build time). Off when unset;
  request bodies, cookies and query strings are never sent
  (`src/lib/sentry-options.ts`).
- **Optional: reminder and summary email.** Set `RESEND_API_KEY` (or reuse
  `AUTH_RESEND_KEY`), `CRON_SECRET`, and an hourly scheduler —
  `vercel.json` on Vercel Pro, or the GitHub Actions fallback in
  `.github/workflows/notifications.yml`. See `docs/NOTIFICATIONS.md`.
- **Remove or change the seeded demo user** (`duk@example.com` / `password`)
  if you ran `npm run db:seed` against this database.
- **Generate a real `AUTH_SECRET`** (`openssl rand -base64 32`) and set
  `AUTH_URL` to your real origin.
- **Drop `engineType = "client"`** if your deploy target can reach
  `binaries.prisma.sh` — see "Two things to know" below and
  `docs/DATA-MODEL.md`. Not required, but it's the better-supported path
  when nothing forces you off it.
- **Point attachment storage at S3** (or an S3-compatible bucket) rather
  than local disk — `.uploads/` on a serverless/ephemeral filesystem does
  not survive a redeploy. Set `S3_BUCKET` + the other `S3_*` vars (see
  `.env.example` and `src/lib/storage.ts`).
- **Decide on Row-Level Security.** The app enforces per-user scoping in the
  query layer today; `prisma/rls.sql` is a second, independent layer that
  only activates once the app connects as a least-privilege role instead of
  the Postgres owner. See `docs/DATA-MODEL.md`.
- **Re-run `npm run backfill`** against production data any time a formula
  or instrument spec changes — see above.
- **Rotate the seeded demo user's password**, or don't seed it at all in a
  shared environment.

## Two things to know about this particular build

1. **Fonts aren't loaded via `next/font/google`.** This project's build
   environment has no route to `fonts.googleapis.com`, so
   `src/app/layout.tsx` links the Google Fonts stylesheet directly instead
   — see the comment at the top of that file for the one-block change to
   switch back to `next/font` (self-hosted, no runtime request) once you're
   building somewhere with normal internet access.
2. **Prisma uses `engineType = "client"` with `@prisma/adapter-pg`**, not
   the classic native query engine, because this sandbox can't reach
   `binaries.prisma.sh` either. Migrating against Postgres through the JS
   engine in this specific sandboxed environment needed a small local patch
   to `@prisma/adapter-pg`'s installed files (unrelated to any app code —
   see `docs/DATA-MODEL.md` for the engine/adapter background). **On a
   normal network you don't need any of this**: delete `engineType =
   "client"` from `prisma/schema.prisma`, drop the `PrismaPg` adapter
   wiring in `prisma.config.ts` and `src/lib/db.ts`, and Prisma downloads
   and uses its standard engine binary with no patching required.
