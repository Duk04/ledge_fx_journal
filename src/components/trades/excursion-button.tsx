"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, useToast } from "@/components/ui";
import { fillExcursionFromCandles } from "@/lib/actions/excursion";

export function ExcursionFromCandlesButton({ accountId, tradeId }: { accountId: string; tradeId: string }) {
  const t = useTranslations("trades.detail.excursion");
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await fillExcursionFromCandles(accountId, tradeId);
          if (!res.ok) {
            toast({ title: t("failed"), description: res.formError, tone: "warn" });
            return;
          }
          toast({ title: t("measured", { bars: String(res.barsUsed) }) });
          router.refresh();
        })
      }
    >
      {pending ? t("measuring") : t("measure")}
    </Button>
  );
}
