"use client";

import * as React from "react";
import { Download, RefreshCw } from "lucide-react";
import { Panel, PanelHeader, PanelBody, Button, useToast } from "@/components/ui";
import { recomputeDerivedColumns } from "@/app/(app)/settings/actions";

export function DataTab() {
  const [pending, setPending] = React.useState(false);
  const { toast } = useToast();

  async function handleRecompute() {
    setPending(true);
    const result = await recomputeDerivedColumns();
    setPending(false);
    if (result.ok) {
      toast({ title: `Recomputed ${result.updated ?? 0} trade${result.updated === 1 ? "" : "s"}.` });
    } else {
      toast({ title: "Could not recompute", description: result.formError, tone: "loss" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title="Export" caption="Download your data for backup or use elsewhere." />
        <PanelBody className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-ink">Trades — CSV</p>
              <p className="text-xs text-ink-3">The active account&apos;s trades, one row per trade.</p>
            </div>
            <Button asChild variant="default" size="sm">
              <a href="/api/export/trades">
                <Download /> Download CSV
              </a>
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <div>
              <p className="text-sm text-ink">Everything — JSON</p>
              <p className="text-xs text-ink-3">Profile, accounts, trades, tags and journal entries.</p>
            </div>
            <Button asChild variant="default" size="sm">
              <a href="/api/export/data">
                <Download /> Download JSON
              </a>
            </Button>
          </div>
          <p className="border-t border-line pt-3 text-2xs text-ink-3">
            Not included: attachment image/file bytes (only their stored URL or storage key, if any), and your
            password hash.
          </p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Derived columns"
          caption="Net P&L, pips, R-multiple and session — recomputed from raw trade data."
        />
        <PanelBody className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="max-w-md text-xs text-ink-3">
            If pip or P&amp;L numbers look stale after editing an instrument or importing trades, recompute them
            here — this runs the exact same logic a backfill script would, across every trade in your accounts.
          </p>
          <Button variant="default" size="sm" onClick={handleRecompute} disabled={pending} className="shrink-0">
            <RefreshCw /> Recompute
          </Button>
        </PanelBody>
      </Panel>
    </div>
  );
}
