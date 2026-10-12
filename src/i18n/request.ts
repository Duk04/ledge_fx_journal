import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localeFromAcceptLanguage } from "./config";

/**
 * Which language this request renders in. No locale in the URL (the app is
 * behind sign-in; there is nothing to make crawlable per language), so:
 *   1. the NEXT_LOCALE cookie — set from User.locale at sign-in and in
 *      Settings, so a signed-in user always gets their own choice;
 *   2. the browser's Accept-Language (the login page, a first visit);
 *   3. English.
 *
 * Numbers, money and dates are NOT localised through here: the app formats
 * them itself (lib/metrics/formatters.ts) in the trading convention
 * ($1,234.56, 24-hour times) in either language. `timeZone` is pinned to UTC
 * only so next-intl never guesses one; nothing relies on it.
 */
export default getRequestConfig(async () => {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookie)
    ? cookie
    : (localeFromAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE);

  return {
    locale,
    timeZone: "UTC",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
