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
     * Run on every path except:
     *  - /login                     (the sign-in page itself)
     *  - /api/auth/*                (Auth.js's own endpoints)
     *  - /_next/*                   (Next.js internals: static, image, etc.)
     *  - /manifest.webmanifest
     *  - /icons/*
     *  - files with an extension (favicon.ico, *.png, *.svg, ...) served
     *    straight out of /public
     */
    "/((?!login$|api/auth/|_next/|manifest\\.webmanifest$|icons/|.*\\..*).*)",
  ],
};
