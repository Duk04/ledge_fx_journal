import "server-only";
import * as Sentry from "@sentry/nextjs";

/**
 * For failures a server action deliberately SWALLOWS — work that must not
 * fail the user's request but should not vanish either (a blob left behind
 * after its rows were deleted). An error that propagates is already
 * reported by `onRequestError` in instrumentation.ts; this is for the ones
 * that don't. A no-op beyond the log when Sentry has no DSN.
 */
export function reportError(error: unknown, context: Record<string, string | number | boolean> = {}): void {
  console.error(error, context);
  Sentry.captureException(error, { extra: context });
}
