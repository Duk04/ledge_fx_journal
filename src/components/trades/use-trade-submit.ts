"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";
import { useToast } from "@/components/ui";
import { useOnlineStatus } from "@/components/pwa/use-online-status";
import { createTrade, updateTrade } from "@/lib/actions/trades";
import { LAST_RISK_KEY, LAST_SYMBOL_KEY, buildFormData, type TradeFormInput } from "./trade-form-values";
import { uploadAttachment } from "./attachment-files";
import type { PendingScreenshot } from "./pending-screenshots";

/**
 * What saving the trade form does, apart from the form: refuse offline,
 * post, remember the symbol and risk for next time, upload the screenshots
 * picked before the trade existed, then report and move on — or map the
 * server's field errors back onto the form. Split out of trade-form.tsx.
 */
export function useTradeSubmit({
  mode,
  accountId,
  tradeId,
  rMode,
  form,
  screenshots,
}: {
  mode: "create" | "edit";
  accountId: string;
  tradeId?: string;
  rMode: boolean;
  form: UseFormReturn<TradeFormInput>;
  screenshots: PendingScreenshot[];
}) {
  const t = useTranslations("trades.form");
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [uploading, setUploading] = React.useState<{ done: number; total: number } | null>(null);

  async function onSubmit(values: TradeFormInput) {
    // The submit button is disabled offline, but ⌘⏎ calls requestSubmit()
    // directly and that ignores a disabled button. docs/PWA.md: no offline
    // write queue, so say so instead of letting the action fail opaquely.
    if (!online) {
      toast({
        title: t("offlineTitle"),
        description: t("offlineDescription"),
        tone: "warn",
      });
      return;
    }
    // `values` is the resolver's OUTPUT, which carries only schema fields —
    // and neither schema has `entryMode`. Without restating it here an R
    // form posts as a price form.
    const fd = buildFormData({ ...values, entryMode: rMode ? "R_MULTIPLE" : "PRICE" });
    const result = mode === "create" ? await createTrade(accountId, fd) : await updateTrade(accountId, tradeId!, fd);

    if (result.ok) {
      try {
        window.localStorage.setItem(LAST_SYMBOL_KEY, values.symbol);
        if (rMode && values.plannedRisk) window.localStorage.setItem(LAST_RISK_KEY, values.plannedRisk);
      } catch {
        /* ignore */
      }
      // Sequential, not parallel: a handful of chart images, and one at a
      // time keeps the progress honest and the server's memory flat. The
      // trade is already saved, so a failure here costs a re-upload on the
      // trade page, not the trade.
      let failed = 0;
      if (mode === "create" && screenshots.length) {
        for (const [i, shot] of screenshots.entries()) {
          setUploading({ done: i, total: screenshots.length });
          const up = await uploadAttachment({ target: { tradeId: result.id }, file: shot.file, kind: shot.kind });
          if (!up.ok) failed++;
        }
        setUploading(null);
      }
      if (failed) {
        toast({
          title: t("logged"),
          description: t("screenshotsFailed", { count: failed }),
          tone: "warn",
        });
      } else {
        toast({ title: mode === "create" ? t("logged") : t("updated") });
      }
      router.push(`/trades/${result.id}`);
      return;
    }

    if (result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        form.setError(field as keyof TradeFormInput, { type: "server", message: messages[0] });
      }
    }
    toast({
      title: t("saveFailed"),
      description: result.formError ?? t("checkFields"),
      tone: "loss",
    });
  }

  return { onSubmit, uploading };
}
