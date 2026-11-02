import type { UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canWriteSharedData, resolveInitialRole } from "./roles";

const ROLES: UserRole[] = ["OWNER", "MEMBER"];

describe("canWriteSharedData", () => {
  it("allows OWNER and refuses MEMBER", () => {
    expect(canWriteSharedData("OWNER")).toBe(true);
    expect(canWriteSharedData("MEMBER")).toBe(false);
  });

  it("grants the privilege to exactly one role", () => {
    // The shared Instrument and Candle tables feed every user's P&L
    // arithmetic. This being a single-role privilege is the point of it, and
    // if a role is ever added this fails until someone decides where it sits.
    expect(ROLES.filter(canWriteSharedData)).toEqual(["OWNER"]);
  });
});

/** A sign-in that proved the mailbox, on an instance that can. */
const PROVEN = { provedMailbox: true, instanceCanProve: true };

describe("resolveInitialRole", () => {
  it("makes the very first account the owner", () => {
    // Whoever sets the instance up needs to be able to administer it.
    expect(resolveInitialRole({ email: "a@b.c", ownerEmails: [], isFirstUser: true, ...PROVEN })).toBe("OWNER");
  });

  it("makes every subsequent account a member", () => {
    // The regression this exists for: registerUser hardcoded OWNER and the
    // column defaulted to OWNER, so with open registration every stranger
    // who signed up became an instance owner.
    expect(resolveInitialRole({ email: "a@b.c", ownerEmails: [], isFirstUser: false, ...PROVEN })).toBe("MEMBER");
  });

  it("promotes an address named in AUTH_OWNER_EMAILS", () => {
    expect(
      resolveInitialRole({
        email: "admin@example.com",
        ownerEmails: ["admin@example.com"],
        isFirstUser: false,
        ...PROVEN,
      }),
    ).toBe("OWNER");
  });

  it("matches the named address case-insensitively and ignores surrounding space", () => {
    expect(
      resolveInitialRole({
        email: "  Admin@Example.COM ",
        ownerEmails: ["admin@example.com"],
        isFirstUser: false,
        ...PROVEN,
      }),
    ).toBe("OWNER");
  });

  it("does not promote an address that merely resembles a named one", () => {
    expect(
      resolveInitialRole({
        email: "admin@example.com.evil.test",
        ownerEmails: ["admin@example.com"],
        isFirstUser: false,
        ...PROVEN,
      }),
    ).toBe("MEMBER");
    expect(
      resolveInitialRole({
        email: "notadmin@example.com",
        ownerEmails: ["admin@example.com"],
        isFirstUser: false,
        ...PROVEN,
      }),
    ).toBe("MEMBER");
  });

  it("does not promote a named address on a sign-up that proved nothing, where proof was possible", () => {
    // A password registration for the owner's address, before the owner
    // signed in with Google: that is a stranger, not the owner.
    const named = { email: "admin@example.com", ownerEmails: ["admin@example.com"], isFirstUser: false };
    expect(resolveInitialRole({ ...named, provedMailbox: false, instanceCanProve: true })).toBe("MEMBER");
    // With no way to prove a mailbox on this instance, the list is trusted.
    expect(resolveInitialRole({ ...named, provedMailbox: false, instanceCanProve: false })).toBe("OWNER");
    // The very first account is the owner either way.
    expect(resolveInitialRole({ ...named, isFirstUser: true, provedMailbox: false, instanceCanProve: true })).toBe(
      "OWNER",
    );
  });

  it("handles several named owners", () => {
    const ownerEmails = ["a@x.test", "b@x.test"];
    expect(resolveInitialRole({ email: "b@x.test", ownerEmails, isFirstUser: false, ...PROVEN })).toBe("OWNER");
    expect(resolveInitialRole({ email: "c@x.test", ownerEmails, isFirstUser: false, ...PROVEN })).toBe("MEMBER");
  });
});
