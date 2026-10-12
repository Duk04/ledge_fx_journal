/**
 * Per-file setup for the `db` vitest project. Runs before each test file's
 * own imports, which is what lets it point `@/lib/db` at the scratch schema
 * and replace the framework edges before any app module loads.
 *
 * What is mocked, and why only this:
 * - `@/lib/auth` — Auth.js decodes a session cookie from a request, and there
 *   is no request here. The mock answers `auth()` from `signInAs()` (in
 *   ./auth.ts), so
 *   everything downstream of it — getCurrentUser's database lookup, the
 *   sessionsValidFrom check, requireAccountAccess's scoped query — runs for
 *   real. Mocking any lower would test the mock.
 * - `next/cache` — revalidatePath needs a Next request store.
 * - `next/navigation` — redirect() throws a framework-internal error; here it
 *   throws a recognisable RedirectError (./auth.ts) instead, so a test can
 *   assert on it.
 */
import { inject, vi } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");

vi.mock("@/lib/auth", async () => {
  const { currentTestSession, RedirectError } = await import("./auth");
  return {
    auth: async () => currentTestSession(),
    // The real signOut clears the cookie and redirects; here, just redirect.
    signOut: async ({ redirectTo }: { redirectTo?: string } = {}) => {
      throw new RedirectError(redirectTo ?? "/");
    },
    signIn: async () => {
      throw new Error("signIn is not available in db tests");
    },
    AuthError: class AuthError extends Error {},
    BCRYPT_COST: 4,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

vi.mock("next/navigation", async () => {
  const { RedirectError } = await import("./auth");
  return {
    redirect: (to: string) => {
      throw new RedirectError(to);
    },
    notFound: () => {
      throw new RedirectError("/404");
    },
  };
});
