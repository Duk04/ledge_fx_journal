/**
 * The authorization WIRING, against a real Postgres. The rules these rely on
 * (roles.test.ts, auth-config.test.ts) are unit-tested already; what was
 * never tested is that the queries enforcing them actually do. See
 * docs/TESTING.md, "No database tests".
 */
import { describe, expect, it } from "vitest";
import { signInAs, RedirectError } from "../../test/db/auth";
import { createAccount, createUser } from "../../test/db/factories";
import {
  getCurrentUser,
  NotFoundError,
  requireAccountAccess,
  requireOwner,
  requireUser,
  ForbiddenError,
} from "./session";

describe("requireAccountAccess", () => {
  it("returns the account row to its owner", async () => {
    const alice = await createUser();
    const account = await createAccount(alice.id);
    signInAs(alice.id);

    const row = await requireAccountAccess(account.id);
    expect(row.id).toBe(account.id);
    expect(row.userId).toBe(alice.id);
  });

  it("throws NotFoundError — not a permission error — for another user's account", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobsAccount = await createAccount(bob.id);
    signInAs(alice.id);

    // Indistinguishable from a missing id on purpose, so ids can't be probed.
    await expect(requireAccountAccess(bobsAccount.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(requireAccountAccess("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("redirects to /login with no session at all", async () => {
    const owner = await createUser();
    const account = await createAccount(owner.id);
    signInAs(null);

    await expect(requireAccountAccess(account.id)).rejects.toBeInstanceOf(RedirectError);
  });
});

describe("getCurrentUser", () => {
  it("rejects a token issued before sessionsValidFrom (sign out everywhere)", async () => {
    const revokedAt = new Date();
    const user = await createUser({ sessionsValidFrom: revokedAt });

    signInAs(user.id, new Date(revokedAt.getTime() - 60_000));
    expect(await getCurrentUser()).toBeNull();
    await expect(requireUser()).rejects.toBeInstanceOf(RedirectError);

    signInAs(user.id, new Date(revokedAt.getTime() + 60_000));
    expect((await getCurrentUser())?.id).toBe(user.id);
  });

  it("returns null for a session whose user no longer exists", async () => {
    signInAs("11111111-1111-1111-1111-111111111111");
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("requireOwner", () => {
  it("lets the OWNER through and refuses a MEMBER with ForbiddenError", async () => {
    const owner = await createUser({ role: "OWNER" });
    const member = await createUser({ role: "MEMBER" });

    signInAs(owner.id);
    expect((await requireOwner()).id).toBe(owner.id);

    signInAs(member.id);
    await expect(requireOwner()).rejects.toBeInstanceOf(ForbiddenError);
  });
});
