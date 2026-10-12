import "server-only";
import { cookies, headers } from "next/headers";
import { createTranslator, type Messages } from "next-intl";
import { fail, failFields, type ActionFailure } from "@/lib/actions/result";
import en from "../../messages/en.json";
import mn from "../../messages/mn.json";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localeFromAcceptLanguage, type Locale } from "./config";
import { translateVmsg, type MessageValues, type ValidationKey } from "./encoded";

const MESSAGES = { en, mn } as const;

/**
 * The request's language — the same order `request.ts` documents. Outside a
 * request (vitest, a script) `cookies()` throws, and that is English: the DB
 * tests assert the English messages and stay meaningful that way.
 */
export async function resolveLocale(): Promise<Locale> {
  try {
    const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isLocale(cookie)) return cookie;
    return localeFromAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * A translator for server actions and other server-only code.
 *
 * Deliberately NOT next-intl's `getTranslations`: that one needs the plugin's
 * request config wired in, which vitest does not have, so every action test
 * would need it mocked. `createTranslator` is the same formatter with the
 * messages handed in.
 */
export async function getServerT() {
  const locale = await resolveLocale();
  return createTranslator({ locale, messages: MESSAGES[locale] as typeof en });
}

export type ServerT = Awaited<ReturnType<typeof getServerT>>;

/** `fieldErrorsFrom` (actions/result.ts), with `vmsg` keys translated — what a
 * failing action should return so non-`FieldError` call sites (a toast, a
 * `setError` banner) show the reader's language too. */
export async function localizedFieldErrors(fieldErrors: Record<string, string[]>): Promise<Record<string, string[]>> {
  const t = await getServerT();
  const vt = (key: ValidationKey, values?: MessageValues) => t(`validation.${key}`, values);
  const out: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) out[field] = messages.map((m) => translateVmsg(vt, m));
  return out;
}

export type ErrorKey = keyof Messages["errors"];

/** One `errors.*` message in the request's language. */
export async function tr(key: ErrorKey, values?: MessageValues): Promise<string> {
  const t = await getServerT();
  return t(`errors.${key}`, values);
}

/** `fail()` with a translated message — the usual way an action reports a
 * form-level error. */
export async function failT(key: ErrorKey, values?: MessageValues): Promise<ActionFailure> {
  return fail(await tr(key, values));
}

/** `failFields()` for a zod failure, with the schema's `vmsg` keys translated. */
export async function failZod(fieldErrors: Record<string, string[]>): Promise<ActionFailure> {
  return failFields(await localizedFieldErrors(fieldErrors));
}
