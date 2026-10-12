/**
 * The test-side half of the `@/lib/auth` mock installed in test/db/setup.ts.
 * Kept in its own module so test files can import it without re-running the
 * setup file's side effects.
 */
export class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`redirect(${to})`);
  }
}

type SessionStub = { user: { id: string; authAt: number } } | null;
const g = globalThis as unknown as { __testSession?: SessionStub };

/** Make subsequent `auth()` calls return a session for `userId`, or none. */
export function signInAs(userId: string | null, authAt: Date = new Date()) {
  g.__testSession = userId ? { user: { id: userId, authAt: Math.floor(authAt.getTime() / 1000) } } : null;
}

export function currentTestSession(): SessionStub {
  return g.__testSession ?? null;
}
