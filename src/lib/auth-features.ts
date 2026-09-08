import { env } from "@/lib/env";

/**
 * Which sign-in methods this deployment actually offers.
 *
 * The login page needs to know what buttons to render, and it should not be
 * reading raw secrets to find out — `Boolean(process.env.AUTH_GOOGLE_ID)` in
 * a page is how a secret ends up somewhere it shouldn't be. These are plain
 * booleans derived once, in one place.
 *
 * Note these describe INTENT, not enforcement. The real gate is that
 * `src/lib/auth.ts` refuses to construct a provider that isn't enabled: a
 * client can always POST straight to `/api/auth/callback/credentials`
 * regardless of what the login page chose to render, so hiding a button is
 * not a security control. See the comment on that file's provider list.
 */
export const authFeatures = {
  passwordLogin: env.ALLOW_PASSWORD_LOGIN,
  google: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
  resend: Boolean(env.AUTH_RESEND_KEY),
  registration: env.ALLOW_REGISTRATION,
  requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
} as const;

export type AuthFeatures = typeof authFeatures;
