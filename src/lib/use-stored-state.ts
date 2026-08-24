"use client";

import * as React from "react";

/**
 * A piece of UI state that lives in localStorage.
 *
 * Written with `useSyncExternalStore` rather than the usual
 * `useState` + `useEffect(() => setState(localStorage.getItem(...)))` pattern:
 * localStorage IS an external store, and treating it as one means no setState
 * inside an effect, no cascading render on mount, and two tabs staying in sync
 * for free. It also gives a clean server snapshot, so SSR renders the default
 * and hydration doesn't complain.
 *
 * Every access is wrapped: storage throws outright in some privacy modes, and
 * a remembered sidebar width is never worth a blank page.
 */
export function useStoredState<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: string) => value is T,
): [T, (next: T) => void] {
  const subscribe = React.useCallback((onChange: () => void) => {
    // `storage` fires for other tabs; the custom event covers this one.
    const handler = () => onChange();
    window.addEventListener("storage", handler);
    window.addEventListener("ledger:stored-state", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("ledger:stored-state", handler);
    };
  }, []);

  const getSnapshot = React.useCallback(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null && isValid(raw) ? raw : fallback;
    } catch {
      return fallback;
    }
  }, [key, fallback, isValid]);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, () => fallback);

  const set = React.useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, next);
      } catch {
        /* the change still applies for this page view */
      }
      window.dispatchEvent(new Event("ledger:stored-state"));
    },
    [key],
  );

  return [value, set];
}
