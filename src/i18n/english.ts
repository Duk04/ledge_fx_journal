import { createTranslator } from "next-intl";
import en from "../../messages/en.json";
import { translateVmsg, type MessageValues, type ValidationKey } from "./encoded";

const t = createTranslator({ locale: "en", messages: en });

/**
 * A `vmsg`-encoded message rendered in English — for tests and logs, which
 * should read the sentence a person sees rather than the wire key. Kept out
 * of encoded.ts so the browser bundle doesn't pull in en.json through it.
 */
export function english(message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  return translateVmsg((key: ValidationKey, values?: MessageValues) => t(`validation.${key}`, values), message);
}
