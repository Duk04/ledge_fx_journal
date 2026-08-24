"use client";

import * as React from "react";

/**
 * Registers `public/sw.js` on mount and gets out of the way. There is no
 * "update available" prompt UI here on purpose — the worker's own
 * `skipWaiting()` + `clients.claim()` (see sw.js) mean a new deploy takes
 * over on the very next navigation without asking, which is the right
 * default for an app with no offline write queue to worry about losing: an
 * abrupt takeover can never strand in-flight writes it doesn't know about.
 *
 * Renders nothing. Mounted once in src/app/(app)/layout.tsx.
 */
export function RegisterServiceWorker() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registration is fire-and-forget: a failure here (unsupported browser,
    // dev server without HTTPS, etc.) should never surface as user-facing
    // error UI — the app works perfectly well without a service worker, just
    // without the install prompt and asset caching.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
