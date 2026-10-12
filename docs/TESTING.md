# Testing

Three tiers, three commands:

```
npm test          # unit: pure logic, ~700 tests in about a second, no I/O
npm run test:db   # db: the authorization wiring against a real Postgres
npm run test:e2e  # e2e: four user flows in Chrome against a production build
npm run verify    # typecheck + lint + format:check + unit — the gate
```

`npm run verify` is the gate for every change. If it passes and `npm run
build` passes, the change is done. CI runs all three tiers on every push, as
three separate jobs (`.github/workflows/ci.yml`), so a red job says which kind
of thing broke.

`test:db` and `test:e2e` need a Postgres they can create a schema in:
`TEST_DATABASE_URL` / `E2E_DATABASE_URL`, falling back to `DATABASE_URL`. Each
run migrates a fresh scratch schema (`test_…` / `e2e_…`) from the committed
migrations and drops it at the end — nothing outside that schema is touched,
so pointing either at your dev database is safe.

## What the shape of this suite reflects

**Pure logic is tested exhaustively; wiring is tested at its load-bearing
points only.** That is a deliberate line, not an accident, and it is worth
understanding before adding to it.

The pure layers are where a wrong answer is silent and expensive: a
conversion rate that quietly defaults to 1 misreports a JPY trade by two
orders of magnitude, an indicator that returns a shortened array produces a
look-ahead bug that looks like a *good* backtest, a breakeven threshold that
drifts between two copies makes two reports disagree. None of that throws.
None of it is visible in review. All of it is cheap to pin down with a
function call and an assertion.

The wiring — does this action actually authenticate, does that query actually
filter by `userId` — needs a real Postgres to test. The `db` tier covers the
authorization layer (below); it is deliberately not a mirror of every action.

## The tiers that do exist

**Domain and numeric logic** — `src/lib/metrics/*`, `src/lib/backtest/*`,
`src/lib/candles/*`, `src/lib/risk.ts`, `src/lib/conversion.ts`,
`src/lib/trade-service.ts`, `src/lib/decimal-bridge.ts`, `src/lib/range.ts`.

Every stored money column is computed here. The tests assert specific
numbers, not shapes: a 50-pip win on one lot of EURUSD is $500 gross and
$496.50 net of a $3.50 commission, and a JPY-quoted trade converts at 1/exit
rather than 1/entry.

**Input validation** — `src/lib/schemas/trade.ts`,
`src/components/trades/trade-form-values.ts`,
`src/lib/backtest/sim-trade-schema.ts`, `src/lib/storage.ts`.

Everything crossing from a browser into the database. `parseTradeForm` is the
gate every trade write passes through; `sniffImage` is the upload validator on
an app with open registration, so an SVG with a script tag, a PHP file and a
signature at a non-zero offset are all covered.

**Security rules** — `src/lib/auth/*`, `src/lib/auth-config.ts`,
`src/lib/env.ts`, `src/lib/errors.ts`.

The *decidable* parts of authentication: the redirect sanitiser (including the
`/\evil.com` bypass that the previous prefix-check let through), the throttle
window arithmetic and its escalation ordering, the bcrypt 72-byte ceiling,
role resolution, environment validation, and that the middleware matcher and
`isPublicPath()` agree on every path either of them classifies.

**Structural guards** — `src/lib/actions/server-action-surface.test.ts`.

Asserted against source text, no runtime involved. Every export of a
`"use server"` module authenticates; no server action reaches
`compileStrategy`; the backtest barrel does not re-export the sandbox. This is
the regression guard for the server-side-RCE fix, and it is the highest-value
test in the repository: it cannot be satisfied by accident, and it costs
nothing to run.

## Two tests that assert the opposite of what you would expect

`src/lib/backtest/sandbox.test.ts` asserts that sandbox escapes **succeed** —
`Object.constructor("return 1")()`, `(0, eval)("1")`, and
`"".constructor.constructor("return 1")()` from a bare string literal. They are
not a bug being tracked. They are the executable form of the argument in
`sandbox.ts`'s header, and they exist so that nobody reads the allowlist,
concludes it is a security boundary, and moves the strategy compiler back onto
the server. If one starts failing because someone added a shadow, that shadow
closed one route, not the class.

`src/lib/actions/result.test.ts` includes a type-level assertion
(`@ts-expect-error` on reading a payload off the failure arm). The bug it pins
was a type that compiled: `ActionResult & { runId?: string }` made `runId`
optional on both arms, so reading it on a failure typechecked and returned
undefined.

## Conventions

- Tests live next to the code, as `*.test.ts`. `vitest.config.mts` includes
  `src/**/*.test.ts` and nothing else.
- No mocking. Every test so far calls a real function with real arguments.
  When the DB tier arrives it will need `vi.mock` in a few places; until then,
  the absence is a feature — a test with three mocks asserts the mocks.
- Fixtures are built in the test, not loaded from files. `storage.test.ts`
  constructs PNG, JPEG, WebP and AVIF byte buffers inline so what each test
  claims about the format is visible in the test.
- Assertions carry the *reason* in a comment when the expected value is a
  judgement rather than arithmetic.

## Two configuration details that are load-bearing

**`server-only` is aliased to a stub.** That package's entry point is a bare
`throw`, which is how importing a server module from a client component fails
at build time. Outside an RSC graph — which is where vitest runs — the throw
fires on import, making every server-only module untestable. The alias points
at `test/stubs/server-only.ts`. Pointing it at the package's own `empty.js`
does not work: that file exists but is not listed as a subpath in its
`exports`.

**`SKIP_ENV_VALIDATION=1` is set for the suite.** `src/lib/env.ts` validates
the environment in module scope on purpose, so a misconfigured deployment
fails at boot rather than on whichever request first touches a missing
variable. Tests have no real database URL and should not need one to exercise
a metrics function that happens to sit in the same import graph. The
validation *rules* are still tested — `env.test.ts` calls `parseEnv()`
directly with fabricated environments, which is why that function is exported
separately from the singleton.

## What is not covered

Named rather than left to be discovered.

**Database tests cover authorization, not every action.** The `db` project
(`src/**/*.db.test.ts`, `test/db/`) runs against Postgres with only the
framework edges mocked: `@/lib/auth` answers from `signInAs()`, `next/cache`
is a no-op, `next/navigation`'s `redirect` throws a recognisable
`RedirectError`. Everything below that — `getCurrentUser`'s lookup and its
`sessionsValidFrom` revocation, `requireAccountAccess`'s scoped query,
`requireOwner` — is real. Covered: another user's account is a NotFound and
`createTrade` writes nothing to it; a foreign tag is refused; a MEMBER's
`deleteCandles` deletes nothing; a revoked token is rejected; `createTrade`
stores the derived columns. Verified by mutation: dropping `userId` from
`requireAccountAccess`'s WHERE clause fails two of these tests. New actions
that write user data should add a case here.

**End-to-end covers four flows, not the app.** `e2e/` (Playwright, Chrome)
runs the flows this section used to list as missing, in this order: register
→ dashboard → sign out → sign in; create an account → log a closed trade →
the computed P&L, R multiple, pips, holding time and session on the detail
page; dashboard and analytics with a range change; the trades search and
pagination round-tripping through the URL. The first one found that sign-out
had never worked — the `<form>` inside the Radix menu item was unmounted when
the menu closed, and the browser cancelled the submit — which is the argument
for this tier in one bug. The browser timezone is pinned to
Asia/Ulaanbaatar, the default `User.timezone`, so wall-clock assertions do not
depend on the machine.

Every spec runs in English (`locale: "en-US"` in `playwright.config.ts`) and
selects by exact English labels — which is why translating the app kept the
English text byte-for-byte (`docs/I18N.md`). `e2e/i18n.spec.ts` is the one
exception: on a user of its own, it switches to Mongolian and checks the
choice survives a sign-in from an English browser and reaches a validation
message.

Still no component tests (no jsdom, no Testing Library): the e2e tier covers
the interactions that matter, and a render test of a design-system primitive
mostly re-asserts its markup.

**No coverage thresholds.** A repo-wide number on a codebase that is ~60%
React components would either be unmeetable or force worthless component
tests. Per-glob thresholds on the pure layers would mean something; there is
no reporter configured yet either way.
