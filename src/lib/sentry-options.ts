/**
 * Sentry options shared by the server, edge and browser inits. Pure — no
 * `server-only`, no env access — because instrumentation-client.ts imports it
 * too, and so that `scrubEvent` is unit-testable.
 *
 * Sentry is OFF unless a DSN is configured (SENTRY_DSN for the server,
 * NEXT_PUBLIC_SENTRY_DSN for the browser). A self-hosted journal with no
 * Sentry project should behave exactly as it did before this existed.
 *
 * What is deliberately never sent: a trading journal's request bodies are its
 * contents — notes, prices, account balances, and strategy source code (which
 * docs/BACKTEST-ENGINE.md treats as the user's private work). Server Action
 * POST bodies would carry all of it. So `sendDefaultPii` is off, and
 * `scrubEvent` strips request bodies, cookies and query strings from every
 * event regardless of what an integration attached.
 */
import type { ErrorEvent } from "@sentry/nextjs";

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      const headers = { ...event.request.headers };
      for (const name of Object.keys(headers)) {
        if (/^(cookie|authorization|x-forwarded-for)$/i.test(name)) delete headers[name];
      }
      event.request.headers = headers;
    }
  }
  if (event.user) {
    // An id is enough to group a user's errors; their email is not ours to ship.
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  return event;
}

export const baseSentryOptions = {
  sendDefaultPii: false,
  // Errors only. Performance tracing is a separate decision with its own
  // volume and cost, not something to switch on as a side effect.
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
} as const;
