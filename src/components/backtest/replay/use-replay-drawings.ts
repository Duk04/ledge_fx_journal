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
  const [drawings, setDrawings] = React.useState<Drawing[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as Drawing[]) : [];
    } catch {
      return [];
    }
  });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      if (drawings.length) window.localStorage.setItem(key, JSON.stringify(drawings));
      else window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable: drawings last for this page view */
    }
  }, [key, drawings]);

  const add = React.useCallback((d: Omit<Drawing, "id">) => {
    setDrawings((prev) => [...prev, { ...d, id: crypto.randomUUID() }]);
  }, []);

  const undo = React.useCallback(() => {
    setDrawings((prev) => prev.slice(0, -1));
    setSelectedId(null);
  }, []);

  const removeSelected = React.useCallback(() => {
    if (!selectedId) return;
    setDrawings((prev) => prev.filter((d) => d.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  const clear = React.useCallback(() => {
    setDrawings([]);
    setSelectedId(null);
  }, []);

  return { drawings, selectedId, select: setSelectedId, add, undo, removeSelected, clear };
}
