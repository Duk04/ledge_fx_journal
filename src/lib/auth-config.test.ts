import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authConfig, isPublicPath } from "./auth-config";

/**
 * The middleware matcher and `isPublicPath` are two halves of one rule: the
 * matcher decides whether the `authorized` callback runs at all, and
 * `isPublicPath` decides what it does when it does. A path excluded from one
 * but not the other is a gap, and the two live in different files, so nothing
 * but this test keeps them honest.
 *
 * The matcher is read out of the source rather than imported, because
 * `src/middleware.ts` constructs a NextAuth instance at module scope.
 */
function middlewareMatcher(): RegExp {
  const source = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
  const line = source.split("\n").find((l) => l.trim().startsWith('"/((?!'));
  if (!line) throw new Error("Could not find the matcher pattern in src/middleware.ts");
  const pattern = JSON.parse(line.trim().replace(/,$/, "")) as string;
  return new RegExp(`^${pattern}$`);
}

/** True when the middleware would run for this path. */
function matcherRuns(pathname: string): boolean {
  return middlewareMatcher().test(pathname);
}

describe("isPublicPath", () => {
  it.each([
    "/login",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/api/auth/signin",
    "/api/auth/callback/google",
    "/_next/static/chunks/main.js",
    "/manifest.webmanifest",
    "/sw.js",
    "/icons/icon-192.png",
    "/favicon.ico",
  ])("treats %s as public", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/trades",
    "/trades/new",
    "/analytics",
    "/journal/2026-09-08",
    "/settings",
    "/backtest/strategies",
    "/api/export/trades",
    "/api/attachments",
    "/api/backtest/bars",
  ])("treats %s as protected", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe("middleware matcher", () => {
  it("runs for protected app routes", () => {
    for (const path of ["/", "/trades", "/analytics", "/settings", "/backtest/strategies"]) {
      expect(matcherRuns(path), path).toBe(true);
    }
  });

  it("runs for protected API routes", () => {
    // These must be gated: the callback answers them with 401 JSON.
    for (const path of ["/api/export/trades", "/api/attachments", "/api/backtest/bars"]) {
      expect(matcherRuns(path), path).toBe(true);
    }
  });

  it("does not run for the auth endpoints or the sign-in pages", () => {
    for (const path of ["/login", "/forgot-password", "/reset-password", "/verify-email", "/api/auth/signin"]) {
      expect(matcherRuns(path), path).toBe(false);
    }
  });

  it("does not run for static assets", () => {
    for (const path of [
      "/_next/static/chunks/main.js",
      "/manifest.webmanifest",
      "/sw.js",
      "/icons/icon-192.png",
      "/favicon.ico",
      "/screenshot.png",
      "/fonts/inter.woff2",
    ]) {
      expect(matcherRuns(path), path).toBe(false);
    }
  });

  /**
   * The regression test for the actual bug. The old pattern ended with an
   * "any path containing a dot" alternative, so every one of these was served
   * with no middleware — a date with dots, a symbol with a dot, a dotted
   * segment in any future route.
   */
  it("still runs for protected routes that merely CONTAIN a dot", () => {
    for (const path of [
      "/journal/2026.09.08",
      "/trades/EUR.USD",
      "/trades/some.id.with.dots",
      "/analytics/v1.2",
      "/settings/user.name",
    ]) {
      expect(matcherRuns(path), path).toBe(true);
    }
  });

  it("agrees with isPublicPath on every path either of them classifies", () => {
    // The invariant: if the matcher skips a path, that path must be public —
    // otherwise it is protected by nothing. (The converse is allowed: a
    // public path the matcher still runs on is merely a wasted invocation,
    // and `/_next/data` is documented to be invoked regardless.)
    const paths = [
      "/",
      "/login",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/trades",
      "/trades/new",
      "/journal/2026.09.08",
      "/analytics",
      "/settings",
      "/backtest",
      "/api/auth/signin",
      "/api/export/data",
      "/api/backtest/bars",
      "/manifest.webmanifest",
      "/sw.js",
      "/icons/icon-192.png",
      "/favicon.ico",
      "/_next/static/x.js",
    ];

    const unprotected = paths.filter((p) => !matcherRuns(p) && !isPublicPath(p));
    expect(unprotected).toEqual([]);
  });
});

describe("authConfig", () => {
  it("states its session lifetime rather than inheriting the default", () => {
    // Auth.js defaults to 30 days. Leaving it unstated meant the app's real
    // session lifetime was not expressed anywhere in the repo.
    expect(authConfig.session?.maxAge).toBe(60 * 60 * 24 * 7);
    expect(authConfig.session?.updateAge).toBe(60 * 60 * 24);
    expect(authConfig.session?.strategy).toBe("jwt");
  });

  it("registers no providers in the edge-safe half", () => {
    // This config is shared with the Edge middleware bundle, which must never
    // pull in Prisma or bcryptjs.
    expect(authConfig.providers).toEqual([]);
  });

  describe("jwt callback", () => {
    it("carries only an id and an issued-at claim", () => {
      const token = authConfig.callbacks?.jwt?.({
        token: {},
        user: { id: "u1", email: "a@b.c", role: "OWNER", timezone: "Asia/Ulaanbaatar" },
      } as never) as Record<string, unknown> | null;

      expect(token).not.toBeNull();
      expect(token?.id).toBe("u1");
      expect(typeof token?.authAt).toBe("number");
      // Role and timezone are read from the database by the DAL instead, so a
      // demotion takes effect at once rather than after up to a week.
      expect(token?.role).toBeUndefined();
      expect(token?.timezone).toBeUndefined();
    });

    it("returns null when the user has no id, so the cookie is cleared", () => {
      const token = authConfig.callbacks?.jwt?.({ token: {}, user: { id: undefined } } as never);
      expect(token).toBeNull();
    });

    it("passes an existing token through untouched", () => {
      const existing = { id: "u1", authAt: 1_000 };
      const token = authConfig.callbacks?.jwt?.({ token: existing } as never);
      expect(token).toEqual(existing);
    });
  });

  describe("session callback", () => {
    it("copies the id and authAt onto the session", () => {
      const session = authConfig.callbacks?.session?.({
        session: { user: { name: null, email: "a@b.c", image: null } },
        token: { id: "u1", authAt: 1_700_000_000 },
      } as never) as { user?: Record<string, unknown> };

      expect(session.user?.id).toBe("u1");
      expect(session.user?.authAt).toBe(1_700_000_000);
    });

    it("fails closed when the token has no id", () => {
      // No default role, no default id — the DAL treats a session with no id
      // as signed out. The old callback defaulted role to MEMBER here, which
      // is a fail-open pattern once roles gate anything.
      const session = authConfig.callbacks?.session?.({
        session: { user: { name: null, email: "a@b.c", image: null } },
        token: {},
      } as never) as { user?: Record<string, unknown> };

      expect(session.user?.id).toBeUndefined();
      expect(session.user?.role).toBeUndefined();
    });
  });
});
