/**
 * For `error.tsx` boundaries. An error that reaches a boundary is CAUGHT, so
 * Sentry's global handlers never see it; this reports it explicitly.
 *
 * Except when it carries a `digest`: that marks an error thrown on the server
 * and serialised to the client, which `onRequestError` in instrumentation.ts
 * has already reported with its full server-side stack. Reporting the
 * client's digest-only copy as well would double-count every server error.
 */
import * as Sentry from "@sentry/nextjs";

export function reportClientError(error: Error & { digest?: string }) {
  console.error(error);
  if (error.digest) return;
  Sentry.captureException(error);
}
