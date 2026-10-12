"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, BCRYPT_COST, auth, signIn, signOut } from "@/lib/auth";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth-config";
import { authFeatures } from "@/lib/auth-features";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { fail, fieldErrorsFrom, type ActionResult } from "./result";
import { safeNext } from "@/lib/auth/safe-next";
import { getLocale } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { setLocaleCookie } from "@/lib/locale-cookie";
import { validatePassword } from "@/lib/auth/password";
import { resolveInitialRole } from "@/lib/auth/roles";
import { checkThrottle, clientIpFrom, pruneOldAttempts, recordAttempt } from "@/lib/auth/throttle";
import { failT, localizedFieldErrors, tr } from "@/i18n/server-t";
import { vmsg } from "@/i18n/encoded";

/**
 * These used to return `{ error?: string; fieldErrors?: Record<string, string> }`
 * — a third shape, with a differently-named form message and single strings
 * where every other action module used arrays. Now on the shared
 * `ActionResult`, so a caller does not have to remember which convention a
 * given action follows.
 *
 * `undefined` is still a possible return: a successful sign-in `redirect()`s,
 * which throws Next's control-flow error, so there is nothing to return.
 */
export type AuthResult = ActionResult;

/** Client IP for the throttle buckets. Header-derived, never form-derived. */
async function requestIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}

const signInSchema = z.object({
  email: z.email(vmsg("validEmail")),
  password: z.string().min(1, vmsg("passwordRequired")),
});

/**
 * Sign in with email and password. Returns `{ error }` instead of throwing so
 * the login form can render the failure inline — the one exception is a
 * successful sign-in, which redirects (via `redirect()`, which itself works by
 * throwing a special Next.js control-flow error that must be allowed to
 * propagate).
 *
 * The throttle check here is for the MESSAGE, not for enforcement. A client
 * can POST straight to `/api/auth/callback/credentials` and never reach this
 * action, so the real gate is inside the Credentials provider's `authorize`
 * (see src/lib/auth.ts, where it runs before bcrypt). What this buys is a
 * locked-out user being told "try again in about 12 minutes" instead of
 * "invalid email or password", which is otherwise indistinguishable from
 * having simply mistyped again.
 */
export async function signInWithPassword(formData: FormData): Promise<AuthResult | undefined> {
  if (!authFeatures.passwordLogin) {
    return failT("passwordLoginDisabled");
  }

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      formError: await tr("checkEmailPassword"),
      fieldErrors: await localizedFieldErrors(fieldErrorsFrom(parsed.error)),
    };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const next = safeNext(formData.get("next"));
  const ip = await requestIp();

  const gate = await checkThrottle([
    { policy: "PASSWORD_LOGIN_EMAIL", kind: "PASSWORD_LOGIN", email },
    { policy: "PASSWORD_LOGIN_IP", kind: "PASSWORD_LOGIN", ip },
  ]);
  if (!gate.allowed) {
    return fail(gate.message);
  }

  try {
    await signIn("credentials", {
      email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // Deliberately generic: don't reveal whether the email exists. The
      // provider has already recorded the failed attempt.
      return failT("invalidCredentials");
    }
    throw err;
  }

  // Signed in: switch this browser to the user's own language.
  const row = await prisma.user.findUnique({ where: { email }, select: { locale: true } });
  if (row && isLocale(row.locale)) await setLocaleCookie(row.locale);

  redirect(next);
}

/**
 * Signs the current user out.
 *
 * Wired to a `<form action>` in the app shell rather than a link to
 * `/api/auth/signout`: that link was a GET navigation to Auth.js's own
 * interstitial confirmation page, so signing out took two clicks and looked
 * nothing like the rest of the app. A server action is one click, styled with
 * the app's own components, and gets Next's Origin check for free.
 */
export async function signOutAction() {
  // Revoke this token before clearing the cookie. Clearing alone is not
  // enough: the middleware re-sets the session cookie on every request it
  // passes (Auth.js's rolling refresh), so any request still in flight at
  // sign-out — a Link prefetch from the page being left — answers with the
  // old token and the browser stores it again. The DAL rejects a revoked
  // `sid`, so a resurrected cookie authenticates nothing. Found by
  // e2e/auth.spec.ts failing in CI, where those prefetches are slower.
  const session = await auth();
  const sid = session?.user?.sid;
  const userId = session?.user?.id;
  if (sid && userId) {
    const issuedAt = (session.user.authAt ?? Math.floor(Date.now() / 1000)) * 1000;
    await prisma.revokedSession.upsert({
      where: { sid },
      create: { sid, userId, expiresAt: new Date(issuedAt + SESSION_MAX_AGE_SECONDS * 1000) },
      update: {},
    });
    // Housekeeping: a row is useless once its token would have expired.
    await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  }
  await signOut({ redirectTo: "/login" });
}

const registerSchema = z.object({
  name: z.string().trim().min(1, vmsg("nameRequired")).max(120, vmsg("nameTooLong")),
  email: z.email(vmsg("validEmail")),
  // Length and content rules are applied by `validatePassword` below, so the
  // message can explain WHICH rule failed rather than a generic minimum.
  password: z.string().min(1, vmsg("passwordRequired")),
});

/**
 * Creates a new user + password hash + a starter "Main" trading account,
 * then signs the new user in. Field-level errors come back as
 * `fieldErrors` keyed by input name, same shape as `signInWithPassword`.
 *
 * Gated by ALLOW_REGISTRATION (default: on).
 *
 * Rate-limited per IP, which is the thing that bounds it: this endpoint
 * creates a `User` row AND a `TradingAccount` row per call, so unthrottled it
 * is an unbounded write amplifier for anyone who can reach the page.
 */
export async function registerUser(formData: FormData): Promise<AuthResult | undefined> {
  if (!authFeatures.registration) {
    return failT("registrationDisabled");
  }

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      formError: await tr("fixErrorsBelow"),
      fieldErrors: await localizedFieldErrors(fieldErrorsFrom(parsed.error)),
    };
  }

  const { name, password } = parsed.data;
  // A typo in a password nobody can see is a locked account on day one. The
  // field only exists on the register page, so a caller that does not send
  // it (a test, a script) is not held to it.
  const confirm = formData.get("confirm");
  if (typeof confirm === "string" && confirm !== password) {
    return {
      ok: false,
      formError: await tr("fixErrorsBelow"),
      fieldErrors: { confirm: [await tr("passwordsDiffer")] },
    };
  }
  const email = parsed.data.email.trim().toLowerCase();
  const ip = await requestIp();

  const gate = await checkThrottle([{ policy: "REGISTER_IP", kind: "REGISTER", ip }]);
  if (!gate.allowed) {
    return fail(gate.message);
  }

  const policy = validatePassword(password, { email });
  if (!policy.ok) {
    return {
      ok: false,
      formError: await tr("fixErrorsBelow"),
      fieldErrors: await localizedFieldErrors({ password: [policy.message] }),
    };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // A failed attempt for throttling purposes: repeatedly probing this
    // endpoint is how an attacker would enumerate registered addresses, and
    // the per-IP bucket is what makes that expensive.
    await recordAttempt({ kind: "REGISTER", email, ip, success: false });
    return {
      ok: false,
      formError: await tr("fixErrorsBelow"),
      fieldErrors: { email: [await tr("emailTaken")] },
    };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  /**
   * Role. This used to hardcode OWNER, and the column defaulted to OWNER too,
   * so with open registration every self-registered stranger became an
   * instance owner. MEMBER is now the default and OWNER means the single
   * administrator; `AUTH_OWNER_EMAILS` and the first-user rule in
   * `src/lib/auth.ts`'s `signIn` callback decide who that is.
   */
  const role = resolveInitialRole({
    email,
    ownerEmails: env.AUTH_OWNER_EMAILS,
    isFirstUser: (await prisma.user.count()) === 0,
  });

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role,
      // Whatever language the sign-up page was shown in.
      locale: await getLocale(),
      accounts: {
        create: {
          label: "Main",
          platform: "MT5",
          accountType: "DEMO",
          currency: "USD",
          startingBalance: 10000,
        },
      },
    },
  });

  await recordAttempt({ kind: "REGISTER", email, ip, success: true, userId: user.id });
  // Housekeeping on a slow path, never on the login hot path.
  await pruneOldAttempts();

  if (!authFeatures.passwordLogin) {
    // The account exists but there is no password provider to sign it in
    // with. Send them to whatever provider IS configured.
    redirect("/login?registered=1");
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login?registered=1");
    }
    throw err;
  }

  redirect("/");
}
