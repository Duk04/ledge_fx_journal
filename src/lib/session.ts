/**
 * The one module every server component, server action, and route handler
 * uses to find out who is signed in and what they may touch. The Data Access
 * Layer, in the sense Next's own authentication guide uses the term: checks
 * live close to the data, not in a layout.
 *
 * SCOPING RULE: no query in this app is ever written without a `userId` —
 * or an account row that has already been confirmed to belong to the
 * current user — in its WHERE clause. `requireAccountAccess()` below is
 * where that confirmation happens; everything that reads or writes trades,
 * balance events, tags, or journal entries for a given account should call
 * it first and build its Prisma queries off the account row it returns,
 * rather than trusting an `accountId` pulled out of a URL or form field.
 *
 * TWO DELIBERATE EXCEPTIONS to that rule, both documented where they are
 * defined: the `Instrument` table and `Candle` bar data are shared reference
 * data with no `userId` at all (see the header of `src/lib/queries/candles.ts`
 * for why duplicating bars per user is the wrong trade). For those, the rule
 * that replaces the `userId` rule is: reads are unscoped, and every WRITE is
 * gated by `requireOwner()`.
 *
 * WHERE AUTHORITY LIVES. The session cookie carries only a user id and an
 * issued-at claim. Role, timezone and verification status are read from the
 * database on each render (cached per request by React's `cache`), because a
 * JWT is only rewritten on sign-in or after `updateAge` — so a role demotion
 * stashed in a token would not take effect for up to a week.
 */
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { UserRole, TradingAccount } from "@prisma/client";
import { auth } from "@/lib/auth";
import { authFeatures } from "@/lib/auth-features";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { canWriteSharedData } from "@/lib/auth/roles";

// Re-exported so the many call sites that catch these keep importing them
// from here, while the definitions stay free of this module's Auth.js and
// Prisma imports (which is what makes them testable). See src/lib/errors.ts.
export { ForbiddenError, NotFoundError } from "@/lib/errors";
export { canWriteSharedData } from "@/lib/auth/roles";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  timezone: string;
  emailVerified: Date | null;
}

/** The current request's session, cached so repeated calls within one React
 * render pass share a single lookup instead of re-decoding the session
 * cookie on every call site. */
export const getSession = cache(async () => {
  return auth();
});

/**
 * The signed-in user, read from the database, or null.
 *
 * One indexed query per request (deduped by `cache`), and it buys three
 * things a token-only session could not:
 *
 *  - a role or timezone change takes effect immediately;
 *  - a deleted user is signed out at once rather than holding a valid token
 *    for the rest of its lifetime;
 *  - `sessionsValidFrom` works. That column is how "sign out everywhere"
 *    exists at all under a JWT strategy: there is no server-side session row
 *    to delete, so a password reset stamps the user instead and every token
 *    issued before that instant is refused here.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  const id = session?.user?.id;
  if (!id) return null;
  const sid = session?.user?.sid;

  const row = await prisma.user.findUnique({
    where: { id },
    // Explicit columns, not the whole row: `passwordHash` has no business
    // being loaded into a request that only needs to know who is asking.
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      timezone: true,
      emailVerified: true,
      sessionsValidFrom: true,
      // Same query, not a second round-trip: is THIS token signed out? A
      // token minted before `sid` existed has none and cannot be matched;
      // it ages out within the session maxAge.
      revokedSessions: sid ? { where: { sid }, select: { sid: true }, take: 1 } : false,
    },
  });
  if (!row) return null;
  if (row.revokedSessions?.length) return null;

  if (row.sessionsValidFrom) {
    const authAt = session?.user?.authAt;
    // No `authAt` means a token issued before this claim existed, which is
    // necessarily older than any revocation stamp — so it fails closed.
    if (!authAt || authAt * 1000 < row.sessionsValidFrom.getTime()) return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    timezone: row.timezone,
    emailVerified: row.emailVerified,
  };
});

/**
 * Returns the signed-in user, or redirects to `/login` if there isn't one.
 * This is the entry point almost every server component/action should call
 * first — it's the only place "not signed in" is handled, everything
 * downstream can assume a real user.
 *
 * `next` preserves where the user was going. The middleware normally supplies
 * it, but a Server Function is a POST to whatever route it was used on and so
 * never passes through the matcher — this path is the one that actually fires
 * for an expired session mid-form.
 */
export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }

  return user;
}

/**
 * Like `requireUser`, but for anything that must not run for an unverified
 * address. Only meaningful when `REQUIRE_EMAIL_VERIFICATION` is on; when it
 * is off, every account is treated as usable.
 */
export async function requireVerifiedUser(next?: string): Promise<CurrentUser> {
  const user = await requireUser(next);
  if (authFeatures.requireEmailVerification && !user.emailVerified) {
    throw new ForbiddenError("Confirm your email address before doing that.");
  }
  return user;
}

/** Non-throwing role check, for deciding what to RENDER. Pages should hide or
 * disable a control the user cannot use rather than letting them submit and
 * fail. */
export async function isOwner(): Promise<boolean> {
  const user = await getCurrentUser();
  return user ? canWriteSharedData(user.role) : false;
}

/** Requires one of `roles`. Throws `ForbiddenError`; see that class for why
 * it throws rather than redirecting. */
export async function requireRole(...roles: UserRole[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new ForbiddenError();
  }
  return user;
}

/**
 * Requires the instance owner. The gate for every write to shared reference
 * data — see the exceptions paragraph in this file's header.
 */
export async function requireOwner(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canWriteSharedData(user.role)) {
    throw new ForbiddenError("Only the instance owner can change shared data.");
  }
  return user;
}

/**
 * Loads a TradingAccount, scoped to the current user. Throws NotFoundError
 * — never leaks whether the account exists for someone else — if it isn't
 * there or belongs to a different user. Returns the row so callers don't
 * need a second round-trip.
 */
export async function requireAccountAccess(accountId: string): Promise<TradingAccount> {
  const user = await requireUser();

  const account = await prisma.tradingAccount.findFirst({
    where: { id: accountId, userId: user.id },
  });

  if (!account) {
    throw new NotFoundError(`Trading account "${accountId}" was not found.`);
  }

  return account;
}

/**
 * Sends an already-signed-in visitor away from a sign-in page.
 *
 * Called at the top of each page in the `(auth)` group, not from that group's
 * layout: Next's authentication guide is explicit that a layout does not
 * re-render on navigation and does not control whether the rest of the route
 * renders, so a check there is not a gate.
 */
export async function redirectIfAuthenticated(to = "/"): Promise<void> {
  const user = await getCurrentUser();
  if (user) redirect(to);
}
