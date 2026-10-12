# Authentication

Auth.js v5 (`next-auth@5.0.0-beta.32`) with `@auth/prisma-adapter`, wired
against the `User` / `Account` / `VerificationToken` models in
`prisma/schema.prisma`.

## Threat model

**Multi-user, with hostile actors.** This is deployed publicly and
registration is open by default, so anyone can create an account and any
authenticated user must be assumed to be probing.

This is worth stating because it was not always true, and several decisions in
this codebase were correct under the old assumption and wrong under this one.
Comments and docs that said "single-user app" have been corrected; if you find
another, it is a bug, not a stale nicety. The two that mattered most:

- Strategy code used to be compiled and run on the server. That is remote
  code execution here. See `docs/BACKTEST-ENGINE.md`.
- The shared `Instrument` and `Candle` tables were writable by any signed-in
  user, and they feed every user's P&L arithmetic.

## Session strategy: JWT (not database sessions) — and why

The brief for this layer was "database session strategy". It does not survive
contact with the Credentials provider.

The reason is narrower than this document used to claim. `@auth/core`'s
`assert.js` throws `UnsupportedStrategy` only when an adapter is configured
**and credentials is the only provider** — so with Google and Resend also
registered, `strategy: "database"` would not fail at startup. The actual
blocker is `@auth/core/lib/actions/callback/index.js`: the credentials branch
**always** encodes and sets a JWT session cookie, whatever the configured
strategy. So credentials + database sessions silently produces a cookie the
database session reader cannot validate. Not unsupported — broken by
construction.

**What this app does:** `session.strategy = "jwt"`, with `maxAge` of 7 days
and `updateAge` of 1 day, both stated explicitly in `src/lib/auth-config.ts`.
They used to be unstated, which meant the app's real session lifetime (Auth.js
defaults to 30 days) was not expressed anywhere in the repository.

The adapter stays configured and is genuinely used: it creates `User` and
`Account` rows for Google sign-ins and issues `VerificationToken` rows for
Resend magic links.

### What the token carries, and what it does not

The token carries a user id, an `authAt` claim, and a random `sid` (one per
sign-in, used to revoke that token alone — below). That is all.

`role` and `timezone` used to be stashed on it, and that was wrong in two
directions. A token is only rewritten on sign-in or after `updateAge`, so a
timezone changed in Settings did not take effect for up to a week — and
neither did a **role demotion**, which is the one that matters. The
`session` callback then defaulted a missing role to `MEMBER`, which is a
fail-open pattern the moment roles gate anything.

Both are now read from the database by `getCurrentUser()` in
`src/lib/session.ts`, cached per request by React's `cache`. One indexed query
per render, and it buys three things:

- a role or timezone change applies immediately;
- a deleted user is signed out at once, rather than holding a usable token;
- `User.sessionsValidFrom` works.

### Session revocation

Two levels, both enforced by `getCurrentUser()` in one query:

- **Per user:** `User.sessionsValidFrom` is a timestamp, and any token whose
  `authAt` predates it is rejected. A password reset or change stamps it,
  which signs out every other session.
- **Per token:** signing out records the token's `sid` in `RevokedSession`,
  and a token whose `sid` is listed is rejected.

The per-token list exists because of a bug, not as a feature. Sign-out used to
rely on clearing the cookie, and that is not enough with this setup: the
Auth.js middleware re-sets the session cookie on every request it passes
(rolling expiry), so any request still in flight when the user signs out — a
production `<Link>` prefetch, typically — answers with the old token and the
browser stores it again. The user lands on /login, opens the app, and is
signed back in. It showed up as a CI-only e2e failure (prefetches are slower
there); `e2e/auth.spec.ts` now reproduces it deterministically by restoring
the old cookie by hand. Clearing the cookie is still done — it is what makes
the browser look signed out — but the revocation is what makes it true.

A row is only needed until its token would have expired; `expiresAt` is issue
time + `maxAge`, and sign-out prunes expired rows. Tokens minted before `sid`
existed carry none, cannot be revoked individually, and age out within a week.

Still not built: a "sign out my other devices" button (the per-user stamp
supports it) and a list of active sessions (that would need a row per
sign-in, not per sign-out). The dead `Session` model stays dropped — a table
that looks like a revocation control and is not one is worse than no table.

## The edge / node split

Next.js middleware runs on the Edge runtime, which cannot load Prisma's query
engine or `bcryptjs`. Three files split the config accordingly:

- **`src/lib/auth-config.ts`** — edge-safe. Session config, the `jwt` and
  `session` callbacks (pure token shaping, no I/O), the `authorized` callback,
  and `isPublicPath()`. No providers, no adapter, no Prisma, no bcryptjs, and
  **no environment reads** — session lifetimes are literals here so that
  `src/lib/env.ts` can be `server-only` without breaking the edge bundle.
- **`src/lib/auth.ts`** — Node-only. Spreads `authConfig`, adds
  `PrismaAdapter(prisma)`, builds the providers, and adds the `signIn`
  callback (which needs Prisma). This is what server components, server
  actions and the `/api/auth/[...nextauth]` route handler import from.
- **`src/middleware.ts`** builds its *own* `NextAuth(authConfig)` instance
  from the edge-safe config, so the compiled middleware bundle never pulls in
  `@prisma/client` or `bcryptjs`.

### Why `middleware.ts`, not `proxy.ts`

Next.js 16 deprecates the `middleware` convention in favour of `proxy`, and
pins `proxy.ts` to the Node.js runtime with no way back — setting `runtime` in
a proxy file throws. Since this file needs the edge (cheap, no cold start on
every navigation) and must never bundle Prisma or bcryptjs, it keeps the
`middleware.ts` name. Next's own migration note says to do exactly this:
`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`, under
the middleware/proxy rename — "If you want to continue using the `edge`
runtime, keep using `middleware`."

Migratable later with `npx @next/codemod middleware-to-proxy .` if Next ships
edge support for proxy. This is a deprecation knowingly carried.

### Middleware is not a security boundary

Two things follow from Next's own documentation, and both are why every page
and action calls the DAL regardless:

- Proxy/middleware auth is **optimistic**: it reads the session cookie and
  never hits the database, because it runs on every route including prefetches.
- **Server Functions are POSTs to the route they were used on.** A matcher
  exclusion — or a refactor that moves an action to a different route —
  silently removes middleware coverage from it. So authentication and
  authorization are verified *inside* each action, not upstream of it.

The matcher and `isPublicPath()` are two halves of one rule and must change
together; `src/lib/auth-config.test.ts` asserts they agree. The matcher
previously ended with an "any path containing a dot" alternative, which
excluded every route with a dot anywhere in it — a date segment, a symbol, or
any future route added without realising. Extensions are listed explicitly
now.

## Providers

| Provider | Enabled when | Notes |
|---|---|---|
| Credentials (email + password) | `ALLOW_PASSWORD_LOGIN` (default: on) | Constructed conditionally in `src/lib/auth.ts` — refusing to construct the provider is the actual gate, since `/api/auth/callback/credentials` is reachable regardless of what the login page renders. Throttled per email and per IP. Compares with `bcryptjs` at cost 12; when the user does not exist it still runs a compare against a fixed dummy hash **of the same cost**, so "no such account" and "wrong password" take the same time. |
| Google | `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` both set | `src/lib/env.ts` refuses one without the other, so a half-configured deployment cannot render a button that always fails. |
| Resend (magic link) | `AUTH_RESEND_KEY` set | Sends from `EMAIL_FROM`. Uses `VerificationToken`. |

`ALLOW_DEV_LOGIN` is **rejected at boot**, not ignored — silently ignoring a
renamed flag would leave a deployment believing it had disabled password login
when it had not.

### Enabling Google

1. Create OAuth 2.0 credentials at
   https://console.cloud.google.com/apis/credentials.
2. Add `<AUTH_URL>/api/auth/callback/google` as an authorized redirect URI.
3. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

### Enabling Resend

1. Get an API key at https://resend.com/api-keys.
2. Set `AUTH_RESEND_KEY` and `EMAIL_FROM`.
3. Verify the sending domain before relying on this in production —
   unverified domains are rate-limited.

## Rate limiting

`src/lib/auth/throttle-policy.ts` (the arithmetic, pure) and
`src/lib/auth/throttle.ts` (the storage).

| Bucket | Window | Failures | Lock |
|---|---|---|---|
| Login, per email | 15 min | 5 | 15 min, escalating to 1 h after 10 |
| Login, per IP | 15 min | 20 | 15 min |
| Registration, per IP | 1 h / 24 h | 5 / 20 | 1 h / 24 h |
| Password reset, per email | 1 h | 3 | 1 h |
| Password reset, per IP | 1 h | 10 | 1 h |

**Postgres, not an in-memory Map.** This deploys as a possibly multi-instance
serverless app: per-instance counters multiply every threshold by the instance
count, a cold start resets them for free, and `next dev` clears them on every
reload — so an in-memory limiter would appear to work while being tested and
fail in production. A sliding count over `auth_attempts` rows is the only
shared state available, costs one indexed COUNT per attempt, and doubles as an
audit trail.

**Where it is enforced.** Inside the Credentials provider's `authorize`, and
**before bcrypt** — a cost-12 hash is ~250ms of CPU, so the verify endpoint is
itself the denial-of-service lever. `signInWithPassword` also pre-checks, but
only so a locked-out user is told "try again in about 12 minutes" instead of
"invalid email or password"; a client can POST straight past that action.

**Enumeration.** Failures are recorded for addresses that do not exist,
identically to ones that do. Without that, "locks out after five tries" would
itself reveal that an account is real — defeating the constant-time bcrypt
comparison the provider goes to some trouble over. The lockout message is
therefore the same either way and safe to show.

**The IP buckets are best-effort.** `x-forwarded-for` is client-supplied and
only trustworthy behind a proxy that overwrites it. They exist to catch
spraying (one attempt each against a thousand addresses never trips a
per-email limit) and are deliberately loose enough not to lock out an office
sharing one address. The email bucket is the real gate.

## Roles

`UserRole { OWNER MEMBER }`. `MEMBER` is the default; `OWNER` is the instance
administrator.

The privilege `OWNER` carries is writing **shared reference data**: the
`Instrument` table and `Candle` bar data, neither of which has a `userId`.
Their contents feed `derivedColumns()` and `resolveConversion()` for every
user, so a wrong `contractSize` is off by orders of magnitude and nothing in
anyone's journal looks broken, just wrong.

This used to be nothing at all: the column defaulted to `OWNER`, `registerUser`
hardcoded `OWNER`, and no code anywhere made an authorization decision on the
value. Under open registration that meant every stranger who signed up was an
instance owner.

Who becomes OWNER — `resolveInitialRole()` in `src/lib/auth/roles.ts`, applied
by both sign-up paths so the route someone registered through cannot decide
their privileges:

- an address listed in `AUTH_OWNER_EMAILS`;
- otherwise, the very first account on the instance;
- otherwise `MEMBER`.

The `auth_hardening` migration demotes everyone and promotes the oldest row,
which is right for an existing database but fragile if one is ever reset —
`AUTH_OWNER_EMAILS` is the durable statement.

Rendering: use `isOwner()` (non-throwing) to hide or disable a control.
`requireOwner()` throws `ForbiddenError`, which action modules convert to
`{ ok: false, formError }` the same way they already convert `NotFoundError`.

## The scoping rule

From `src/lib/session.ts`:

> No query in this app is ever written without a `userId` — or an account row
> that has already been confirmed to belong to the current user — in its WHERE
> clause.

`requireAccountAccess(accountId)` is where that confirmation happens: it loads
the `TradingAccount` filtered by both `id` and `userId`, and throws
`NotFoundError` — deliberately not distinguishing "doesn't exist" from "isn't
yours", so account ids cannot be enumerated. It returns the row so callers
build their queries off it directly.

**Two deliberate exceptions**, both documented where they are defined:
`Instrument` and `Candle` are shared reference data with no `userId` (see
`src/lib/queries/candles.ts` for why duplicating bars per user is the wrong
trade). For those, the rule that replaces the `userId` rule is: **reads are
unscoped, writes are gated by `requireOwner()`**.

## Registration

`registerUser` in `src/lib/actions/auth.ts`, gated by `ALLOW_REGISTRATION`
(default: on). Creates a `User`, a bcrypt hash at cost 12, and a starter
`TradingAccount` ("Main", MT5, DEMO, 10,000 USD), then signs the user in.

Rate-limited per IP, which is what bounds it: two rows per call makes an
unthrottled endpoint a write amplifier.

The form lives on its own page, `/register` (public, outside the middleware
matcher like `/login`), linked both ways with the sign-in page. It used to be a
disclosure under the sign-in form — two Email and two Password fields on one
screen. It asks for the password twice: a typo in a field nobody can see is a
locked account on day one, so `registerUser` refuses a `confirm` that differs.
It is a typo guard, not a security control, and a caller that sends no
`confirm` field is not held to it. Errors render under their field (a client
form with `useActionState`); name and email survive a failed attempt.

Password rules (`src/lib/auth/password.ts`): at least 10 characters, at most
**72 bytes**, not a common password, and not built from the email's local
part. The byte ceiling is bcrypt's: it hashes 72 bytes and discards the rest
silently, so 19 emoji (76 bytes) would produce two different passwords with
the same hash. Rejecting is more honest than truncating. Note this bites
non-Latin passphrases earlier than users expect — Mongolian Cyrillic is two
bytes per character, so 36 characters is the real ceiling.

## Environment

`src/lib/env.ts` validates everything at boot, via `src/instrumentation.ts`.
Before this, `process.env` was read at nineteen call sites and **nothing read
`AUTH_SECRET` at all** — Auth.js checked it internally, so a missing or
placeholder secret failed at the first request rather than at startup.

It enforces, among others: `AUTH_SECRET` at least 32 characters and not the
old `.env.example` placeholder in production; `AUTH_URL` present and https in
production; Google credentials all-or-nothing;
`REQUIRE_EMAIL_VERIFICATION` only with a Resend key. Every problem is reported
at once rather than one per run.

`SKIP_ENV_VALIDATION=1` exists for a CI build with no real database URL, since
`next build` evaluates module scope while collecting pages.

## Password reset

`/forgot-password` → mail → `/reset-password?token=…` (`lib/actions/password-reset.ts`, `lib/auth/reset-token.ts`).
It is available only when password sign-in is on **and** a mail provider is configured. Otherwise both pages say so instead of offering a form that cannot work.

- **No account enumeration.** The request answers the same for every address, whether or not it has an account and whether or not the mail went out. Every request spends from the `PASSWORD_RESET` budget (3 per address and 10 per IP an hour), existing address or not. A budget that only drained for real accounts would itself be the leak.
- **The token:**
  - It is 32 random bytes, emailed raw.
  - Only its SHA-256 is stored, in `verification_tokens` under the identifier `pwreset:<userId>`.
  - It lives 30 minutes, works once, and issuing a new one deletes the old.
  - A plain hash is enough: there is nothing to brute-force in 256 random bits.
- **The namespace closes a trap.** The Resend provider redeems magic-link rows by `identifier === email`, so a reset row stored under a bare email could be redeemed at `/api/auth/callback/resend` to *sign in*. The `pwreset:` prefix can never equal an address.
- **Order of checks.** The token is peeked, the new password is validated against the policy and the confirmation, and only then is the token consumed. Consuming is a `deleteMany` that must remove exactly one row, so two concurrent submits of one link cannot both win. A short password costs a retype, not a new email.
- **Effect.** The hash is replaced, `sessionsValidFrom` is stamped (every session everywhere is dead, see "Session revocation"), and the address's login-failure bucket is cleared. The user lands on `/login?reset=1`.
- **Tests.** `account-lifecycle.db.test.ts` reads the link out of the faked mail, as a user would. Dropping the `sessionsValidFrom` stamp fails it (mutation-checked).

## Deleting an account

Settings → Profile → Delete account (`lib/actions/account-deletion.ts`). The action needs:

- **The account's email, typed back.** This makes the deletion deliberate.
- **Proof beyond the session:**
  - the password, for an account that has one;
  - otherwise a sign-in within the last ten minutes, read from the token's `authAt`.

  A session alone is what a borrowed laptop or a stolen cookie has.
- **Not being the last OWNER while other users remain.** Somebody has to be able to fix the shared instrument table. Alone on an instance, an owner can delete freely.

All user data cascades from `users` (`auth_attempts` keeps its audit rows with the user nulled), so one `DELETE` removes everything atomically. Attachment bytes live outside the database. They are deleted *after* the rows, so a storage failure leaves a reported orphan file rather than a row pointing at nothing. The session is then signed out to `/login?deleted=1`.

## What is not built yet

Named rather than left to be discovered:

- **Email verification enforcement.** The column, the `signIn` gate and
  `requireVerifiedUser()` all exist and honour
  `REQUIRE_EMAIL_VERIFICATION`, but nothing sends the mail yet, so turning it
  on would lock everyone out. `env.ts` refuses that combination without a
  Resend key.
- **Changing a password while signed in.** Only the reset flow sets one;
  a signed-in user who knows their password uses it too.

## Before production

- [ ] Generate a real `AUTH_SECRET` (`openssl rand -base64 32`) as a
      deployment secret. Rotating it invalidates every session.
- [ ] Set `AUTH_URL` to the real https origin. `env.ts` enforces this.
- [ ] Set `AUTH_OWNER_EMAILS` to your own address, and confirm with
      `SELECT email, role FROM users` that exactly one OWNER exists.
- [ ] Decide `ALLOW_REGISTRATION`.
- [ ] Confirm the middleware matcher still covers every route that needs
      gating — and remember it does not cover Server Functions at all, which
      is why the DAL check is not optional.
- [ ] If Google/Resend are configured, confirm the redirect URI and sending
      domain are the production ones.
- [ ] Configure a mail provider (`RESEND_API_KEY` or `AUTH_RESEND_KEY`) if
      users should be able to reset a forgotten password; without one, a
      forgotten password needs database access.

## Verification performed

`npm run verify` (typecheck, lint with `--max-warnings 0`, format check, and 678
unit tests) and
`npm run build` pass. The auth-specific tests cover the redirect sanitiser
including the `/\evil.com` bypass, the throttle window arithmetic and its
escalation ordering, the password byte ceiling, role resolution, environment
validation, and that the middleware matcher and `isPublicPath()` agree —
including the regression case of a protected route that merely contains a dot.

The runtime flows have **not** been exercised end-to-end since these changes:
the Supabase project this was developed against is no longer reachable
(`FATAL: tenant or user not found`), so the `auth_hardening` migration is
written and validated but **not applied**. Run `npm run db:migrate` against a
live database, then confirm by hand: Google sign-up (previously broken two
ways), password sign-in with `ALLOW_DEV_LOGIN` absent, six wrong passwords
producing a lockout message, an unknown address producing the same message and
timing, and a MEMBER seeing the Instruments tab read-only.
