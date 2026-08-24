import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const ACCOUNT_COOKIE = "ledger.account";

/**
 * Which account the user is looking at. Stored in a cookie rather than the URL
 * so every page doesn't have to thread an accountId param, and validated
 * against ownership on every read — a cookie is user-editable input.
 */
export async function resolveActiveAccountId(userId: string): Promise<string | null> {
  const jar = await cookies();
  const requested = jar.get(ACCOUNT_COOKIE)?.value;

  if (requested) {
    const owned = await db.tradingAccount.findFirst({
      where: { id: requested, userId },
      select: { id: true },
    });
    if (owned) return owned.id;
  }

  const fallback = await db.tradingAccount.findFirst({
    where: { userId, isArchived: false },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}
