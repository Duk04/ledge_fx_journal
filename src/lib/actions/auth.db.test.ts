/**
 * Sign-out must revoke the token it ends, not just clear the cookie: the
 * middleware re-sets the session cookie on every request, so one still in
 * flight at sign-out brings the old token back (see the RevokedSession model).
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { RedirectError, signInAs } from "../../../test/db/auth";
import { createUser } from "../../../test/db/factories";
import { signOutAction } from "./auth";

describe("signOutAction", () => {
  it("revokes this token, so a resurrected cookie authenticates nothing", async () => {
    const user = await createUser();
    const sid = crypto.randomUUID();
    signInAs(user.id, new Date(), sid);
    expect((await getCurrentUser())?.id).toBe(user.id);

    await expect(signOutAction()).rejects.toBeInstanceOf(RedirectError);
    expect(await prisma.revokedSession.count({ where: { sid } })).toBe(1);

    // The browser got the old cookie back from a late response: same token.
    signInAs(user.id, new Date(), sid);
    expect(await getCurrentUser()).toBeNull();
  });

  it("leaves the user's other sessions signed in", async () => {
    const user = await createUser();
    signInAs(user.id, new Date(), "laptop-" + crypto.randomUUID());
    await expect(signOutAction()).rejects.toBeInstanceOf(RedirectError);

    signInAs(user.id, new Date(), "phone-" + crypto.randomUUID());
    expect((await getCurrentUser())?.id).toBe(user.id);
  });
});
