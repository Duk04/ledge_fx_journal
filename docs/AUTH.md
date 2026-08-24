# Authentication

Auth.js v5 (`next-auth@5.0.0-beta.32`) with `@auth/prisma-adapter`, wired
against the `User` / `AuthAccount` / `Session` / `VerificationToken` models
in `prisma/schema.prisma`.

## Session strategy: JWT (not database sessions) — and why

The brief for this layer is "database session strategy," and that's where
this started. It doesn't survive contact with the Credentials provider.

Auth.js v5 **refuses to run the Credentials provider unless
`session.strategy === "jwt"`** whenever an `adapter` is configured — this
app needs the adapter for OAuth account linking (Google) and magic links
(Resend), so the two requirements collide: adapter + Credentials only works
with `strategy: "jwt"`. Auth.js's own docs list this restriction
explicitly; it isn't a workaround someone found, it's the supported
combination. The other option the brief mentions — hand-rolling a `Session`
row for credentials logins inside the `jwt`/`signIn` callback while keeping
`strategy: "database"` for everything else — means running Auth.js in a
mode its own database-adapter code path doesn't expect (it would still try
to look up `Session` by the JWT-derived cookie in ways that don't line up),
so it was passed over in favor of the combination Auth.js actually
supports and documents.

**What this app does:** `session.strategy = "jwt"`. The adapter
(`PrismaAdapter(prisma)`) stays configured and is genuinely used — it's
what creates `User`/`AuthAccount` rows for Google sign-ins and issues/looks
up rows in `VerificationToken` for Resend magic links. It just never
touches the `Session` table: the session itself is a signed JWT sealed
into an httpOnly cookie by Auth.js, verified on every request without a
database round trip.

**The trade-off, stated plainly:** the `Session` table in
`prisma/schema.prisma` (and the `sessions` table it maps to) is currently
**unused**. There is no server-side session list to inspect, and no way to
revoke one signed-in session without rotating `AUTH_SECRET` (which
invalidates *every* session, not just one). If you need per-session
revocation later (e.g. a "sign out this device" button), that means
switching to the "hand-roll sessions for Credentials, database sessions for
everything else" approach the brief describes, or moving off Credentials
entirely and going adapter + database-strategy with only OAuth/magic-link
providers.

## The edge / node split

Next.js middleware runs on the Edge runtime, which cannot load Prisma's
query engine or `bcryptjs`. Two files split the config accordingly:

- **`src/lib/auth-config.ts`** — edge-safe. Session/pages config, the
  `jwt`/`session` callbacks (pure token/session shaping, no I/O), and the
  `authorized` callback that implements the redirect-vs-401 logic. No
  providers, no adapter, no Prisma, no bcryptjs import anywhere in this
  file or anything it imports.
- **`src/lib/auth.ts`** — Node-only. Spreads `authConfig`, adds
  `PrismaAdapter(prisma)`, and builds the real `providers` array
  (Credentials with the bcrypt check, conditionally Google, conditionally
  Resend). This is what every server component, server action, and the
  `/api/auth/[...nextauth]` route handler import `auth`/`signIn`/`signOut`
  from.
- **`src/middleware.ts`** builds its *own*, separate `NextAuth(authConfig)`
  instance directly from the edge-safe config — it does **not** import
  `src/lib/auth.ts` — so the compiled middleware bundle never pulls in
  `@prisma/client` or `bcryptjs`.

### Why `middleware.ts`, not `proxy.ts`

Next.js 16 deprecates the `middleware` file convention in favor of
`proxy`, and pins `proxy.ts` to the Node.js runtime with no way to opt back
into Edge. Since this file specifically needs to run at the edge and must
never bundle Prisma/bcryptjs, it deliberately keeps the `middleware.ts`
name — Next 16's own migration notes say to do exactly this ("If you want
to continue using the edge runtime, keep using middleware").

## Providers

| Provider | Enabled when | Notes |
|---|---|---|
| Credentials (email+password) | `ALLOW_DEV_LOGIN === "true"` | Checked in `src/lib/auth.ts` at module load — refusing to *construct* the provider is the actual gate, not just hiding the UI for it, since the callback route is reachable directly regardless of what the login page renders. Compares against `bcryptjs`; when the user doesn't exist (or has no password set) it still runs `bcrypt.compare` against a fixed dummy hash so "no such account" and "wrong password" take the same time. |
| Google | `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` both non-empty | Standard OAuth; Prisma adapter links the account to a `User` row (creating one if needed). |
| Resend (magic link) | `AUTH_RESEND_KEY` non-empty | Sends from `EMAIL_FROM`. Uses `VerificationToken`. |

### Enabling Google

1. Create OAuth 2.0 credentials at
   https://console.cloud.google.com/apis/credentials.
2. Add `<AUTH_URL>/api/auth/callback/google` as an authorized redirect URI.
3. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env`.

### Enabling Resend

1. Get an API key at https://resend.com/api-keys.
2. Set `AUTH_RESEND_KEY` and `EMAIL_FROM` in `.env`.
3. Verify the sending domain in Resend before relying on this in
   production — unverified domains are rate-limited/sandboxed.

## Session shape

`session.user` carries `id`, `role` (`OWNER | MEMBER`), and `timezone` in
addition to the Auth.js defaults (`name`, `email`, `image`). See the
`declare module "next-auth"` / `declare module "next-auth/jwt"`
augmentation in `src/lib/auth-config.ts`.

## The scoping rule

From `src/lib/session.ts`:

> No query in this app is ever written without a `userId` — or an account
> row that has already been confirmed to belong to the current user — in
> its WHERE clause.

`requireAccountAccess(accountId)` is where that confirmation happens: it
loads the `TradingAccount` filtered by both `id` and `userId`, and throws
`NotFoundError` (rather than a generic 403/permission error) if the row
doesn't come back — deliberately not distinguishing "doesn't exist" from
"exists but isn't yours" in the error, so the app never leaks which
account IDs are in use. It returns the account row so callers build their
Prisma queries off it directly instead of re-fetching.

## Registration

`registerUser` (in `src/lib/actions/auth.ts`) is gated by
`ALLOW_REGISTRATION` — any value other than the literal string `"false"`
(including unset) keeps it enabled. This is intentionally **independent**
of `ALLOW_DEV_LOGIN`: registration creates a `User` row, a bcrypt
`passwordHash`, and a starter `TradingAccount` ("Main", MT5, DEMO, starting
balance 10,000 USD) regardless of whether the Credentials provider is
registered. It then attempts to sign the new user in immediately; if the
Credentials provider isn't registered (`ALLOW_DEV_LOGIN` isn't `"true"`),
that sign-in attempt fails gracefully and the user is sent to `/login` to
sign in through whatever provider *is* configured instead.

## Before production

- [ ] Set `ALLOW_DEV_LOGIN=false` (or unset it) — the Credentials provider
      must not exist in a deployed environment.
- [ ] Generate a real `AUTH_SECRET` (`openssl rand -base64 32`) and set it
      as a deployment secret, not a committed value. Rotating it
      invalidates every active session (see the trade-off above).
- [ ] Set `AUTH_URL` to the real deployed origin.
- [ ] Decide on `ALLOW_REGISTRATION` — leave it on for self-service
      sign-up, or set it to `"false"` for an invite-only deployment.
- [ ] If Google/Resend are configured, confirm the redirect URI / sending
      domain are the production ones, not the dev placeholders.
- [ ] Confirm `src/middleware.ts`'s matcher still covers every route that
      needs protecting — a route added outside it is served unauthenticated.
- [ ] Re-read the "session strategy" trade-off above: there is currently no
      per-session revocation. If that's a requirement before launch, it
      needs its own design pass rather than a config flip.

## Verification performed

`npx tsc --noEmit` was run clean against this layer's files, and the dev
server was started on port 3111 and exercised end-to-end with `curl`:
`GET /` redirecting to `/login`, `GET /login` returning 200, a full
Auth.js CSRF + credentials callback flow against the seeded
`duk@example.com` / `password` account producing a session cookie, and
`GET /` with that cookie no longer redirecting. See the PR/commit
description for the raw transcript.
