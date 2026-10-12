import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/lib/actions/password-reset";
import { authFeatures } from "@/lib/auth-features";
import { emailConfigured } from "@/lib/email";
import { redirectIfAuthenticated } from "@/lib/session";

// Same shape as the login page: a server-rendered form whose action adapts
// the result into a redirect back here, so the page needs no client JS.

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  await redirectIfAuthenticated();
  const t = await getTranslations("auth");
  const params = await searchParams;
  const available = authFeatures.passwordLogin && emailConfigured();

  async function handleRequest(formData: FormData) {
    "use server";
    const result = await requestPasswordReset(formData);
    if (!result.ok) {
      const error = result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? "";
      redirect(`/forgot-password?${new URLSearchParams({ error }).toString()}`);
    }
    redirect("/forgot-password?sent=1");
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">{t("forgotTitle")}</h1>
          <p className="text-sm text-ink-2">{available ? t("forgotHint") : t("resetUnavailable")}</p>
        </div>

        {params.error ? (
          <div role="alert" className="rounded-control border border-loss/35 bg-loss-weak px-3 py-2 text-sm text-loss">
            {params.error}
          </div>
        ) : null}

        {params.sent === "1" ? (
          <div role="status" className="rounded-control border border-line bg-panel px-3 py-2 text-sm text-ink-2">
            {t("sent")}
          </div>
        ) : available ? (
          <form action={handleRequest} className="space-y-3">
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
            <Button type="submit" variant="primary" className="w-full">
              {t("sendLink")}
            </Button>
          </form>
        ) : null}

        <Link href="/login" className="block text-sm text-ink-2 underline-offset-2 hover:underline">
          {t("backToSignIn")}
        </Link>
      </div>
    </div>
  );
}
