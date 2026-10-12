import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Password-reset tokens, stored in Auth.js's `verification_tokens` table
 * under an identifier of `pwreset:<userId>`. The prefix keeps them apart
 * from magic-link rows, whose identifier is an email address.
 *
 * Only the SHA-256 of the token is stored. The raw value exists in the email
 * and nowhere else, so a read of the database (a backup, a support query)
 * yields nothing that resets anyone's password. A plain hash is enough: the
 * token is 256 random bits, so there is nothing to brute-force that a slow
 * hash would protect.
 *
 * Issuing a token deletes the user's earlier ones: only the newest link
 * works. Consuming deletes the row and checks that exactly one row went, so
 * two concurrent submits of one link cannot both succeed.
 */

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const PREFIX = "pwreset:";

function digest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function issueResetToken(userId: string, now = new Date()): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const identifier = PREFIX + userId;
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({
      data: { identifier, token: digest(raw), expires: new Date(now.getTime() + RESET_TOKEN_TTL_MS) },
    }),
  ]);
  return raw;
}

async function find(raw: string, now: Date) {
  if (!raw || raw.length > 200) return null;
  const row = await prisma.verificationToken.findFirst({
    where: { token: digest(raw), identifier: { startsWith: PREFIX } },
  });
  if (!row || row.expires.getTime() <= now.getTime()) return null;
  return row;
}

/** The user a still-valid token belongs to, without using it up — so the
 * reset page can say "expired" before anyone types a new password. */
export async function peekResetToken(raw: string, now = new Date()): Promise<string | null> {
  const row = await find(raw, now);
  return row ? row.identifier.slice(PREFIX.length) : null;
}

/** Uses the token up. Returns the user id, or null if it was invalid,
 * expired, or consumed by a concurrent request first. */
export async function consumeResetToken(raw: string, now = new Date()): Promise<string | null> {
  const row = await find(raw, now);
  if (!row) return null;
  const { count } = await prisma.verificationToken.deleteMany({
    where: { identifier: row.identifier, token: row.token },
  });
  return count === 1 ? row.identifier.slice(PREFIX.length) : null;
}
