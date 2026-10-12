"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { fillExcursionFromCandles } from "@/lib/actions/excursion";

export function ExcursionFromCandlesButton({ accountId, tradeId }: { accountId: string; tradeId: string }) {
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
            toast({ title: "Couldn't measure from candles", description: res.formError, tone: "warn" });
            return;
          }
          toast({ title: `MAE/MFE measured from ${res.barsUsed} M1 bars` });
          router.refresh();
        })
      }
    >
      {pending ? "Measuring…" : "Measure from candles"}
    </Button>
  );
}
