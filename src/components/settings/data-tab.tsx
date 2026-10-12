"use client";

import { useTranslations } from "next-intl";

import * as React from "react";
import { Download, RefreshCw } from "lucide-react";
import { Panel, PanelHeader, PanelBody, Button, useToast } from "@/components/ui";
import { recomputeDerivedColumns } from "@/app/(app)/settings/actions";

export function DataTab() {
  const t = useTranslations("settings.data");
  const [pending, setPending] = React.useState(false);
  const { toast } = useToast();

  async function handleRecompute() {
    setPending(true);
    const result = await recomputeDerivedColumns();
    setPending(false);
    if (result.ok) {
      toast({ title: t("recomputed", { count: result.updated ?? 0 }) });
    } else {
      toast({ title: t("couldNotRecompute"), description: result.formError, tone: "loss" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title={t("export")} caption={t("exportCaption")} />
        <PanelBody className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-ink">{t("csvTitle")}</p>
              <p className="text-xs text-ink-3">{t("csvCaption")}</p>
            </div>
            <Button asChild variant="default" size="sm">
              <a href="/api/export/trades">
                <Download /> {t("csv")}
              </a>
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <div>
              <p className="text-sm text-ink">{t("jsonTitle")}</p>
              <p className="text-xs text-ink-3">{t("jsonCaption")}</p>
            </div>
            <Button asChild variant="default" size="sm">
              <a href="/api/export/data">
                <Download /> {t("json")}
              </a>
            </Button>
          </div>
          <p className="border-t border-line pt-3 text-2xs text-ink-3">{t("notIncluded")}</p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title={t("derived")} caption={t("derivedCaption")} />
        <PanelBody className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="max-w-md text-xs text-ink-3">
            If pip or P&amp;L numbers look stale after editing an instrument or importing trades, recompute them here —
            this runs the exact same logic a backfill script would, across every trade in your accounts.
          </p>
          <Button variant="default" size="sm" onClick={handleRecompute} disabled={pending} className="shrink-0">
            <RefreshCw /> {t("recompute")}
          </Button>
        </PanelBody>
      </Panel>
    </div>
  );
}
