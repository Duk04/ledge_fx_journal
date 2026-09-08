/**
 * Full Auth.js configuration — Node.js runtime only.
 *
 * This is the file every server component, server action, and the
 * `/api/auth/[...nextauth]` route handler imports `auth`/`signIn`/`signOut`
 * from. It pulls in Prisma and bcryptjs, so it must never be imported from
 * `src/middleware.ts` (see `src/lib/auth-config.ts` for the edge-safe
 * subset that file uses instead).
 */
import NextAuth, { AuthError } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Provider } from "next-auth/providers";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth-config";
import { authFeatures } from "@/lib/auth-features";
import { env } from "@/lib/env";
import { checkThrottle, clearFailures, clientIpFrom, recordAttempt } from "@/lib/auth/throttle";
import { resolveInitialRole } from "@/lib/auth/roles";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

/**
 * A bcrypt hash of a fixed, never-used password. When the looked-up user
 * doesn't exist (or has no password set), we still run a bcrypt.compare
 * against this so that "no such user" and "wrong password" cost the same
 * number of bcrypt rounds — otherwise the early-return-on-missing-user path
 * is measurably faster and leaks which emails are registered via timing.
 *
 * The cost factor MUST match the one `registerUser` hashes with (12). This
 * was previously a cost-10 hash while real passwords were cost 12, so the
 * dummy comparison ran roughly four times faster than a real one and the
 * timing equalisation it exists for did not actually hold.
 */
const DUMMY_PASSWORD_HASH = "$2b$12$DH5gCDureG4wR/plNQAnNuQVE1qqrrSa1t/idZJfdJwis23dubJfS";

/** Cost factor for every password hash in this app. Keep in sync with the dummy above. */
export const BCRYPT_COST = 12;

/**
 * Reads the client IP inside a provider's `authorize`.
 *
 * Auth.js passes the raw `Request` as `authorize`'s second argument, which is
 * the only trustworthy place to get this: a credential field is
 * client-controlled and must never be used for it.
 */
function ipFromRequest(request: unknown): string | null {
  if (request && typeof request === "object" && "headers" in request) {
    const headers = (request as { headers: unknown }).headers;
    if (headers instanceof Headers) return clientIpFrom(headers);
  }
  return null;
}

const providers: Provider[] = [];

// ---------------------------------------------------------------------------
// Email + password
//
// Registered when ALLOW_PASSWORD_LOGIN is on (the default), checked here at
// module load rather than only hidden in the UI — a client can always POST
// straight to /api/auth/callback/credentials, so refusing to CONSTRUCT the
// provider is the only real gate. That reasoning is unchanged from when this
// was `ALLOW_DEV_LOGIN`.
//
// What did change: this used to be a development-only shortcut, documented as
// "an unthrottled password-verification endpoint" that must never be enabled
// in a deployed environment — which left production with no password login at
// all, while `registerUser` happily created password accounts. It is now
// throttled per email and per IP (see lib/auth/throttle.ts), so it is a
// supported production login method.
// ---------------------------------------------------------------------------
if (authFeatures.passwordLogin) {
  providers.push(
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        const ip = ipFromRequest(request);

        if (!parsed.success) {
          // Still pay the bcrypt cost so malformed input isn't a timing
          // shortcut either.
          await bcrypt.compare("invalid-input", DUMMY_PASSWORD_HASH);
          await recordAttempt({ kind: "PASSWORD_LOGIN", email: null, ip, success: false });
          return null;
        }

        const email = parsed.data.email.trim().toLowerCase();
        const { password } = parsed.data;

        // THROTTLE BEFORE BCRYPT, not after. A cost-12 hash is ~250ms of CPU,
        // so an unthrottled verify endpoint is itself the denial-of-service
        // lever — checking afterwards would still burn the CPU on every
        // attempt. This is also the enforcement point that matters: the
        // server action in lib/actions/auth.ts pre-checks for a nicer message,
        // but a client can POST straight here and skip it.
        const gate = await checkThrottle([
          { policy: "PASSWORD_LOGIN_EMAIL", kind: "PASSWORD_LOGIN", email },
          { policy: "PASSWORD_LOGIN_IP", kind: "PASSWORD_LOGIN", ip },
        ]);
        if (!gate.allowed) {
          await recordAttempt({ kind: "PASSWORD_LOGIN", email, ip, success: false });
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
        const valid = await bcrypt.compare(password, hash);

        if (!user || !user.passwordHash || !valid) {
          // Recorded for addresses that do not exist too, so lockout
          // behaviour cannot be used to enumerate accounts.
          await recordAttempt({ kind: "PASSWORD_LOGIN", email, ip, success: false, userId: user?.id ?? null });
          return null;
        }

        if (authFeatures.requireEmailVerification && !user.emailVerified) {
          await recordAttempt({ kind: "PASSWORD_LOGIN", email, ip, success: false, userId: user.id });
          return null;
        }

        await clearFailures("PASSWORD_LOGIN", email, user.id);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          timezone: user.timezone,
        };
      },
    }),
  );
}

// Google OAuth — only registered when both env vars are actually set, so an
// empty-string placeholder in .env doesn't produce a broken/unusable
// "Sign in with Google" button.
if (authFeatures.google) {
  providers.push(Google);
}

// Resend magic link — same idea, gated on the API key being present.
if (authFeatures.resend) {
  providers.push(
    Resend({
      apiKey: env.AUTH_RESEND_KEY!,
      from: env.EMAIL_FROM,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers,
  callbacks: {
    ...authConfig.callbacks,
    /**
     * Runs after a provider has authenticated someone, before a session is
     * issued. Two jobs, both of which need Prisma and so cannot live in the
     * edge-safe config.
     */
    async signIn({ user }) {
      if (!user?.id) return false;

      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, role: true, emailVerified: true, createdAt: true },
      });
      if (!row) return false;

      // Adapter-created users (OAuth, magic link) get the schema's default
      // MEMBER role. The same rule that decides a password sign-up's role has
      // to apply here, or which route someone signed up through would decide
      // whether they can rewrite shared data.
      //
      // `=== 1` rather than `=== 0`: by the time this callback runs the
      // adapter has already inserted the row.
      const intended = resolveInitialRole({
        email: row.email ?? "",
        ownerEmails: env.AUTH_OWNER_EMAILS,
        isFirstUser: (await prisma.user.count()) === 1,
      });

      if (intended !== row.role && intended === "OWNER") {
        await prisma.user.update({ where: { id: row.id }, data: { role: "OWNER" } });
      }

      // Fail CLOSED on verification: if it is required and this account has
      // not verified, refuse at the door rather than issuing a session and
      // hoping every page checks.
      if (authFeatures.requireEmailVerification && !row.emailVerified) {
        return false;
      }

      return true;
    },
  },
});

export { AuthError };
