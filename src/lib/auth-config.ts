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
      role: UserRole;
      timezone: string;
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

/** Paths middleware never gates. Kept here so the `authorized` callback's
 * notion of "protected" matches the middleware matcher below it. */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico"
  );
}

export const authConfig: NextAuthConfig = {
  // No providers here on purpose — this config is shared with the Edge
  // middleware instance, which only ever calls `auth()` to read/verify the
  // session JWT and never needs to run a provider's `authorize`/OAuth flow.
  providers: [],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      // `user` is only present on the initial sign-in call (from a
      // provider's `authorize()` or the adapter-created user for
      // OAuth/magic-link). Stash what the session needs onto the token.
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.timezone = user.timezone;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string | undefined) ?? session.user.id;
        session.user.role = (token.role as UserRole | undefined) ?? "MEMBER";
        session.user.timezone = (token.timezone as string | undefined) ?? "UTC";
      }
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
