import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth";
import { signInWithPassword, registerUser } from "@/lib/actions/auth";
import { authFeatures } from "@/lib/auth-features";
import { safeNext } from "@/lib/auth/safe-next";
import { redirectIfAuthenticated } from "@/lib/session";

// Deliberately minimal markup — another agent owns the design system.
// Styling here is limited to the shared token classes the rest of the app
// uses for bare inputs (bg-panel / border-line / etc).

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string; registered?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Checked in the PAGE, not the (auth) layout: Next's auth guide is explicit
  // that a layout does not re-render on navigation and does not control
  // whether the rest of the route renders, so a check there is not a gate.
  await redirectIfAuthenticated();

  const t = await getTranslations("auth");
  const params = await searchParams;
  const next = safeNext(params.next);
  const error = params.error;
  const justRegistered = params.registered === "1";

  const googleEnabled = authFeatures.google;
  const registrationEnabled = authFeatures.registration;

  // Thin server-action wrappers: the real actions in src/lib/actions/auth.ts
  // return `{ error }` on failure (rather than throwing) so they stay easy
  // to call from anywhere, including tests. This page has no client-side
  // state to hold that return value, so it adapts it into a redirect back
  // to this same page with the message in the query string — plain
  // server-rendered error display, no client JS required.
  async function handleSignIn(formData: FormData) {
    "use server";
    const result = await signInWithPassword(formData);
    if (result && !result.ok) {
      // Fetched here, not captured from the page: a Server Action's closed-over
      // values are serialised into the form, and a function cannot be.
      const ta = await getTranslations("auth");
      const qs = new URLSearchParams({ next, error: result.formError ?? ta("somethingWentWrong") });
      redirect(`/login?${qs.toString()}`);
    }
  }

  async function handleRegister(formData: FormData) {
    "use server";
    const result = await registerUser(formData);
    if (result && !result.ok) {
      const ta = await getTranslations("auth");
      const qs = new URLSearchParams({ next, error: result.formError ?? ta("somethingWentWrong") });
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
        </form>

        {googleEnabled ? (
          <form action={handleGoogleSignIn}>
            <Button type="submit" variant="default" className="w-full">
              {t("continueWithGoogle")}
            </Button>
          </form>
        ) : null}

        {registrationEnabled ? (
          <details className="space-y-3 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm text-ink-2">{t("createAnAccount")}</summary>
            <form action={handleRegister} className="space-y-3 pt-3">
              <input type="hidden" name="next" value={next} />
              <div className="space-y-1">
                <label htmlFor="reg-name" className="text-sm text-ink-2">
                  {t("name")}
                </label>
                <input
                  id="reg-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  className="bg-panel border border-line rounded-control h-control px-2.5 text-sm w-full"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="reg-email" className="text-sm text-ink-2">
                  {t("email")}
                </label>
                <input
                  id="reg-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="bg-panel border border-line rounded-control h-control px-2.5 text-sm w-full"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="reg-password" className="text-sm text-ink-2">
                  {t("password")}
                </label>
                <input
                  id="reg-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="bg-panel border border-line rounded-control h-control px-2.5 text-sm w-full"
                />
              </div>
              <Button type="submit" variant="default" className="w-full">
                {t("createAccount")}
              </Button>
            </form>
          </details>
        ) : null}
      </div>
    </div>
  );
}
