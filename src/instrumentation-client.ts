/**
 * Browser-side Sentry, only when NEXT_PUBLIC_SENTRY_DSN is set at build time.
 *
 * Reads `process.env` directly, the one place outside src/lib/env.ts that
 * does: a NEXT_PUBLIC_ variable is inlined into the client bundle at build,
 * and env.ts is part of the server graph that must never reach the browser.
 */
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions } from "@/lib/sentry-options";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({ ...baseSentryOptions, dsn, environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
