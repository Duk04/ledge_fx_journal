/**
 * Route protection, running on every request except the paths excluded by
 * `config.matcher` below.
 *
 * Deliberately named `middleware.ts` (not `proxy.ts`, the Next.js 16
 * replacement): Next 16 keeps `middleware.ts` working specifically for
 * code that needs the Edge runtime, since the new `proxy.ts` convention is
 * pinned to the Node.js runtime and cannot be configured otherwise. This
 * file needs to run at the edge (cheap, no cold-start on every navigation)
 * and — more importantly — must never bundle Prisma or bcryptjs, both of
 * which are Node-only and would fail to build for the Edge runtime.
 *
 * That's why it builds its own `NextAuth()` instance from `auth-config.ts`
 * (the edge-safe half of the config: JWT session decode + the `authorized`
 * callback) instead of importing `auth` from `src/lib/auth.ts`, which pulls
 * in the Prisma adapter and the Credentials provider's bcrypt check.
 *
 * All of the actual "redirect to /login?next=... vs. 401 JSON" logic lives
 * in `authConfig.callbacks.authorized` (src/lib/auth-config.ts) so it's
 * defined once and shared with anything else that builds off `authConfig`.
 */
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth-config";

export const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    /*
     * Run on every path except the ones listed.
     *
     * THE HOLE THIS CLOSES. The previous pattern ended with a "any path
     * containing a dot" alternative, intended as "static files have
     * extensions". It excluded far more than that: ANY route with a dot
     * anywhere in it was served with no middleware at all — a date segment
     * like /journal/2026.09.08, a symbol with a dot in it, or any future
     * route someone adds without realising a dot silently disables the gate.
     * Only the per-page requireUser() calls stood behind it.
     *
     * Extensions are now listed explicitly. Adding a new static file type
     * means editing this line, which is the right amount of friction for
     * something that turns route protection off.
     *
     * This pattern and isPublicPath() in lib/auth-config.ts are two halves of
     * ONE rule — this decides whether the callback runs, that decides what it
     * does — and lib/auth-config.test.ts asserts the two agree.
     */
    "/((?!login$|register$|forgot-password$|reset-password$|verify-email$|api/auth/|_next/|manifest\\.webmanifest$|sw\\.js$|icons/|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|txt|xml|json|woff2?|ttf|map)$).*)",
  ],
};
