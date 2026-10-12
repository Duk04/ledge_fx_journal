# Testing

28 files, 682 tests, all of which run in about a second with no database and
no browser.

```
npm test          # the suite
npm run verify    # typecheck + lint + format:check + test
```

`npm run verify` is the gate. If it passes and `npm run build` passes, the
change is done; if it does not, it is not.

## What the shape of this suite reflects

**Pure logic is tested exhaustively. Wiring is not tested at all.** That is a
deliberate line, not an accident, and it is worth understanding before adding
to it.

The pure layers are where a wrong answer is silent and expensive: a
conversion rate that quietly defaults to 1 misreports a JPY trade by two
orders of magnitude, an indicator that returns a shortened array produces a
look-ahead bug that looks like a *good* backtest, a breakeven threshold that
drifts between two copies makes two reports disagree. None of that throws.
None of it is visible in review. All of it is cheap to pin down with a
function call and an assertion.

The wiring — does this action actually authenticate, does that query actually
filter by `userId` — fails loudly when it fails, and testing it needs a real
Postgres. That tier does not exist yet. See "What is not covered" below, which
names the gap rather than pretending it is closed.

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

**No database tests.** Nothing exercises `requireAccountAccess` against a real
Postgres, or asserts that a MEMBER's `deleteCandles` writes nothing, or that a
query filtered by `account: { userId }` really excludes another user's rows.
The *rules* those depend on are tested; the *wiring* is not. This is the
largest gap, and it sits directly over the authorization layer.

The intended shape: a second vitest project on `*.db.test.ts` with a
`globalSetup` that migrates a scratch schema into a local Postgres, run by a
separate `test:db` script and a separate CI job. Scratch-schema-per-run rather
than testcontainers — no Docker requirement, and it exercises the real
migrations. `dotenv-cli` is already a dependency.

**No component or end-to-end tests.** No jsdom, no Testing Library, no
Playwright. Four e2e flows would be worth having, in this order: register →
dashboard → sign out → sign in; create an account → log a closed trade →
assert the computed P&L, R multiple and session on the detail page (the whole
app's thesis in one test); dashboard and analytics with a range change; the
trades filter and pagination round-tripping through the URL — which is the
test that would have caught the debounce bug fixed in `filter-bar.tsx`.

**No coverage thresholds.** A repo-wide number on a codebase that is ~60%
React components would either be unmeetable or force worthless component
tests. Per-glob thresholds on the pure layers would mean something; there is
no reporter configured yet either way.
