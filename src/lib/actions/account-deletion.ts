"use server";

import bcrypt from "bcryptjs";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { reportError } from "@/lib/report";
import { failT, tr } from "@/i18n/server-t";
import type { ActionResult } from "./result";

/** How recent a sign-in must be to stand in for a password. */
const RECENT_AUTH_MS = 10 * 60 * 1000;

/**
 * Deletes the signed-in user and everything they own. docs/AUTH.md.
 *
 * PROOF, NOT JUST A SESSION. A session alone is what a borrowed laptop or a
 * stolen cookie has, and this cannot be undone, so:
 *  - an account with a password must type it;
 *  - one without (Google / magic link) must have signed in within the last
 *    ten minutes — the closest thing to re-entering a password it has;
 *  - either way the email is typed back, so the click is deliberate.
 *
 * THE LAST OWNER STAYS. OWNER is the one role that may write the shared
 * instrument and candle tables. Deleting the only one while other users
 * remain would leave nobody able to fix a wrong pip size for everyone, so it
 * is refused until someone else is owner (AUTH_OWNER_EMAILS). Alone on the
 * instance, an owner can delete freely.
 *
 * ORDER. Rows first, then blobs. Every user-owned table cascades from
 * `users` (prisma/schema.prisma; auth_attempts keeps its audit rows with the
 * user nulled), so one delete removes it all atomically. Attachment bytes
 * live outside the database and cannot join that transaction; deleting them
 * after means a failure leaves an orphaned file (reported, harmless) rather
 * than a row pointing at nothing.
 */
export async function deleteMyAccount(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { email: true, role: true, passwordHash: true },
  });

  const typedEmail = String(formData.get("confirmEmail") ?? "")
    .trim()
    .toLowerCase();
  if (typedEmail !== row.email.toLowerCase()) {
    return { ok: false, fieldErrors: { confirmEmail: [await tr("deleteEmailMismatch")] } };
  }

  if (row.passwordHash) {
    const password = String(formData.get("password") ?? "");
    if (!password || !(await bcrypt.compare(password, row.passwordHash))) {
      return { ok: false, fieldErrors: { password: [await tr("deleteWrongPassword")] } };
    }
  } else {
    const session = await auth();
    const authAt = session?.user?.authAt;
    if (!authAt || Date.now() - authAt * 1000 > RECENT_AUTH_MS) return failT("deleteNeedsRecentSignIn");
  }

  if (row.role === "OWNER") {
    const [otherOwners, otherUsers] = await Promise.all([
      prisma.user.count({ where: { role: "OWNER", id: { not: user.id } } }),
      prisma.user.count({ where: { id: { not: user.id } } }),
    ]);
    if (otherOwners === 0 && otherUsers > 0) return failT("deleteLastOwner");
  }

  const blobs = await prisma.attachment.findMany({
    where: { trade: { account: { userId: user.id } }, storageKey: { not: null } },
    select: { storageKey: true },
  });
  await prisma.user.delete({ where: { id: user.id } });

  const storage = getStorage();
  for (const { storageKey } of blobs) {
    try {
      await storage.deleteObject(storageKey!);
    } catch (err) {
      reportError(err, { where: "deleteMyAccount", storageKey: storageKey! });
    }
  }

  // The user row is gone, so the DAL already rejects this token; signing out
  // clears the cookie too, and lands on a sentence saying what happened.
  await signOut({ redirectTo: "/login?deleted=1" });
  return { ok: true };
}
