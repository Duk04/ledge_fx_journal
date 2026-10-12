import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { NotificationKindName } from "./schedule";

/**
 * Signed one-click unsubscribe links.
 *
 * The link has to work from a mail client with no session — that is the
 * point of it — so it cannot rely on sign-in. The signature is what stops
 * anyone who can guess a user id from switching their mail off. Derived from
 * AUTH_SECRET with a purpose label, so the key is never the session key
 * itself and rotating AUTH_SECRET invalidates old links along with sessions.
 *
 * The links never expire. An unsubscribe link that stops working after a
 * month is a spam complaint waiting to happen; the worst a leaked one can do
 * is turn a reminder off.
 */

const PURPOSE = "ledger:notifications:unsubscribe:v1";

function sign(userId: string, kind: NotificationKindName): string {
  const key = createHmac("sha256", env.AUTH_SECRET).update(PURPOSE).digest();
  return createHmac("sha256", key).update(`${userId}:${kind}`).digest("base64url");
}

export function verifyUnsubscribe(userId: string, kind: string, sig: string): kind is NotificationKindName {
  if (kind !== "JOURNAL_REMINDER" && kind !== "WEEKLY_SUMMARY") return false;
  const expected = Buffer.from(sign(userId, kind));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(baseUrl: string, userId: string, kind: NotificationKindName): string {
  const url = new URL("/api/notifications/unsubscribe", baseUrl);
  url.searchParams.set("u", userId);
  url.searchParams.set("k", kind);
  url.searchParams.set("s", sign(userId, kind));
  return url.toString();
}
