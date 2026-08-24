"use client";

import * as React from "react";

/**
 * Tracks `navigator.onLine`, live. Shared by `<OfflineBanner>` and by any
 * form that needs to disable its own submit while offline — the trade form
 * in particular (see docs/PWA.md: there is deliberately no offline write
 * queue, so a disabled submit + this hook is the whole strategy).
 *
 * `useSyncExternalStore` rather than a `useState` + `useEffect` pair: the
 * browser's online/offline events are exactly the kind of external store
 * this hook exists for, and subscribing this way means there's no "empty
 * effect body that immediately calls setState" render-then-correct flash —
 * the very first client render already reflects the real connectivity.
 *
 * `navigator.onLine` is a same-network-interface check, not a "can this
 * app's server actually be reached" check — it can be wrong in either
 * direction (captive portals, VPNs). It's still the right signal here: it
 * catches the common case (phone loses signal, laptop lid closed) cheaply,
 * and a real fetch failure is caught separately wherever a mutation runs.
 */
export function useOnlineStatus(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

/** Assume online during SSR — the server has no connectivity signal of its own, and the client snapshot corrects it on hydration. */
function getServerSnapshot(): boolean {
  return true;
}
