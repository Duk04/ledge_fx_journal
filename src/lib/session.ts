/**
 * The one module every server component, server action, and route handler
 * uses to find out who is signed in and what they may touch.
 *
 * SCOPING RULE: no query in this app is ever written without a `userId` —
 * or an account row that has already been confirmed to belong to the
 * current user — in its WHERE clause. `requireAccountAccess()` below is
 * where that confirmation happens; everything that reads or writes trades,
 * balance events, tags, or journal entries for a given account should call
 * it first and build its Prisma queries off the account row it returns,
 * rather than trusting an `accountId` pulled out of a URL or form field.
 */
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { UserRole, TradingAccount } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  timezone: string;
}

/** The current request's session, cached so repeated calls within one React
 * render pass share a single lookup instead of re-decoding the session
 * cookie on every call site. */
export const getSession = cache(async () => {
  return auth();
});

/**
 * Returns the signed-in user, or redirects to `/login` if there isn't one.
 * This is the entry point almost every server component/action should call
 * first — it's the only place "not signed in" is handled, everything
 * downstream can assume a real user.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  const user = session?.user;

  if (!user?.id) {
    redirect("/login");
  }

  return {
    id: user.id,
    email: user.email ?? "",
    name: user.name ?? null,
    role: user.role,
    timezone: user.timezone,
  };
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
 * The current user's first non-archived trading account, oldest first, or
 * null if they have none. Used to pick a sensible default account for
 * views that need one (e.g. redirecting `/` to `/accounts/:id`).
 */
export async function getDefaultAccountId(): Promise<string | null> {
  const user = await requireUser();

  const account = await prisma.tradingAccount.findFirst({
    where: { userId: user.id, isArchived: false },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  return account?.id ?? null;
}
