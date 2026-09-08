"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "profit" | "loss" | "warn";

type ToastInput = {
  title: React.ReactNode;
  description?: React.ReactNode;
  tone?: Tone;
  action?: { label: string; onClick: () => void };
};

type ToastItem = ToastInput & { id: number };

const DURATION = 4500;
const MAX_VISIBLE = 4;

const ToastCtx = React.createContext<{
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
} | null>(null);

const toneEdge: Record<Tone, string> = {
  neutral: "before:bg-ink-3",
  profit: "before:bg-profit",
  loss: "before:bg-loss",
  warn: "before:bg-warn",
};

let seq = 0;

/** No dependency: the whole system is one queue of plain objects, a fixed
 * stack, and a per-item timer that pauses on hover. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback((input: ToastInput) => {
    seq += 1;
    const id = seq;
    setItems((prev) => [...prev, { ...input, id }].slice(-MAX_VISIBLE));
  }, []);

  const ctx = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4",
          "sm:inset-x-auto sm:right-4 sm:items-end",
        )}
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = React.useState(false);
  const remaining = React.useRef(DURATION);
  // Set on mount rather than at render time: reading the clock during render
  // is impure, and the timer only needs to start once the toast is on screen.
  const startedAt = React.useRef(0);

  // `onDismiss` arrives as a fresh inline closure from the provider on every
  // render, so depending on it directly would restart the dismiss timer each
  // time the provider re-rendered — a toast that never disappears. Held in a
  // ref instead, updated after commit, so the timeout always calls the
  // current one while the effect itself only re-runs when `paused` changes.
  //
  // (Excluding it from the dependency list was the right call; suppressing
  // the lint rule to express that was not, since the next reader cannot tell
  // a deliberate omission from an oversight.)
  const onDismissRef = React.useRef(onDismiss);
  React.useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  React.useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismissRef.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        "pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-[var(--radius-overlay)] border border-line bg-panel-raised pl-3.5 shadow-overlay",
        "before:absolute before:inset-y-0 before:left-0 before:w-[2px]",
        toneEdge[item.tone ?? "neutral"],
      )}
    >
      <div className="flex items-start gap-3 py-2.5 pr-2.5">
        <div className="min-w-0 flex-1 py-0.5">
          <p className="truncate text-sm font-medium text-ink">{item.title}</p>
          {item.description ? <p className="mt-0.5 text-xs text-ink-3">{item.description}</p> : null}
        </div>
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              onDismiss();
            }}
            className="shrink-0 self-center text-xs font-medium text-brand hover:text-brand-hover"
          >
            {item.action.label}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid size-5 shrink-0 place-items-center self-start rounded-[3px] text-ink-3 hover:bg-hover hover:text-ink"
        >
          <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
