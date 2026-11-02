"use client";

import * as React from "react";
import type { ChartTool } from "./candlestick-chart";

/** What the replay keyboard can do; `replay-session.tsx` supplies it. */
export interface ReplayHotkeyActions {
  undo: () => void;
  togglePlaying: () => void;
  stepForward: (bars: number) => void;
  stepBack: () => void;
  changeSpeed: (direction: 1 | -1) => void;
  /** Whether B/S may place an order right now. */
  canOrder: boolean;
  order: (side: "LONG" | "SHORT") => void;
  togglePositionTool: (side: "LONG" | "SHORT") => void;
  close: () => void;
  cancelPending: () => void;
  setTool: (tool: ChartTool) => void;
  toggleHigherTimeframe: () => void;
  escape: () => void;
  removeSelected: () => void;
}

/** Typing into a field must never trigger a chart shortcut. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.tagName === "SELECT" || !!el?.isContentEditable;
}

/** Space on a focused button presses it; play/pause must not take it. */
function isPressable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.("button, a[href], [role='button'], [role='radio'], [role='tab'], [role='menuitem']");
}

/**
 * The replay's keyboard shortcuts (docs/BACKTEST.md lists them; the toolbar's
 * keyboard button shows them). Split out of the session component, where it
 * was a hundred-line effect with a fifteen-entry dependency list that had to
 * be kept in step by hand. The listener is registered once and reads the
 * latest actions from a ref, so the session can pass a fresh object every
 * render without re-subscribing.
 */
export function useReplayHotkeys(actions: ReplayHotkeyActions): void {
  const latest = React.useRef(actions);
  React.useEffect(() => {
    latest.current = actions;
  });

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTyping(e.target)) return;
      const a = latest.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        a.undo();
        return;
      }
      if (mod || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      switch (key) {
        case " ":
          // It used to call preventDefault here unconditionally, so Space
          // could not press whichever toolbar button had keyboard focus.
          if (isPressable(e.target)) return;
          e.preventDefault();
          a.togglePlaying();
          break;
        case "ArrowRight":
          e.preventDefault();
          a.stepForward(e.shiftKey ? 10 : 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          a.stepBack();
          break;
        case "+":
        case "=":
          a.changeSpeed(1);
          break;
        case "-":
          a.changeSpeed(-1);
          break;
        case "b":
        case "s": {
          if (!a.canOrder) break;
          const side = key === "b" ? "LONG" : "SHORT";
          if (e.shiftKey) a.togglePositionTool(side);
          else a.order(side);
          break;
        }
        case "c":
          a.close();
          break;
        case "x":
          a.cancelPending();
          break;
        case "v":
          a.setTool("cursor");
          break;
        case "t":
          a.setTool("trend");
          break;
        case "h":
          a.setTool("hline");
          break;
        case "r":
          a.setTool("rect");
          break;
        case "f":
          a.setTool("fib");
          break;
        case "m":
          a.toggleHigherTimeframe();
          break;
        case "Escape":
          a.escape();
          break;
        case "Delete":
        case "Backspace":
          a.removeSelected();
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
