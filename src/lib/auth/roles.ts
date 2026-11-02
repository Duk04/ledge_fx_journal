import type { UserRole } from "@prisma/client";

/**
 * Role rules, with no I/O and no Auth.js — so they can be unit-tested.
 *
 * They started out inside `src/lib/session.ts`, which is where they read most
 * naturally, but that module imports `@/lib/auth` and so drags in `next-auth`
 * and `next/server`; neither resolves outside a Next runtime. A rule that
 * decides who may rewrite every user's P&L inputs should not be untestable
 * because of a transitive import, so it lives here and `session.ts`
 * re-exports it.
 */

/**
 * OWNER is the instance administrator: the only role permitted to WRITE the
 * shared `Instrument` and `Candle` tables. Those tables have no `userId` —
 * one row per symbol, one row per bar, shared by every account — and their
 * contents feed `derivedColumns()` and `resolveConversion()` for everyone. A
 * wrong `contractSize` is off by orders of magnitude and nothing in the
 * journal looks broken, just wrong.
 *
 * Reads of those tables are unscoped by design; see the scoping-rule
 * exceptions in `src/lib/session.ts`.
 */
export function canWriteSharedData(role: UserRole): boolean {
  return role === "OWNER";
}

/**
 * The role a new account gets.
 *
 * Both callers matter: `registerUser` for password sign-ups, and the `signIn`
 * callback for adapter-created OAuth and magic-link users. They must agree,
 * or which route someone signed up through would decide whether they can
 * rewrite shared data.
 *
 * This used to be a hardcoded `role: "OWNER"` in `registerUser`, on top of a
 * column that also defaulted to OWNER — so with open registration every
 * stranger who signed up became an instance owner.
 *
 * A NAMED ADDRESS IS NOT PROOF OF THE MAILBOX. `AUTH_OWNER_EMAILS` says who
 * should own the instance; a password sign-up for that address proves only
 * that someone typed it. So where the instance can prove a mailbox (Google,
 * or magic-link email), a named address becomes OWNER only through a sign-in
 * that did — otherwise a stranger who registered `ops@…` with a password
 * before the operator did would own the instance. An instance with no way to
 * prove one takes the operator's list at its word, as it always has.
 */
export function resolveInitialRole(params: {
  email: string;
  ownerEmails: readonly string[];
  isFirstUser: boolean;
  /** This sign-in proved control of the address (OAuth or a magic link). */
  provedMailbox: boolean;
  /** The instance offers a way to prove one at all (Google or magic link). */
  instanceCanProve: boolean;
}): UserRole {
  const named = params.ownerEmails.includes(params.email.trim().toLowerCase());
  const trusted = params.provedMailbox || !params.instanceCanProve;
  return (named && trusted) || params.isFirstUser ? "OWNER" : "MEMBER";
}
