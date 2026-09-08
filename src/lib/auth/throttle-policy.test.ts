import { describe, expect, it } from "vitest";
import { POLICIES, decide, describeWait, type ThrottlePolicy } from "./throttle-policy";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date("2026-09-08T12:00:00.000Z");

/** `minutesAgo(3)` -> a Date three minutes before NOW. */
function minutesAgo(n: number): Date {
  return new Date(NOW.getTime() - n * MINUTE);
}

const simple: ThrottlePolicy = { windowMs: 15 * MINUTE, maxFailures: 5, lockMs: 15 * MINUTE };

describe("decide", () => {
  it("allows an attempt with no history", () => {
    expect(decide({ failures: 0, lastFailureAt: null }, simple, NOW)).toEqual({ allowed: true });
  });

  it("allows attempts below the threshold", () => {
    expect(decide({ failures: 4, lastFailureAt: minutesAgo(1) }, simple, NOW)).toEqual({ allowed: true });
  });

  it("locks at the threshold", () => {
    const d = decide({ failures: 5, lastFailureAt: minutesAgo(1) }, simple, NOW);
    expect(d.allowed).toBe(false);
  });

  it("reports the remaining time, not the whole lock", () => {
    const d = decide({ failures: 5, lastFailureAt: minutesAgo(5) }, simple, NOW);
    expect(d).toEqual({ allowed: false, retryAfterMs: 10 * MINUTE });
  });

  it("allows again once the lock has elapsed", () => {
    expect(decide({ failures: 5, lastFailureAt: minutesAgo(15) }, simple, NOW)).toEqual({ allowed: true });
    expect(decide({ failures: 99, lastFailureAt: minutesAgo(16) }, simple, NOW)).toEqual({ allowed: true });
  });

  it("measures the lock from the LAST failure, so hammering extends it", () => {
    // Someone who keeps trying while locked resets the clock rather than
    // waiting it out.
    const patient = decide({ failures: 5, lastFailureAt: minutesAgo(14) }, simple, NOW);
    const persistent = decide({ failures: 20, lastFailureAt: minutesAgo(0) }, simple, NOW);
    expect(patient).toEqual({ allowed: false, retryAfterMs: 1 * MINUTE });
    expect(persistent).toEqual({ allowed: false, retryAfterMs: 15 * MINUTE });
  });

  it("never reports a negative wait", () => {
    const d = decide({ failures: 5, lastFailureAt: new Date(NOW.getTime() - 10 * HOUR) }, simple, NOW);
    expect(d).toEqual({ allowed: true });
  });

  it("treats a null lastFailureAt as no lock, whatever the count says", () => {
    // Defensive: a count with no timestamp is inconsistent data, and locking
    // forever on it would be unrecoverable.
    expect(decide({ failures: 100, lastFailureAt: null }, simple, NOW)).toEqual({ allowed: true });
  });

  describe("escalation", () => {
    const escalating: ThrottlePolicy = {
      windowMs: 15 * MINUTE,
      maxFailures: 5,
      lockMs: 15 * MINUTE,
      escalateTo: { windowMs: HOUR, maxFailures: 10, lockMs: HOUR },
    };

    it("applies the base lock below the escalation threshold", () => {
      const d = decide({ failures: 6, lastFailureAt: minutesAgo(5) }, escalating, NOW);
      expect(d).toEqual({ allowed: false, retryAfterMs: 10 * MINUTE });
    });

    it("applies the longer lock at the escalation threshold", () => {
      const d = decide({ failures: 10, lastFailureAt: minutesAgo(5) }, escalating, NOW);
      expect(d).toEqual({ allowed: false, retryAfterMs: 55 * MINUTE });
    });

    it("does not let the base policy shorten an escalated lock", () => {
      // This is the ordering bug worth guarding: at 20 minutes the base lock
      // has expired, and checking it first would return allowed while the
      // hour-long escalated lock still stands.
      const d = decide({ failures: 12, lastFailureAt: new Date(NOW.getTime() - 20 * MINUTE) }, escalating, NOW);
      expect(d).toEqual({ allowed: false, retryAfterMs: 40 * MINUTE });
    });

    it("allows once even the escalated lock has elapsed", () => {
      const d = decide({ failures: 12, lastFailureAt: new Date(NOW.getTime() - 61 * MINUTE) }, escalating, NOW);
      expect(d).toEqual({ allowed: true });
    });
  });
});

describe("POLICIES", () => {
  it("locks a login email bucket after 5 failures and escalates after 10", () => {
    const p = POLICIES.PASSWORD_LOGIN_EMAIL;
    expect(decide({ failures: 4, lastFailureAt: minutesAgo(1) }, p, NOW).allowed).toBe(true);
    expect(decide({ failures: 5, lastFailureAt: minutesAgo(1) }, p, NOW).allowed).toBe(false);
    expect(decide({ failures: 10, lastFailureAt: minutesAgo(30) }, p, NOW).allowed).toBe(false);
  });

  it("is looser per IP than per email, so shared addresses are not locked out", () => {
    // An office or carrier NAT shares one address; the email bucket is the
    // real gate and the IP bucket only catches spraying.
    expect(POLICIES.PASSWORD_LOGIN_IP.maxFailures).toBeGreaterThan(POLICIES.PASSWORD_LOGIN_EMAIL.maxFailures);
  });

  it("caps registration per IP, which is what bounds unbounded user creation", () => {
    const p = POLICIES.REGISTER_IP;
    expect(decide({ failures: 5, lastFailureAt: minutesAgo(1) }, p, NOW).allowed).toBe(false);
  });

  it("every policy has a positive window, threshold and lock", () => {
    for (const [name, policy] of Object.entries(POLICIES)) {
      expect(policy.windowMs, name).toBeGreaterThan(0);
      expect(policy.maxFailures, name).toBeGreaterThan(0);
      expect(policy.lockMs, name).toBeGreaterThan(0);
    }
  });

  it("every escalated policy is strictly stricter than its base", () => {
    for (const [name, policy] of Object.entries(POLICIES)) {
      const escalated = (policy as ThrottlePolicy).escalateTo;
      if (!escalated) continue;
      expect(escalated.maxFailures, name).toBeGreaterThan(policy.maxFailures);
      expect(escalated.lockMs, name).toBeGreaterThanOrEqual(policy.lockMs);
      expect(escalated.windowMs, name).toBeGreaterThanOrEqual(policy.windowMs);
    }
  });
});

describe("describeWait", () => {
  it.each([
    [1_000, "about a minute"],
    [60_000, "about a minute"],
    [61_000, "about 2 minutes"],
    [10 * MINUTE, "about 10 minutes"],
    [59 * MINUTE, "about 59 minutes"],
    [HOUR, "about an hour"],
    [90 * MINUTE, "about 2 hours"],
    [3 * HOUR, "about 3 hours"],
  ])("%dms -> %s", (ms, expected) => {
    expect(describeWait(ms)).toBe(expected);
  });

  it("rounds up, so the stated wait is never too short", () => {
    expect(describeWait(61_000)).toBe("about 2 minutes");
  });
});
