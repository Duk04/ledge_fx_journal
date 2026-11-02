import "server-only";
import type { TradingAccount } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { requireAccountAccess, requireOwner, type CurrentUser } from "@/lib/session";
import { failT, tr, type ErrorKey } from "@/i18n/server-t";
import { fail, type ActionFailure, type ActionResult } from "./result";

/**
 * Converting the DAL's thrown errors into the action-result convention.
 *
 * `requireAccountAccess` throws `NotFoundError` for an account that is
 * missing OR belongs to another user — deliberately indistinguishable, so
 * account ids cannot be enumerated (see src/lib/session.ts). Actions must not
 * throw at a form, so every write funnelled that through the same six-line
 * try/catch. It appeared eight times: six in `trades.ts` alone, plus
 * `accounts.ts` (which had already extracted a local helper for it) and
 * `backtests.ts`.
 *
 * Anything that is NOT one of these errors is re-thrown. A connection failure
 * is a 500, not a field error, and swallowing it into `{ ok: false }` would
 * turn an outage into "that account was not found".
 */

/**
 * The account, if the current user owns it, or a ready-made failure result.
 *
 *     const found = await accountOrFailure(accountId);
 *     if ("failure" in found) return found.failure;
 *     // found.account is a TradingAccount this user owns
 *
 * Returned rather than taken as a callback deliberately. A
 * `withAccount(id, async (account) => { ... })` wrapper reads better in
 * isolation, but six of the eight call sites are near the top of a
 * forty-line function, and wrapping them would re-indent every one — turning
 * a deduplication into a diff nobody can review. Three lines that say what
 * they do beat one line that costs a whole-function rewrite.
 *
 * The account ROW comes back, not just a boolean, so callers build their
 * queries off the row that was checked rather than off the `accountId` they
 * were handed. That is the scoping rule.
 */
export async function accountOrFailure(
  accountId: string,
  /**
   * Overrides the message. The default is `errors.accountNotFound` in the
   * reader's language — never `requireAccountAccess`'s own message, which
   * names the id in English and is meant for a log.
   */
  message?: string,
): Promise<{ account: TradingAccount } | { failure: ActionFailure }> {
  try {
    return { account: await requireAccountAccess(accountId) };
  } catch (err) {
    // Not err.message: that names the id, in English, for a log — the
    // reader gets a sentence in their own language.
    if (err instanceof NotFoundError) return { failure: fail(message ?? (await tr("accountNotFound"))) };
    throw err;
  }
}

/**
 * Same conversion for a lookup that is not account-scoped — a run id, a
 * strategy id — where the DAL or the action itself throws `NotFoundError`.
 */
export async function guardNotFound<T>(body: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof NotFoundError) return fail(err.message);
    throw err;
  }
}

/**
 * The instance owner, or a ready-made failure result — `accountOrFailure`'s
 * shape, for the writes to shared reference data (Instrument, Candle) that
 * AGENTS.md gates on `requireOwner()`.
 *
 *     const owner = await ownerOrFailure("ownerOnlyImportCandles");
 *     if ("failure" in owner) return owner.failure;
 *
 * `message` names the operation that was refused, in the reader's language,
 * rather than a bare "forbidden". This replaced four hand-written copies of
 * the same try/catch — and a callback-style `withOwner` that nothing called —
 * one of which was simply missing from `importCandles`, letting any member
 * overwrite every user's bars.
 */
export async function ownerOrFailure(message: ErrorKey): Promise<{ user: CurrentUser } | { failure: ActionFailure }> {
  try {
    return { user: await requireOwner() };
  } catch (err) {
    if (err instanceof ForbiddenError) return { failure: await failT(message) };
    throw err;
  }
}
