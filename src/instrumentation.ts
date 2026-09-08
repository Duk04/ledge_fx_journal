/**
 * Runs once when the server starts, before it handles a request.
 *
 * Its only job here is to import `@/lib/env`, whose module scope validates
 * the environment. That turns a misconfiguration into a startup failure with
 * every problem listed, instead of a 500 on whichever request first happens
 * to touch the missing variable — or worse, silent wrong behaviour, which is
 * what an unset `ALLOW_REGISTRATION` or a placeholder `AUTH_SECRET` produced.
 */
export async function register() {
  // `instrumentation.ts` also runs in the Edge runtime, where `@/lib/env`
  // (and the `server-only` graph it belongs to) has no business being loaded.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/env");
  }
}
