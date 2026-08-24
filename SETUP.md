# Setup — first run, from zero

This walks through getting Ledger running for someone with **no Postgres
installed and no prior context on this repo**, on Windows or macOS, plus how
to deploy it. If you already have Postgres and a `.env`, the "Quick start"
in `README.md` is faster.

## 1. Get a Postgres database

Pick one:

### Option A — install Postgres locally

- **macOS:** `brew install postgresql@16 && brew services start postgresql@16`
- **Windows:** download the installer from
  [postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
  and run it (accept the defaults; remember the password you set for the
  `postgres` user).

Then create a database:

```bash
createdb fxjournal
# or, from psql:
psql -U postgres -c "CREATE DATABASE fxjournal;"
```

### Option B — a free hosted Postgres (no local install)

Either **[Supabase](https://supabase.com)** or **[Neon](https://neon.tech)**
has a free tier that gives you a connection string in under two minutes:

1. Create a project.
2. Copy the connection string it gives you (Supabase: Project Settings →
   Database → Connection string, use the "URI" / pooled connection string;
   Neon: it's on the project dashboard). It looks like
   `postgresql://user:password@host:5432/dbname?sslmode=require`.
3. That's your `DATABASE_URL` — skip straight to step 2 below.

This is the easier path if you don't want Postgres running on your machine
at all, including for the Vercel deploy in step 5.

## 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set, at minimum:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/fxjournal?schema=public"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:5432/fxjournal?schema=public"
AUTH_SECRET="run: openssl rand -base64 32"
AUTH_URL="http://localhost:3000"
```

- If you're on **Option B** (hosted Postgres), paste that provider's
  connection string as both `DATABASE_URL` and `DIRECT_URL` (some providers
  give you a separate "direct"/non-pooled URL for migrations — use that one
  for `DIRECT_URL` if so, and the pooled one for `DATABASE_URL`).
- Generate `AUTH_SECRET` with `openssl rand -base64 32` (macOS/Linux/WSL), or
  any 32+ byte random string (an online UUID generator run twice and
  concatenated works fine for local dev).
- Leave everything else in `.env.example` blank for now — Google OAuth,
  Resend email, and S3 storage are all optional and only activate when
  their variables are filled in.

## 3. Install, migrate, seed

```bash
npm install
npm run db:migrate     # creates every table from prisma/schema.prisma
npm run db:seed        # a demo user, a couple of accounts, and sample trades
npm run backfill       # computes P&L/R/session on the seeded trades
```

If `npm run db:migrate` fails to connect: double-check `DATABASE_URL`
(especially the password and port), and that whatever Postgres you picked in
step 1 is actually running/reachable — `psql "$DATABASE_URL" -c '\dt'` is the
fastest way to confirm the connection independent of Prisma.

## 4. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the
seeded account:

- **Email:** `duk@example.com`
- **Password:** `password`

## Two gotchas specific to this project

You will not hit either of these on a normal setup following the steps
above — they're both about *this repository's own sandboxed build
environment*, called out here so you're not confused if you go looking at
the code and wonder why it's built this way.

1. **No `next/font/google`.** `src/app/layout.tsx` links the Google Fonts
   stylesheet with a plain `<link>` tag instead of using Next's built-in
   `next/font/google` loader. That's because the environment this project
   was built in has no network route to `fonts.googleapis.com` at build
   time (which is when `next/font` fetches font files). The comment at the
   top of `src/app/layout.tsx` has the exact three-line swap to switch to
   `next/font` — worth doing once you're building somewhere with normal
   internet access, since it self-hosts the font files and removes a
   render-blocking third-party request.
2. **Prisma's "client" engine, and a one-off adapter patch.** `prisma/schema.prisma`
   sets `engineType = "client"`, which makes Prisma use its pure JS/Wasm
   query engine instead of downloading a native binary from
   `binaries.prisma.sh` — again, no route to that host in the original build
   environment. Running `prisma migrate` against real Postgres through that
   engine, in that same sandboxed environment, needed a small local patch to
   `@prisma/adapter-pg`'s installed files (see `docs/DATA-MODEL.md` for the
   engine/adapter background — this isn't an application-code decision, it's
   purely about that one sandbox's network policy). **You should not need
   to patch anything** to follow this guide on a normal machine with normal
   internet access. If you ever want to drop this setup entirely and use
   Prisma's standard native engine: delete `engineType = "client"` from
   `prisma/schema.prisma`, remove the `PrismaPg` adapter construction in
   `prisma.config.ts` and `src/lib/db.ts` (Prisma will use `DATABASE_URL`
   directly), and re-run `npx prisma generate`.

## 5. Deploying (Vercel + hosted Postgres)

1. Push the repo to GitHub (or GitLab/Bitbucket).
2. Make sure you have a Postgres database Vercel's servers can reach —
   Supabase or Neon (Option B above) both work well and both offer a
   Vercel-native integration that fills in `DATABASE_URL`/`DIRECT_URL`
   automatically if you use it.
3. In Vercel: **New Project** → import the repo.
4. Under **Environment Variables**, set at least:
   - `DATABASE_URL`, `DIRECT_URL` — your hosted Postgres connection strings
   - `AUTH_SECRET` — a fresh `openssl rand -base64 32` (do **not** reuse your
     local dev one)
   - `AUTH_URL` — your production URL, e.g. `https://your-app.vercel.app`
   - `ALLOW_DEV_LOGIN` — set to `false` (see `docs/AUTH.md` — the seeded
     credentials login is a dev convenience, not something to expose
     publicly)
   - Optionally `S3_*` if you want attachment uploads to persist across
     deploys — **do set these in production**, since Vercel's filesystem is
     ephemeral and the local-disk storage fallback (`.uploads/`) will not
     survive a redeploy or scale past one instance. See `src/lib/storage.ts`
     and `docs/PWA.md`.
5. Deploy. Then run the migration once against the production database —
   either via Vercel's build command (`prisma migrate deploy && next build`)
   or manually from your machine with production's `DATABASE_URL`/`DIRECT_URL`
   exported locally: `npx prisma migrate deploy`.
6. On a normal (non-sandboxed) network like Vercel's build environment, you
   can drop `engineType = "client"` first (see gotcha #2 above) and let
   Prisma use its standard native engine — this is the better-supported path
   when nothing is forcing you off it.

See `README.md`'s **"Before production"** section for the rest of the
pre-launch checklist (turning off dev login, RLS, re-running the backfill,
etc.) — this file only covers *getting it running*, not *making it
production-ready*.
