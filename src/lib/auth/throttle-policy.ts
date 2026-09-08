/**
 * The arithmetic of rate limiting, with no I/O.
 *
 * Split from `throttle.ts` on purpose: the decision "given N failures whose
 * most recent was at time T, is this attempt allowed, and if not for how
 * long?" is pure, and it is the part that is easy to get subtly wrong. Here
 * it can be tested against a fixed clock with no database.
 *
 * WHY POSTGRES BACKS THIS AND NOT AN IN-MEMORY MAP
 *
 * (The storage lives in `throttle.ts`; the reasoning belongs with the policy.)
 * This app deploys as a possibly multi-instance serverless application. An
 * in-memory counter would mean each instance keeps its own, so N instances
 * multiply every threshold below by N — five attempts becomes five per
 * instance. A cold start resets it for free, which an attacker can trigger
 * simply by pausing. And `next dev` clears it on every hot reload, so it
 * would appear to work while being tested and fail in production. A shared
 * table is the only state this app has that survives all three.
 */

export interface AttemptBucket {
  /** Failures inside the window, counted since the last success. */
  failures: number;
  /** When the most recent of those failures happened. */
  lastFailureAt: Date | null;
}

export interface ThrottlePolicy {
  /** How far back failures are counted. */
  windowMs: number;
  /** Failures allowed inside the window before locking. */
  maxFailures: number;
  /** How long the lock lasts, measured from the last failure. */
  lockMs: number;
  /**
   * A stricter policy that takes over once its own `maxFailures` is reached.
   * Lets five quick mistakes cost fifteen minutes while sustained guessing
   * costs an hour, without either number having to serve both cases.
   */
  escalateTo?: ThrottlePolicy;
}

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterMs: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Thresholds.
 *
 * The email buckets are the real gate. The IP buckets exist to catch
 * spraying — one attempt each against a thousand addresses never trips a
 * per-email limit — and are best-effort, because a client-supplied
 * `x-forwarded-for` is only trustworthy behind a proxy that overwrites it.
 * They are therefore deliberately loose enough not to lock out an office or a
 * mobile carrier NAT sharing one address.
 */
export const POLICIES = {
  PASSWORD_LOGIN_EMAIL: {
    windowMs: 15 * MINUTE,
    maxFailures: 5,
    lockMs: 15 * MINUTE,
    escalateTo: { windowMs: HOUR, maxFailures: 10, lockMs: HOUR },
  },
  PASSWORD_LOGIN_IP: {
    windowMs: 15 * MINUTE,
    maxFailures: 20,
    lockMs: 15 * MINUTE,
  },
  REGISTER_IP: {
    windowMs: HOUR,
    maxFailures: 5,
    lockMs: HOUR,
    escalateTo: { windowMs: 24 * HOUR, maxFailures: 20, lockMs: 24 * HOUR },
  },
  PASSWORD_RESET_EMAIL: {
    windowMs: HOUR,
    maxFailures: 3,
    lockMs: HOUR,
  },
  PASSWORD_RESET_IP: {
    windowMs: HOUR,
    maxFailures: 10,
    lockMs: HOUR,
  },
  EMAIL_VERIFY_EMAIL: {
    windowMs: HOUR,
    maxFailures: 3,
    lockMs: HOUR,
  },
} as const satisfies Record<string, ThrottlePolicy>;

export type PolicyName = keyof typeof POLICIES;

/**
 * Decides whether one attempt may proceed.
 *
 * The lock is measured from the last failure, not from the first, so
 * continuing to hammer a locked account extends the lock rather than waiting
 * it out. `retryAfterMs` is what to tell the user, and is never negative.
 */
export function decide(bucket: AttemptBucket, policy: ThrottlePolicy, now: Date): ThrottleDecision {
  // Check the strictest applicable policy first: an escalated lock must not
  // be shortened by the base policy's smaller lockMs.
  if (policy.escalateTo) {
    const escalated = decide(bucket, policy.escalateTo, now);
    if (!escalated.allowed) return escalated;
  }

  if (bucket.failures < policy.maxFailures || bucket.lastFailureAt === null) {
    return { allowed: true };
  }

  const unlockAt = bucket.lastFailureAt.getTime() + policy.lockMs;
  const remaining = unlockAt - now.getTime();

  if (remaining <= 0) return { allowed: true };
  return { allowed: false, retryAfterMs: remaining };
}

/**
 * Human-readable wait, for a message shown to whoever is locked out.
 *
 * Rounded up and coarse on purpose: "about 2 minutes" is useful, and a
 * precise countdown would tell someone probing exactly how the limiter is
 * shaped.
 */
export function describeWait(retryAfterMs: number): string {
  const seconds = Math.ceil(retryAfterMs / 1000);
  if (seconds <= 60) return "about a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}
