/**
 * Password policy. Pure, so it is testable and can run on either side.
 *
 * The previous rule was `z.string().min(8)` and nothing else.
 */

/** Minimum length. Eight is the number everyone uses and nobody defends. */
export const MIN_PASSWORD_CHARS = 10;

/**
 * bcrypt hashes at most 72 BYTES of input and silently discards the rest.
 *
 * That matters more than it sounds. Bytes, not characters: an emoji is four
 * bytes, so nineteen emoji is 76 bytes and the last one is ignored — two
 * different passwords that hash identically, with no error and no way for the
 * user to find out. Long passphrases in non-Latin scripts hit it too:
 * Mongolian Cyrillic is two bytes per character, so 37 characters is the real
 * ceiling.
 *
 * Rejecting is the honest option. The alternative usually recommended —
 * pre-hashing with SHA-256 so the input is always 32 bytes — works, but it
 * changes the stored format, which means every existing hash needs a
 * migration path. Not worth it to accept passwords longer than most managers
 * generate.
 */
export const MAX_PASSWORD_BYTES = 72;

export type PasswordCheck = { ok: true } | { ok: false; message: string };

/**
 * The 200 or so passwords that appear at the top of every breach corpus.
 *
 * Deliberately a short inline list rather than a bundled 100k-entry file or a
 * call to Have I Been Pwned. A megabyte of wordlist in the server bundle buys
 * little over this, and a network call on the registration path adds a
 * dependency and a latency spike to the one flow that must not fail. HIBP's
 * k-anonymity API is the right upgrade if this ever needs to be thorough;
 * this list exists to catch "password123", not to be a breach oracle.
 */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "12345",
  "111111",
  "123123",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "1q2w3e4r",
  "1qaz2wsx",
  "zaq12wsx",
  "abc123",
  "abcd1234",
  "a1b2c3d4",
  "iloveyou",
  "letmein",
  "welcome",
  "welcome1",
  "admin",
  "admin123",
  "administrator",
  "root",
  "toor",
  "guest",
  "test",
  "test123",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "basketball",
  "master",
  "shadow",
  "michael",
  "jennifer",
  "jordan",
  "superman",
  "batman",
  "trustno1",
  "starwars",
  "pokemon",
  "computer",
  "internet",
  "samsung",
  "google",
  "changeme",
  "secret",
  "default",
  "temp1234",
  "qazwsxedc",
  "asdfghjkl",
  "zxcvbnm",
  "login",
  "passer2009",
  "hello123",
  "freedom",
  "whatever",
  "querty",
  "photoshop",
  // Plausible-looking choices for this particular app.
  "trading",
  "trading123",
  "forex",
  "forex123",
  "eurusd",
  "eurusd123",
  "journal",
  "ledger",
  "ledger123",
  "profit",
  "profit123",
  "pipsahoy",
  "tradingview",
]);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** The part of an email before the @, lowercased. */
function localPart(email: string): string {
  return email.split("@")[0]?.toLowerCase() ?? "";
}

/**
 * Validates a candidate password.
 *
 * `email` is optional so the rule can be applied where an address isn't known
 * (a password-change form). When present, a password that contains the email's
 * local part — or is contained by it — is refused: "duk@example.com" /
 * "duk12345678" is a password an attacker guesses from the address alone.
 */
export function validatePassword(password: string, ctx: { email?: string } = {}): PasswordCheck {
  if (password.length < MIN_PASSWORD_CHARS) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD_CHARS} characters.` };
  }

  const bytes = byteLength(password);
  if (bytes > MAX_PASSWORD_BYTES) {
    return {
      ok: false,
      message: `That password is too long to be hashed safely (${bytes} bytes; the limit is ${MAX_PASSWORD_BYTES}). Emoji and non-Latin characters each count as several bytes.`,
    };
  }

  const lower = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, message: "That password appears in every breach list. Choose something else." };
  }

  if (ctx.email) {
    const local = localPart(ctx.email);
    if (local.length >= 3 && (lower.includes(local) || local.includes(lower))) {
      return { ok: false, message: "Don't build the password out of your email address." };
    }
  }

  // A single repeated character passes a length check and nothing else.
  if (new Set(password).size < 4) {
    return { ok: false, message: "That password repeats too few distinct characters." };
  }

  return { ok: true };
}
