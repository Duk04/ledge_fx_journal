"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui";
import { recordReplayTrade } from "@/lib/actions/backtests";
import type { SimTrade } from "@/lib/backtest/types";

/**
 * Saving a replay session's trades as they close, and knowing when they all
 * have. Split out of the session component so the one subtle part — every
 * save must settle, success or not, before the session may finish — sits
 * on its own.
 *
 *  - `onTradeClosed` starts a save the moment the engine closes a trade.
 *  - `pending` is the count in flight, for the footer's "Saving…".
 *  - `drain()` waits for every save to settle — including ones started
 *    while it waits, since closing the last position enqueues one — and
 *    returns how many failed, so the caller does not navigate to results
 *    that silently lack them.
 */
export function useReplayPersistence(runId: string) {
  const t = useTranslations("backtest");
  const { toast } = useToast();
  // A ref so `drain` can await the exact in-flight set (a functional state
  // update wouldn't hand back the promises themselves), plus a counter in
  // state purely so "Saving…" re-renders — mutating a ref alone does not.
  const inFlight = React.useRef<Set<Promise<unknown>>>(new Set());
  const [pending, setPending] = React.useState(0);
  const failed = React.useRef(0);

  const onTradeClosed = React.useCallback(
    (trade: SimTrade) => {
      setPending((n) => n + 1);
      const p = recordReplayTrade(runId, trade)
        .then((res) => {
          if (res.ok) return;
          failed.current += 1;
          toast({ title: t("replay.couldNotSaveTrade"), description: res.formError, tone: "loss" });
        })
        // A rejected call (the network, not the action) must settle this
        // promise too: `drain` races the set, and a rejection there threw out
        // of it with the Save button left disabled.
        .catch(() => {
          failed.current += 1;
          toast({ title: t("replay.couldNotSaveTrade"), description: t("replay.saveNetworkError"), tone: "loss" });
        })
        .finally(() => {
          inFlight.current.delete(p);
          setPending((n) => n - 1);
        });
      inFlight.current.add(p);
    },
    [runId, toast, t],
  );

  const drain = React.useCallback(async (): Promise<number> => {
    while (inFlight.current.size > 0) {
      await Promise.race(inFlight.current);
    }
    const count = failed.current;
    failed.current = 0;
    return count;
  }, []);

  return { onTradeClosed, pending, drain };
}
