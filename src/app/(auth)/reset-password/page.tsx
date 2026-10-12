import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/lib/actions/password-reset";
import { MIN_PASSWORD_CHARS } from "@/lib/auth/password";
import { peekResetToken } from "@/lib/auth/reset-token";

// Deliberately NOT redirectIfAuthenticated: someone signed in on this
// browser who requested a reset (or who opens the link on a shared machine)
// still needs the form, and completing it signs every session out anyway.

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const t = await getTranslations("auth");
  const params = await searchParams;
  const token = params.token ?? "";
  // Checked without using the token up, so an expired link says so before
  // anyone types a new password into it.
  const valid = (await peekResetToken(token)) !== null;

  async function handleReset(formData: FormData) {
    "use server";
    const result = await resetPassword(formData);
    if (!result.ok) {
      const error = result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? "";
      const tokenValue = String(formData.get("token") ?? "");
      redirect(`/reset-password?${new URLSearchParams({ token: tokenValue, error }).toString()}`);
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">{t("resetTitle")}</h1>
          {valid ? <p className="text-sm text-ink-2">{t("resetHint", { min: String(MIN_PASSWORD_CHARS) })}</p> : null}
        </div>

        {!valid ? (
          <>
            <div
              role="alert"
              className="rounded-control border border-loss/35 bg-loss-weak px-3 py-2 text-sm text-loss"
            >
              {t("linkInvalid")}
            </div>
            <Link href="/forgot-password" className="block text-sm text-ink-2 underline-offset-2 hover:underline">
              {t("requestNew")}
            </Link>
          </>
        ) : (
          <>
            {params.error ? (
              <div
                role="alert"
                className="rounded-control border border-loss/35 bg-loss-weak px-3 py-2 text-sm text-loss"
              >
                {params.error}
              </div>
            ) : null}
            <form action={handleReset} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <div className="space-y-1">
                <label htmlFor="password" className="text-sm text-ink-2">
                  {t("newPassword")}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_CHARS}
                  required
                  className="bg-panel border border-line rounded-control h-control px-2.5 text-sm w-full"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="confirm" className="text-sm text-ink-2">
                  {t("confirmPassword")}
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_CHARS}
                  required
                  className="bg-panel border border-line rounded-control h-control px-2.5 text-sm w-full"
                />
              </div>
              <Button type="submit" variant="primary" className="w-full">
                {t("savePassword")}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
