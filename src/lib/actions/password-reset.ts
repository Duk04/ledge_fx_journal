"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BCRYPT_COST } from "@/lib/auth";
import { authFeatures } from "@/lib/auth-features";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { emailConfigured, sendEmail } from "@/lib/email";
import { validatePassword } from "@/lib/auth/password";
import { RESET_TOKEN_TTL_MS, consumeResetToken, issueResetToken, peekResetToken } from "@/lib/auth/reset-token";
import { checkThrottle, clearFailures, clientIpFrom, recordAttempt } from "@/lib/auth/throttle";
import { passwordResetEmail } from "@/lib/notifications/templates";
import { reportError } from "@/lib/report";
import { failT, localizedFieldErrors, tr } from "@/i18n/server-t";
import { vmsg } from "@/i18n/encoded";
import { fail, fieldErrorsFrom, ok, type ActionResult } from "./result";

/**
 * Forgotten-password flow. docs/AUTH.md has the threat model; the short
 * version:
 *
 *  - The request answers the same whether or not the address has an account
 *    (and whether or not the mail went out), so the form cannot be used to
 *    learn who is registered. The throttle is the same for both, too.
 *  - The link carries a 256-bit token whose hash alone is stored
 *    (lib/auth/reset-token.ts), lives 30 minutes, works once, and only the
 *    newest one works.
 *  - Setting the password stamps `sessionsValidFrom`, which signs the user
 *    out everywhere (lib/session.ts) — the point of a reset is usually that
 *    someone else might be in.
 *
 * Both exports are public on purpose (the user is, by definition, signed
 * out): the surface test lists them as unauthenticated entry points. The
 * pages' own checks (is the flow available, is this link still valid) are
 * NOT exported from here — every export of this file is a POST endpoint —
 * and live in lib/auth/reset-token.ts and the pages themselves.
 */

/** The flow is available only where it can work: password sign-in is on
 * and there is a mail provider to send the link. */
async function resetAvailable(): Promise<boolean> {
  return authFeatures.passwordLogin && emailConfigured();
}

async function origin(): Promise<string> {
  if (env.AUTH_URL) return env.AUTH_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const requestSchema = z.object({ email: z.email(vmsg("validEmail")) });

export async function requestPasswordReset(formData: FormData): Promise<ActionResult> {
  if (!(await resetAvailable())) return failT("resetUnavailable");
  const parsed = requestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, fieldErrors: await localizedFieldErrors(fieldErrorsFrom(parsed.error)) };

  const email = parsed.data.email.trim().toLowerCase();
  const ip = clientIpFrom(await headers());
  const gate = await checkThrottle([
    { policy: "PASSWORD_RESET_EMAIL", kind: "PASSWORD_RESET", email },
    { policy: "PASSWORD_RESET_IP", kind: "PASSWORD_RESET", ip },
  ]);
  if (!gate.allowed) return fail(gate.message);
  // Every request spends from the budget, existing address or not — a
  // budget that only drained for real accounts would itself leak which
  // addresses exist.
  await recordAttempt({ kind: "PASSWORD_RESET", email, ip, success: false });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, locale: true } });
  if (user) {
    const raw = await issueResetToken(user.id);
    const url = new URL("/reset-password", await origin());
    url.searchParams.set("token", raw);
    const mail = passwordResetEmail({
      locale: user.locale,
      resetUrl: url.toString(),
      minutes: RESET_TOKEN_TTL_MS / 60_000,
    });
    const sent = await sendEmail({ to: email, ...mail });
    // Not surfaced to the requester (that would confirm the account exists);
    // recorded so a broken provider is visible to whoever runs the instance.
    if (!sent.ok) reportError(new Error(`Password reset mail failed: ${sent.error}`), { userId: user.id });
  }
  return ok();
}

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1, vmsg("passwordRequired")),
  confirm: z.string(),
});

export async function resetPassword(formData: FormData): Promise<ActionResult> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: await localizedFieldErrors(fieldErrorsFrom(parsed.error)) };
  const { token, password, confirm } = parsed.data;

  // Validate everything BEFORE using the token up: a too-short password
  // should cost a retype, not a fresh email.
  const userId = await peekResetToken(token);
  if (!userId) return failT("resetLinkInvalid");
  if (password !== confirm) return { ok: false, fieldErrors: { confirm: [await tr("passwordsDiffer")] } };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return failT("resetLinkInvalid");
  const policy = validatePassword(password, { email: user.email });
  if (!policy.ok) return { ok: false, fieldErrors: await localizedFieldErrors({ password: [policy.message] }) };

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  if ((await consumeResetToken(token)) !== userId) return failT("resetLinkInvalid");
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, sessionsValidFrom: new Date() },
  });
  // A locked-out owner who just proved control of the inbox should be able
  // to sign in now, not in an hour.
  await clearFailures("PASSWORD_LOGIN", user.email, userId);
  redirect("/login?reset=1");
}
