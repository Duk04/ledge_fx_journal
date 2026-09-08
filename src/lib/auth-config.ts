/**
 * Edge-safe half of the Auth.js configuration.
 *
 * This file MUST stay importable from the Edge runtime: no Prisma client,
 * no bcryptjs, no provider that touches the database. `src/middleware.ts`
 * builds its own tiny `NextAuth(authConfig)` instance straight from this
 * file so the compiled middleware bundle never pulls in `@prisma/client`
 * or `bcryptjs` (both are Node-only). The full configuration — providers,
 * the Prisma adapter, credential verification — lives in `src/lib/auth.ts`,
 * which spreads this object and only runs in the Node.js runtime (route
 * handlers, server components, server actions).
 *
 * Session strategy: **JWT**, not database sessions.
 *
 * Auth.js v5's Credentials provider refuses to run under the database
 * session strategy at all — when an `adapter` is configured, the
 * Credentials provider requires `session.strategy === "jwt"` (mixing them
 * throws at startup). Since this app needs both a Credentials-based dev
 * login and adapter-backed OAuth account linking (Google/Resend), the only
 * combination Auth.js actually supports is: keep the adapter (so OAuth
 * accounts link to `User` rows and `AuthAccount`/`VerificationToken` work
 * as documented) but use JWT-encoded session cookies instead of rows in
 * the `Session` table. See docs/AUTH.md for the trade-off this implies
 * (no server-side session revocation list) and why it was accepted.
 */
import type { DefaultSession, NextAuthConfig } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** Seconds-since-epoch when this session was issued. Compared against
       * `User.sessionsValidFrom` by the DAL to implement "sign out
       * everywhere" — see src/lib/session.ts. */
      authAt?: number;
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole;
    timezone?: string;
  }
}

// NOTE: we deliberately do NOT `declare module "next-auth/jwt"` here to add
// `id`/`role`/`timezone` to the `JWT` interface. That's the pattern Auth.js
// documents, but with this project's TypeScript config (moduleResolution:
// "bundler") it fails with "Invalid module name in augmentation, module
// 'next-auth/jwt' cannot be found" even though a plain `import type` from
// the same specifier resolves fine — a resolver quirk around that
// package's subpath `exports`, not a real missing module. `JWT` already
// extends `Record<string, unknown>`, so writing extra fields onto it is
// legal without the augmentation; the `jwt`/`session` callbacks below just
// cast when reading those fields back out.

/**
 * Paths the middleware never gates.
 *
 * This and `src/middleware.ts`'s `config.matcher` are two halves of ONE
 * rule and must change together: the matcher decides whether this callback
 * runs at all, and this decides what happens when it does. A path excluded
 * from the matcher but absent here (or the reverse) is a gap.
 * `src/lib/auth-config.test.ts` asserts they agree.
 *
 * Exported so that test can import it.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/verify-email" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico"
  );
}

export const authConfig: NextAuthConfig = {
  // No providers here on purpose — this config is shared with the Edge
  // middleware instance, which only ever calls `auth()` to read/verify the
  // session JWT and never needs to run a provider's `authorize`/OAuth flow.
  providers: [],
  session: {
    strategy: "jwt",
    /**
     * Stated rather than inherited. Auth.js defaults to a 30-day maxAge and a
     * 24-hour updateAge, and this file previously said neither — so the app's
     * actual session lifetime was not expressed anywhere in the repo, and a
     * stolen cookie was good for a month. Seven days is short enough to bound
     * that and long enough not to be annoying.
     *
     * Literals rather than env reads on purpose: this file must stay
     * importable from the Edge middleware bundle, which cannot load
     * `@/lib/env` (it is `server-only`).
     */
    maxAge: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    /**
     * `user` is only present on the initial sign-in call. The token carries
     * the MINIMUM needed to identify the session: an id, and when it was
     * issued.
     *
     * `role` and `timezone` used to be stashed here too, and that was a bug
     * in two directions. A token is only rewritten on sign-in or after
     * `updateAge`, so a timezone changed in Settings did not take effect for
     * up to 30 days — and neither did a role demotion, which is the one that
     * matters. Both are now read from the database by the DAL on each render
     * (cached per request), which also removes the fail-open defaults the
     * session callback used to apply.
     */
    jwt({ token, user }) {
      if (user) {
        // No id means no identifiable session. Returning null makes Auth.js
        // clear the cookie rather than issue an anonymous one.
        if (!user.id) return null;
        token.id = user.id;
        token.authAt = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    session({ session, token }) {
      const id = typeof token.id === "string" ? token.id : null;
      // Fail closed: a session with no id is treated as signed out by the
      // DAL, rather than defaulting to something and letting it through.
      if (!id || !session.user) return session;
      session.user.id = id;
      session.user.authAt = typeof token.authAt === "number" ? token.authAt : undefined;
      return session;
    },
    authorized({ request, auth }) {
      const { pathname, search } = request.nextUrl;

      if (isPublicPath(pathname)) return true;
      if (auth?.user) return true;

      if (pathname.startsWith("/api/")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return Response.redirect(loginUrl);
    },
  },
};
