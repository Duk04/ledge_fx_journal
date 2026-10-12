import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/auth/register-form";
import { authFeatures } from "@/lib/auth-features";
import { MIN_PASSWORD_CHARS } from "@/lib/auth/password";
import { redirectIfAuthenticated } from "@/lib/session";

/**
 * Sign-up, on its own page. It used to be a disclosure under the sign-in
 * form, which put two Email and two Password fields on one screen — easy to
 * fill the wrong pair. The two pages now link to each other instead.
 */
export default async function RegisterPage() {
  await redirectIfAuthenticated();
  const t = await getTranslations("auth");

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">{t("registerTitle")}</h1>
          <p className="text-sm text-ink-2">
            {authFeatures.registration ? t("registerHint") : t("registrationClosed")}
          </p>
        </div>

        {authFeatures.registration ? <RegisterForm minPasswordChars={MIN_PASSWORD_CHARS} /> : null}

        <p className="border-t border-line pt-4 text-sm text-ink-2">
          {t("haveAccount")}{" "}
          <Link href="/login" className="font-medium text-ink underline-offset-2 hover:underline">
            {t("signIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
