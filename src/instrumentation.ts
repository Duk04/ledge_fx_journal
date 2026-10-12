/**
 * Runs once when the server starts, before it handles a request.
 *
 * Two jobs:
 *
 * 1. Import `@/lib/env`, whose module scope validates the environment. That
 *    turns a misconfiguration into a startup failure with every problem
 *    listed, instead of a 500 on whichever request first happens to touch the
 *    missing variable — or worse, silent wrong behaviour, which is what an
 *    unset `ALLOW_REGISTRATION` or a placeholder `AUTH_SECRET` produced.
 *
 * 2. Start Sentry, only when SENTRY_DSN is set (see src/lib/sentry-options.ts
 *    for what is and is not sent).
 */
import type { Instrumentation } from "next";

export async function register() {
  // `instrumentation.ts` also runs in the Edge runtime, where `@/lib/env`
  // (and the `server-only` graph it belongs to) has no business being loaded.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("@/lib/env");
    if (env.SENTRY_DSN) {
      const Sentry = await import("@sentry/nextjs");
      const { baseSentryOptions } = await import("@/lib/sentry-options");
      Sentry.init({ ...baseSentryOptions, dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT });
    }
  }

  if (process.env.NEXT_RUNTIME === "edge" && process.env.SENTRY_DSN) {
    // The middleware bundle cannot load env.ts (see the header there), so the
    // edge init reads the one variable it needs directly.
    const Sentry = await import("@sentry/nextjs");
    const { baseSentryOptions } = await import("@/lib/sentry-options");
    Sentry.init({ ...baseSentryOptions, dsn: process.env.SENTRY_DSN, environment: process.env.SENTRY_ENVIRONMENT });
  }
}

/**
 * Every server error Next captures — a Server Component that throws, a route
 * handler, and a Server Action that re-throws past `src/lib/actions/guard.ts`
 * (anything that is not NotFound/Forbidden). Errors an action converts into
 * `{ ok: false }` are expected outcomes, not incidents, and never get here.
 * A no-op when Sentry was not initialised.
 */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
