/**
 * Error types the action layer converts into `{ ok: false, formError }`.
 *
 * Separate from `src/lib/session.ts` (which throws them) so that action
 * modules and tests can `instanceof` them without importing the DAL, and with
 * it `next-auth` and `next/server`.
 */

/**
 * A row that either does not exist or belongs to someone else.
 *
 * Deliberately does NOT distinguish the two. `requireAccountAccess` throws
 * this for another user's account precisely so account ids cannot be
 * enumerated by watching which ones produce a different error.
 */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * A signed-in user who lacks the role for something.
 *
 * Distinct from `NotFoundError`, and the distinction is a judgement rather
 * than a nicety: "you may not change this" is only safe to say about data
 * whose existence is not itself a secret. It fits the shared `Instrument` and
 * `Candle` tables, whose contents every user can already read; it would not
 * fit another user's trade.
 *
 * A thrown error rather than a `redirect()` because server actions return a
 * value to a form and need something to convert into `formError`.
 */
export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
