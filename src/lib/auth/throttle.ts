import "server-only";
import type { AuthAttemptKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { POLICIES, type PolicyName, type ThrottleDecision, decide, describeWait } from "@/lib/auth/throttle-policy";

/**
 * Storage for the rate limiter. The arithmetic is in `throttle-policy.ts`,
 * which explains why this is a Postgres table and not an in-memory Map.
 *
 * The window is a sliding count over `AuthAttempt` rows rather than a single
 * counter row per key. That costs one indexed COUNT per attempt — nothing at
 * this scale — and buys two things: the decision stays a pure function of
 * (failures, lastFailureAt), and the rows are a genuine audit trail of what
 * was tried against which address.
 */

export interface ThrottleKey {
  policy: PolicyName;
  kind: AuthAttemptKind;
  /** Lowercased email, or null when keying by IP. */
  email?: string | null;
  /** Client IP, or null when keying by email. */
  ip?: string | null;
}

export type ThrottleResult = { allowed: true } | { allowed: false; retryAfterMs: number; message: string };

/**
 * The client's IP, as far as it can be known.
 *
 * `x-forwarded-for` is a client-supplied header: it is only trustworthy
 * behind a proxy that OVERWRITES it (Vercel, Cloudflare, a correctly
 * configured nginx). Behind nothing, a caller can send whatever they like and
 * defeat every IP bucket by rotating it. That is why the email buckets are
 * the real gate and the IP buckets are a secondary net against spraying — see
 * the note on POLICIES.
 *
 * Takes the FIRST entry, which is the original client when the proxy appends
 * correctly. Never read an IP from a form field or a credential.
 */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return null;
}

/**
 * Failures since the last success, inside the policy window, plus when the
 * most recent one happened.
 *
 * "Since the last success" is what makes a successful sign-in reset the
 * bucket without deleting the audit rows.
 */
async function bucketFor(key: ThrottleKey, windowMs: number, now: Date) {
  const where = {
    kind: key.kind,
    ...(key.email ? { email: key.email } : {}),
    ...(key.ip ? { ip: key.ip } : {}),
    createdAt: { gte: new Date(now.getTime() - windowMs) },
  };

  const lastSuccess = await prisma.authAttempt.findFirst({
    where: { ...where, success: true },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const failureWhere = {
    ...where,
    success: false,
    ...(lastSuccess ? { createdAt: { gt: lastSuccess.createdAt } } : {}),
  };

  const [failures, latest] = await Promise.all([
    prisma.authAttempt.count({ where: failureWhere }),
    prisma.authAttempt.findFirst({
      where: failureWhere,
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return { failures, lastFailureAt: latest?.createdAt ?? null };
}

/**
 * Checks every key and returns the first refusal.
 *
 * Callers pass both buckets that apply — the email one and the IP one — so a
 * single call covers both. An empty key (no email and no IP) is skipped
 * rather than treated as a global bucket, which would let one locked-out
 * client lock out everybody.
 */
export async function checkThrottle(keys: ThrottleKey[]): Promise<ThrottleResult> {
  const now = new Date();

  for (const key of keys) {
    if (!key.email && !key.ip) continue;

    const policy = POLICIES[key.policy];
    const bucket = await bucketFor(key, policy.windowMs, now);
    const decision: ThrottleDecision = decide(bucket, policy, now);

    if (!decision.allowed) {
      return {
        allowed: false,
        retryAfterMs: decision.retryAfterMs,
        // Identical whether or not the address exists — see recordAttempt.
        message: `Too many attempts. Try again in ${describeWait(decision.retryAfterMs)}.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Records one attempt.
 *
 * ENUMERATION SAFETY: failures are recorded for addresses that do not exist,
 * exactly as for ones that do. Skipping the write for unknown emails would
 * make "locks out after five tries" a signal that the account is real, which
 * is the thing the constant-time bcrypt comparison in `auth.ts` already goes
 * to some trouble to avoid leaking. The lockout message is the same either
 * way, so it is safe to show.
 */
export async function recordAttempt(params: {
  kind: AuthAttemptKind;
  email?: string | null;
  ip?: string | null;
  success: boolean;
  userId?: string | null;
}): Promise<void> {
  await prisma.authAttempt.create({
    data: {
      kind: params.kind,
      email: params.email ? params.email.trim().toLowerCase().slice(0, 320) : null,
      ip: params.ip ?? null,
      success: params.success,
      userId: params.userId ?? null,
    },
  });
}

/**
 * Marks the bucket clean after a genuine success.
 *
 * Writes a success row rather than deleting failures: `bucketFor` counts only
 * failures newer than the last success, so this resets the window while
 * leaving the history intact.
 */
export async function clearFailures(kind: AuthAttemptKind, email: string, userId?: string): Promise<void> {
  await recordAttempt({ kind, email, success: true, userId });
}

/**
 * Deletes attempt rows older than a day.
 *
 * Called opportunistically from the slow paths (registration, password reset)
 * and never from the login hot path. The table is only ever read through a
 * windowed query, so old rows affect nothing but size — this is housekeeping,
 * not correctness, and it is fine for it to run late or not at all.
 */
export async function pruneOldAttempts(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    await prisma.authAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } });
  } catch {
    // Housekeeping must never fail the request it was attached to.
  }
}
