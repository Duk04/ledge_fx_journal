import { z } from "zod";

/**
 * Environment validation, checked once at boot.
 *
 * Before this, `process.env` was read ad hoc at nineteen call sites and
 * nothing asserted any of it. Two consequences worth naming, because both
 * were real:
 *
 *  - `AUTH_SECRET` was never read by app code at all. Auth.js checks it
 *    internally, so a deploy with a missing or placeholder secret failed at
 *    the first request rather than at startup — and `.env.example` shipped a
 *    working literal, making "copy it and forget" the path of least
 *    resistance.
 *  - `ALLOW_DEV_LOGIN=true` in production was prevented by a comment.
 *
 * `parseEnv` is exported separately from `env` so the rules are unit-testable
 * without setting real process state.
 *
 * This module is the only place that should read `process.env` — Next's own
 * data-security guide puts environment access in the data-access layer and
 * nowhere else. `src/lib/auth-config.ts` is the deliberate exception in the
 * other direction: it must stay importable from the Edge middleware bundle,
 * so it reads nothing from here and expresses session lifetimes as literals.
 */

/** The literal shipped in `.env.example`. Refused in production. */
const EXAMPLE_AUTH_SECRET = "dev-only-secret-change-me-in-production-0123456789";

/** `"true"`/`"1"`/`"yes"` → true, `"false"`/`"0"`/`"no"`/empty → false. */
function booleanish(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw.trim() === "") return defaultValue;
      const v = raw.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(v)) return true;
      if (["false", "0", "no", "off"].includes(v)) return false;
      return defaultValue;
    });
}

/** An empty string in a .env file means "unset", not "set to empty". */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
    /** Migrations run over this, bypassing the connection pooler. */
    DIRECT_URL: optionalString,

    /**
     * Auth.js derives the session cookie's encryption key from this. 32 bytes
     * of base64 is `openssl rand -base64 32`; the length floor exists so a
     * short placeholder cannot silently weaken every session token.
     */
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)."),
    AUTH_URL: optionalString,

    AUTH_GOOGLE_ID: optionalString,
    AUTH_GOOGLE_SECRET: optionalString,
    AUTH_RESEND_KEY: optionalString,
    EMAIL_FROM: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v.trim() === "" ? "journal@example.com" : v.trim())),

    /**
     * Email + password sign-in. Defaults ON, which is the change of intent
     * from the old `ALLOW_DEV_LOGIN`: the Credentials provider is now
     * throttled and rate-limited, so it is a production login method rather
     * than a development shortcut.
     */
    ALLOW_PASSWORD_LOGIN: booleanish(true),
    ALLOW_REGISTRATION: booleanish(true),
    REQUIRE_EMAIL_VERIFICATION: booleanish(false),

    /**
     * Who the instance administrator is — the role permitted to write the
     * shared Instrument and Candle tables. Comma-separated, matched
     * case-insensitively on sign-in.
     *
     * The migration promotes the oldest user row, which is right for an
     * existing database but fragile if one is ever reset. This is the durable
     * statement of intent.
     */
    AUTH_OWNER_EMAILS: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),

    /**
     * Legacy. Replaced by ALLOW_PASSWORD_LOGIN, and rejected outright rather
     * than ignored: silently ignoring it would leave a deployment that
     * believes it has disabled password login when it has not.
     */
    ALLOW_DEV_LOGIN: optionalString,

    /** Attachment storage. Local filesystem when unset. */
    S3_BUCKET: optionalString,
    S3_REGION: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_ENDPOINT: optionalString,
    S3_PUBLIC_URL: optionalString,

    PRISMA_LOG: optionalString,
    PRISMA_JS_ENGINE: optionalString,
  })
  .superRefine((v, ctx) => {
    const production = v.NODE_ENV === "production";

    if (v.ALLOW_DEV_LOGIN !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["ALLOW_DEV_LOGIN"],
        message:
          "ALLOW_DEV_LOGIN has been renamed to ALLOW_PASSWORD_LOGIN. Password login is now throttled and supported in production; remove ALLOW_DEV_LOGIN and set ALLOW_PASSWORD_LOGIN instead.",
      });
    }

    if (production && v.AUTH_SECRET === EXAMPLE_AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message:
          "AUTH_SECRET is still the placeholder from .env.example. Generate one with `openssl rand -base64 32` and set it as a deployment secret.",
      });
    }

    if (production && !v.AUTH_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_URL"],
        message: "AUTH_URL must be set in production so OAuth callbacks and email links point at the real origin.",
      });
    }

    if (production && v.AUTH_URL) {
      let host: string | null = null;
      try {
        const url = new URL(v.AUTH_URL);
        host = url.hostname;
        if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(host)) {
          ctx.addIssue({
            code: "custom",
            path: ["AUTH_URL"],
            message: "AUTH_URL must use https in production — a session cookie sent over http is not protected.",
          });
        }
      } catch {
        ctx.addIssue({ code: "custom", path: ["AUTH_URL"], message: "AUTH_URL is not a valid URL." });
      }
    }

    // Half-configured OAuth produces a sign-in button that always fails.
    const googleId = Boolean(v.AUTH_GOOGLE_ID);
    const googleSecret = Boolean(v.AUTH_GOOGLE_SECRET);
    if (googleId !== googleSecret) {
      ctx.addIssue({
        code: "custom",
        path: [googleId ? "AUTH_GOOGLE_SECRET" : "AUTH_GOOGLE_ID"],
        message: "Set both AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, or neither.",
      });
    }

    // Enforcing verification with no way to send the mail locks everyone out.
    if (v.REQUIRE_EMAIL_VERIFICATION && !v.AUTH_RESEND_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["REQUIRE_EMAIL_VERIFICATION"],
        message:
          "REQUIRE_EMAIL_VERIFICATION needs AUTH_RESEND_KEY — without a mail provider nobody could ever verify, including you.",
      });
    }
  });

export type Env = z.infer<typeof schema>;

/**
 * Validates a raw environment. Throws with every problem listed, not just the
 * first — a misconfigured deploy should learn about all of them in one go.
 */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`Invalid environment:\n${lines.join("\n")}`);
}

/**
 * `next build` evaluates module scope while collecting pages, so a CI build
 * with no real database URL would fail here rather than at runtime. This lets
 * such a build past while keeping the check for anything that actually serves
 * a request.
 */
const skipValidation = process.env.SKIP_ENV_VALIDATION === "1" || process.env.SKIP_ENV_VALIDATION === "true";

export const env: Env = skipValidation ? (process.env as unknown as Env) : parseEnv(process.env);
