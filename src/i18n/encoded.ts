/**
 * Validation messages that cross the client/server line as KEYS, not English.
 *
 * WHY. A zod schema is built once at module scope and shared by the browser
 * (react-hook-form's resolver) and the server action that re-validates — so a
 * message baked into it cannot be in the reader's language: there is no
 * request, and no translator, when the module is evaluated. The schema
 * carries `vmsg("entryRequired")` instead, and whoever DISPLAYS it translates:
 * `FieldError` in the browser, `localizedFieldErrors()` on the server.
 *
 * The wire form is a plain string so it fits every place zod and RHF already
 * put a message (`issue.message`, `setError({ message })`). A string that does
 * not carry the prefix is passed through untouched, so an untranslated
 * message degrades to English rather than to a raw key.
 */
import type { Messages } from "next-intl";

export type ValidationKey = keyof Messages["validation"];
export type MessageValues = Record<string, string | number>;

const PREFIX = "@v:";

export function vmsg(key: ValidationKey, values?: MessageValues): string {
  return PREFIX + key + (values ? "|" + JSON.stringify(values) : "");
}

export function decodeVmsg(message: string): { key: ValidationKey; values?: MessageValues } | null {
  if (!message.startsWith(PREFIX)) return null;
  const body = message.slice(PREFIX.length);
  const bar = body.indexOf("|");
  if (bar === -1) return { key: body as ValidationKey };
  try {
    return { key: body.slice(0, bar) as ValidationKey, values: JSON.parse(body.slice(bar + 1)) as MessageValues };
  } catch {
    return { key: body.slice(0, bar) as ValidationKey };
  }
}

type ValidationT = (key: ValidationKey, values?: MessageValues) => string;

/** Translates an encoded message; anything else is returned as-is. */
export function translateVmsg(t: ValidationT, message: string): string {
  const decoded = decodeVmsg(message);
  return decoded ? t(decoded.key, decoded.values) : message;
}
