import "server-only";
import { env } from "@/lib/env";

/**
 * Outgoing mail, through Resend's HTTP API.
 *
 * A plain `fetch` rather than the SDK: one endpoint, one JSON body, and the
 * SDK would be the only dependency that exists to wrap it. Auth.js already
 * talks to the same API for magic links (AUTH_RESEND_KEY), which is why that
 * key is accepted here too.
 *
 * Never throws — a reminder that fails must not take the cron run down with
 * it, so the caller gets a result and records it (NotificationLog.error).
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

const RESEND_URL = "https://api.resend.com/emails";

function apiKey(): string | undefined {
  return env.RESEND_API_KEY ?? env.AUTH_RESEND_KEY;
}

export function emailConfigured(): boolean {
  return Boolean(apiKey());
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const key = apiKey();
  if (!key) return { ok: false, error: "Email is not configured (RESEND_API_KEY)." };
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, ...message }),
      // A hung provider would otherwise hold the whole cron invocation.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: json?.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
