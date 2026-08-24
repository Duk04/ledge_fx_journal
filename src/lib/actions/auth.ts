"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { AuthError, signIn, signOut } from "@/lib/auth";
import { prisma } from "@/lib/db";

export interface ActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
}

function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  // Only ever redirect back into this app — never to an absolute/external
  // URL an attacker could stuff into the `next` query param.
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
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

const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

/**
 * Sign in with the dev Credentials provider. Returns `{ error }` instead of
 * throwing so the login form can render the failure inline — the one
 * exception is a successful sign-in, which redirects (via `redirect()`,
 * which itself works by throwing a special Next.js control-flow error that
 * must be allowed to propagate).
 */
export async function signInWithPassword(formData: FormData): Promise<ActionResult | undefined> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Check your email and password.", fieldErrors: zodFieldErrors(parsed.error) };
  }

  const next = safeNext(formData.get("next"));

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // Deliberately generic: don't reveal whether the email exists.
      return { error: "Invalid email or password." };
    }
    throw err;
  }

  redirect(next);
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

/**
 * Creates a new user + password hash + a starter "Main" trading account,
 * then signs the new user in. Field-level errors come back as
 * `fieldErrors` keyed by input name, same shape as `signInWithPassword`.
 *
 * Gated by ALLOW_REGISTRATION (default: on). Independent from
 * ALLOW_DEV_LOGIN — see docs/AUTH.md — though in practice the automatic
 * sign-in step below needs the Credentials provider to exist, so
 * registration is only fully self-service while dev login is also enabled.
 */
export async function registerUser(formData: FormData): Promise<ActionResult | undefined> {
  if (process.env.ALLOW_REGISTRATION === "false") {
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

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      error: "Fix the errors below.",
      fieldErrors: { email: "An account with this email already exists." },
    };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: "OWNER",
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

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) {
      // Account exists but auto sign-in didn't (most likely: the
      // Credentials provider isn't registered because ALLOW_DEV_LOGIN
      // isn't "true"). Send them to sign in by hand instead of failing
      // the whole registration.
      redirect("/login?registered=1");
    }
    throw err;
  }

  redirect("/");
}
