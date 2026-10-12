import { beforeEach, describe, expect, it, vi } from "vitest";
import { unsubscribeUrl, verifyUnsubscribe } from "./unsubscribe";

describe("unsubscribe links", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "a".repeat(32));
  });

  function parts(url: string) {
    const u = new URL(url);
    return { u: u.searchParams.get("u")!, k: u.searchParams.get("k")!, s: u.searchParams.get("s")! };
  }

  it("a link it signed verifies", () => {
    const { u, k, s } = parts(unsubscribeUrl("https://ledger.test", "user-1", "JOURNAL_REMINDER"));
    expect(verifyUnsubscribe(u, k, s)).toBe(true);
  });

  it("the signature is bound to the user and the kind", () => {
    const { s } = parts(unsubscribeUrl("https://ledger.test", "user-1", "JOURNAL_REMINDER"));
    expect(verifyUnsubscribe("user-2", "JOURNAL_REMINDER", s)).toBe(false);
    expect(verifyUnsubscribe("user-1", "WEEKLY_SUMMARY", s)).toBe(false);
  });

  it("rejects unknown kinds, empty and truncated signatures", () => {
    const { s } = parts(unsubscribeUrl("https://ledger.test", "user-1", "WEEKLY_SUMMARY"));
    expect(verifyUnsubscribe("user-1", "EVERYTHING", s)).toBe(false);
    expect(verifyUnsubscribe("user-1", "WEEKLY_SUMMARY", "")).toBe(false);
    expect(verifyUnsubscribe("user-1", "WEEKLY_SUMMARY", s.slice(0, -1))).toBe(false);
  });

  it("rotating AUTH_SECRET invalidates old links", () => {
    const { u, k, s } = parts(unsubscribeUrl("https://ledger.test", "user-1", "WEEKLY_SUMMARY"));
    vi.stubEnv("AUTH_SECRET", "b".repeat(32));
    expect(verifyUnsubscribe(u, k, s)).toBe(false);
  });
});
