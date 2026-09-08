/**
 * Sanitises a `?next=` redirect target.
 *
 * THE BUG THIS FIXES. The previous implementation, duplicated in
 * `src/lib/actions/auth.ts` and `src/app/(auth)/login/page.tsx`, was:
 *
 *     value.startsWith("/") && !value.startsWith("//") ? value : "/"
 *
 * `/\evil.com` passes both tests — it starts with a slash and its second
 * character is a backslash, not a slash. Browsers then normalise the
 * backslash to a forward slash while resolving the Location header, so the
 * result is `//evil.com`: a protocol-relative URL, and the user lands on
 * another origin having clicked a link on this one. `/\/evil.com` is the same
 * trick. That is a working open redirect, which is a real phishing primitive
 * on a login page — the one page where a user is about to type a password.
 *
 * Prefix checks cannot settle this, because the question "does this resolve
 * to another origin?" is a URL-parsing question. So this parses. Anything
 * that resolves away from the base origin, or carries a scheme, or contains a
 * backslash or a control character, becomes "/".
 */

/** Any origin will do: it is discarded, and only used to detect escape. */
const BASE = "http://localhost";

export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";

  const value = next.trim();
  if (value === "" || value === "/") return "/";

  // `next` is always an absolute in-app path when this app writes it, so
  // anything without a leading slash did not come from us. A bare "evil.com"
  // would in fact resolve to the harmless same-origin path /evil.com, but
  // accepting it widens what this function promises for no benefit.
  if (!value.startsWith("/")) return "/";

  // Rejected before parsing, because `new URL` is lenient about all three and
  // browsers are not consistent about them:
  //   - backslash: normalised to "/" by browsers, so "/\host" escapes
  //   - control characters and whitespace: stripped by browsers, so
  //     "/\t//host" can become "//host"
  //   - a colon before the first slash: a scheme ("javascript:", "data:")
  // Checked separately from the character class: a backslash inside a regex
  // character class is the thing most likely to be mangled by an escaping
  // layer, and getting it wrong silently re-opens the exact hole this
  // function exists to close.
  if (value.includes("\\")) return "/";
  if (/[\u0000-\u0020\u007f]/.test(value)) return "/";

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return "/";
  }

  // The one test that matters: did it stay on this origin? This catches
  // "//evil.com" (protocol-relative), "https://evil.com" (absolute) and
  // "javascript:alert(1)" (different protocol, so a different origin or an
  // opaque one) without enumerating them.
  if (url.origin !== BASE) return "/";

  // Path and query only. A fragment is never useful in a server redirect and
  // is a place to hide things from log lines.
  const path = `${url.pathname}${url.search}`;
  return path.startsWith("/") ? path : "/";
}
