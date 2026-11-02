import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui";
import { signIn } from "@/lib/auth";
import { signInWithPassword } from "@/lib/actions/auth";
import { authFeatures } from "@/lib/auth-features";
import { safeNext } from "@/lib/auth/safe-next";
import { redirectIfAuthenticated } from "@/lib/session";
import { tooManyAttempts } from "@/lib/auth/throttle";
import { tr } from "@/i18n/server-t";

// Deliberately minimal markup: bare inputs styled with the shared token
// classes (bg-panel / border-line / etc).

/** The failures `?error=` may name. Anything else — an Auth.js code such as
 * OAuthAccountNotLinked, or a hand-made link — reads as the generic message. */
const SIGN_IN_ERRORS = ["invalidCredentials", "passwordLoginDisabled", "checkEmailPassword"] as const;

/**
 * The sentence for `?error=<code>`. A code, never text: the page used to
 * print whatever the query string said inside its alert box, so anyone could
 * send a link that put their own words on this domain ("your account is
 * locked, call …"). Only a throttle's wait travels as a number, clamped.
 */
async function signInError(code: string | undefined, retrySeconds: string | undefined): Promise<string | null> {
  if (!code) return null;
  if (code === "throttled") {
    const s = Number(retrySeconds);
    return tooManyAttempts(Number.isFinite(s) && s > 0 ? Math.min(s, 24 * 3600) * 1000 : 60_000);
  }
  if ((SIGN_IN_ERRORS as readonly string[]).includes(code)) return tr(code as (typeof SIGN_IN_ERRORS)[number]);
  return (await getTranslations("auth"))("somethingWentWrong");
}

interface LoginPageProps {
  searchParams: Promise<{
    next?: string;
    error?: string;
    retry?: string;
    registered?: string;
    reset?: string;
    deleted?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Checked in the PAGE, not the (auth) layout: Next's auth guide is explicit
  // that a layout does not re-render on navigation and does not control
  // whether the rest of the route renders, so a check there is not a gate.
  await redirectIfAuthenticated();

  const t = await getTranslations("auth");
  const params = await searchParams;
  const next = safeNext(params.next);
  const error = await signInError(params.error, params.retry);
  const justRegistered = params.registered === "1";
  // Arrivals from the reset and account-deletion flows; both land here
  // signed out, and both deserve a sentence saying what just happened.
  const notice = params.reset === "1" ? t("resetDone") : params.deleted === "1" ? t("deleted") : null;

  const googleEnabled = authFeatures.google;
  const registrationEnabled = authFeatures.registration;

  // Thin server-action wrappers: the real actions in src/lib/actions/auth.ts
  // return a failure result (rather than throwing) so they stay easy to call
  // from anywhere, including tests. This page has no client-side state to
  // hold that result, so it redirects back to itself with the failure's CODE
  // in the query string — server-rendered, no client JS required — and
  // signInError() above turns the code back into a sentence.
  async function handleSignIn(formData: FormData) {
    "use server";
    const result = await signInWithPassword(formData);
    if (result && !result.ok) {
      const qs = new URLSearchParams({ next, error: result.code ?? "unknown" });
      if (result.retryAfterMs) qs.set("retry", String(Math.ceil(result.retryAfterMs / 1000)));
      redirect(`/login?${qs.toString()}`);
    }
  }

  async function handleGoogleSignIn() {
    "use server";
    await signIn("google", { redirectTo: next });
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">{t("signIn")}</h1>
          <p className="text-sm text-ink-2">FX Journal</p>
        </div>

        {error ? (
          <div role="alert" className="rounded-control border border-loss/35 bg-loss-weak px-3 py-2 text-sm text-loss">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div role="status" className="rounded-control border border-line bg-panel px-3 py-2 text-sm text-ink-2">
            {notice}
          </div>
        ) : null}

        {justRegistered ? (
          <div role="status" className="rounded-control border border-line bg-panel px-3 py-2 text-sm text-ink-2">
            {t("registered")}
          </div>
        ) : null}

        <form action={handleSignIn} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm text-ink-2">
              {t("email")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="bg-panel border border-line rounded-control h-control px-2.5 text-sm w-full"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="password" className="text-sm text-ink-2">
              {t("password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="bg-panel border border-line rounded-control h-control px-2.5 text-sm w-full"
            />
          </div>
          <Button type="submit" variant="primary" className="w-full">
            {t("signIn")}
          </Button>
          <Link href="/forgot-password" className="block text-xs text-ink-3 underline-offset-2 hover:underline">
            {t("forgot")}
          </Link>
        </form>

        {googleEnabled ? (
          <form action={handleGoogleSignIn}>
            <Button type="submit" variant="default" className="w-full">
              {t("continueWithGoogle")}
            </Button>
          </form>
        ) : null}

        {registrationEnabled ? (
          <p className="border-t border-line pt-4 text-sm text-ink-2">
            {t("noAccount")}{" "}
            <Link href="/register" className="font-medium text-ink underline-offset-2 hover:underline">
              {t("createAnAccount")}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
