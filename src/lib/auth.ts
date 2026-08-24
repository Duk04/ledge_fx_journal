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

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

// A bcrypt hash of a fixed, never-used password. When the looked-up user
// doesn't exist (or has no password set), we still run a bcrypt.compare
// against this so that "no such user" and "wrong password" cost the same
// number of bcrypt rounds — otherwise the early-return-on-missing-user path
// is measurably faster and leaks which emails are registered via timing.
const DUMMY_PASSWORD_HASH =
  "$2b$10$q8VTNusK4LNnNkhJR1.VeusSga8vyxIOaZMn2nFVo5ESFMd665pTW";

const providers: Provider[] = [];

// ---------------------------------------------------------------------------
// Credentials (dev/test only)
//
// LOUD WARNING: this provider is an unthrottled password-verification
// endpoint. It is registered ONLY when ALLOW_DEV_LOGIN === "true", checked
// here at module load, not just hidden in the UI — a client can always POST
// straight to /api/auth/callback/credentials, so refusing to construct the
// provider at all is the only real gate. Never set ALLOW_DEV_LOGIN=true in
// a deployed environment.
// ---------------------------------------------------------------------------
if (process.env.ALLOW_DEV_LOGIN === "true") {
  providers.push(
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          // Still pay the bcrypt cost so malformed input isn't a timing
          // shortcut either.
          await bcrypt.compare("invalid-input", DUMMY_PASSWORD_HASH);
          return null;
        }

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
        const valid = await bcrypt.compare(password, hash);

        if (!user || !user.passwordHash || !valid) return null;

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
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

// Resend magic link — same idea, gated on the API key being present.
if (process.env.AUTH_RESEND_KEY) {
  providers.push(
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM || "journal@example.com",
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers,
});

export { AuthError };
