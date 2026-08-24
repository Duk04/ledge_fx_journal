// Ledger service worker — deliberately conservative. See docs/PWA.md for the
// full rationale; the short version:
//
//   - HTML and every /api/* request: NETWORK-FIRST. A journal that shows a
//     stale P&L number because the network blipped is worse than useless —
//     it's actively misleading. The cached copy is only a fallback for when
//     there's truly no connection, so a previous view is better than a
//     blank error screen.
//   - Hashed static assets (/_next/static/*, /icons/*): CACHE-FIRST. Their
//     filename changes when their content does, so a stale cache entry is
//     not a real possibility — old assets can be served instantly and never
//     re-fetched until a new build ships a new filename.
//   - Everything else: pass straight through, no opinion.
//   - No offline write queue. Queuing mutations for later replay is genuinely
//     hard to get right (ordering, conflicts, partial failure) and a
//     half-working queue silently loses trades, which is the one failure
//     mode this app cannot have. Instead the app disables writes while
//     offline and says so — see OfflineBanner and use-online-status.ts.
//
// Bump SW_VERSION on any change to this file's caching behaviour — it's the
// only thing that busts the old caches on the next activate.
const SW_VERSION = "v1";
const SHELL_CACHE = `ledger-shell-${SW_VERSION}`;
const STATIC_CACHE = `ledger-static-${SW_VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, STATIC_CACHE]);

const SHELL_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Best-effort: a route that 404s during install (e.g. before first
      // sign-in) shouldn't stop the worker from installing at all.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CURRENT_CACHES.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isHashedStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

function isNavigationOrApi(request, url) {
  return request.mode === "navigate" || url.pathname.startsWith("/api/") || request.headers.get("accept")?.includes("text/html");
}

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    // Only GETs are ever worth caching — POST/PUT/DELETE responses aren't
    // meaningfully replayable, and the Cache API rejects non-GET keys anyway.
    if (fresh.ok && request.method === "GET") {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Never intercept a write — there is nothing useful this worker can do
  // with a failed POST/PUT/PATCH/DELETE except get in the way of the app's
  // own error handling.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts.googleapis.com etc. — leave alone

  if (isNavigationOrApi(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isHashedStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else (e.g. /manifest.webmanifest on a later visit): no
  // opinion, let the browser's normal HTTP cache handle it.
});
