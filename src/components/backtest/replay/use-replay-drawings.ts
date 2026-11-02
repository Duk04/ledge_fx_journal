"use client";

import * as React from "react";
import type { Drawing } from "@/lib/backtest/replay-tools";

/**
 * The session's drawings, kept in this browser per run.
 *
 * localStorage on purpose: drawings are a per-viewer working surface, like a
 * remembered tab, not journal data. Anchors are bar indexes into this run's
 * fixed bar array (lib/backtest/replay-tools.ts), so they only make sense
 * for this run — hence the key. Every access is guarded: storage can be
 * missing or throw (private mode), and the chart must work without it.
 */
export function useReplayDrawings(runId: string) {
  const key = `ledger:replay-drawings:${runId}`;

  // HYDRATION. The stored drawings are read through useSyncExternalStore,
  // whose server snapshot is "none": the first client render matches the
  // server's HTML, and React re-renders with what is stored right after. It
  // used to be a useState initializer reading localStorage, which hydrated
  // with drawings the server never rendered — React 19 does not patch a
  // mismatched attribute, so after a reload the Undo button stayed disabled
  // with drawings on the chart. It only showed where nothing else on the page
  // mismatched (any other mismatch made React re-render the whole page on the
  // client and hid it), which is why it passed in CI and failed locally.
  const raw = React.useSyncExternalStore(
    noSubscription,
    () => readStored(key),
    () => null,
  );
  const stored = React.useMemo(() => parseDrawings(raw), [raw]);
  // Null until the first edit; from then on the session's own list.
  const [edited, setEdited] = React.useState<Drawing[] | null>(null);
  const drawings = edited ?? stored;
  const setDrawings = React.useCallback(
    (update: (prev: Drawing[]) => Drawing[]) => setEdited((prev) => update(prev ?? stored)),
    [stored],
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (edited === null) return; // nothing changed yet: leave storage alone
    try {
      if (edited.length) window.localStorage.setItem(key, JSON.stringify(edited));
      else window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable: drawings last for this page view */
    }
  }, [key, edited]);

  const add = React.useCallback(
    (d: Omit<Drawing, "id">) => setDrawings((prev) => [...prev, { ...d, id: crypto.randomUUID() }]),
    [setDrawings],
  );

  const undo = React.useCallback(() => {
    setDrawings((prev) => prev.slice(0, -1));
    setSelectedId(null);
  }, [setDrawings]);

  const removeSelected = React.useCallback(() => {
    if (!selectedId) return;
    setDrawings((prev) => prev.filter((d) => d.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, setDrawings]);

  const clear = React.useCallback(() => {
    setDrawings(() => []);
    setSelectedId(null);
  }, [setDrawings]);

  return { drawings, selectedId, select: setSelectedId, add, undo, removeSelected, clear };
}

/** Drawings change only through this hook, so there is nothing to listen to. */
function noSubscription(): () => void {
  return () => {};
}

/** Every access is guarded: storage can be missing or throw (private mode). */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseDrawings(raw: string | null): Drawing[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Drawing[]) : [];
  } catch {
    return [];
  }
}
