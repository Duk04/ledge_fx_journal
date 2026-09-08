"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, BCRYPT_COST, signIn, signOut } from "@/lib/auth";
import { authFeatures } from "@/lib/auth-features";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { safeNext } from "@/lib/auth/safe-next";
import { validatePassword } from "@/lib/auth/password";
import { resolveInitialRole } from "@/lib/auth/roles";
import { checkThrottle, clientIpFrom, pruneOldAttempts, recordAttempt } from "@/lib/auth/throttle";

export interface ActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
}

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

/** Client IP for the throttle buckets. Header-derived, never form-derived. */
async function requestIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}

const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
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
export async function signInWithPassword(formData: FormData): Promise<ActionResult | undefined> {
  if (!authFeatures.passwordLogin) {
    return { error: "Password sign-in is disabled on this instance." };
  }

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Check your email and password.", fieldErrors: zodFieldErrors(parsed.error) };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const next = safeNext(formData.get("next"));
  const ip = await requestIp();

  const gate = await checkThrottle([
    { policy: "PASSWORD_LOGIN_EMAIL", kind: "PASSWORD_LOGIN", email },
    { policy: "PASSWORD_LOGIN_IP", kind: "PASSWORD_LOGIN", ip },
  ]);
  if (!gate.allowed) {
    return { error: gate.message };
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
      return { error: "Invalid email or password." };
    }
    throw err;
  }

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
  await signOut({ redirectTo: "/login" });
}

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  email: z.email("Enter a valid email address."),
  // Length and content rules are applied by `validatePassword` below, so the
  // message can explain WHICH rule failed rather than a generic minimum.
  password: z.string().min(1, "Password is required."),
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
export async function registerUser(formData: FormData): Promise<ActionResult | undefined> {
  if (!authFeatures.registration) {
    return { error: "Registration is currently disabled." };
  }

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Fix the errors below.", fieldErrors: zodFieldErrors(parsed.error) };
  }

  const { name, password } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  const ip = await requestIp();

  const gate = await checkThrottle([{ policy: "REGISTER_IP", kind: "REGISTER", ip }]);
  if (!gate.allowed) {
    return { error: gate.message };
  }

  const policy = validatePassword(password, { email });
  if (!policy.ok) {
    return { error: "Fix the errors below.", fieldErrors: { password: policy.message } };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // A failed attempt for throttling purposes: repeatedly probing this
    // endpoint is how an attacker would enumerate registered addresses, and
    // the per-IP bucket is what makes that expensive.
    await recordAttempt({ kind: "REGISTER", email, ip, success: false });
    return {
      error: "Fix the errors below.",
      fieldErrors: { email: "An account with this email already exists." },
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
