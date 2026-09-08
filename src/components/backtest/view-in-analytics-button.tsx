"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChartLine } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { setActiveAccount } from "@/lib/actions/accounts";

/**
 * `/analytics` reads its account from a cookie (see active-account.ts), not
 * a URL param — so "view this backtest in Analytics" means switching the
 * active account to the run's BACKTEST account first, the same server
 * action the account switcher itself uses, then navigating. This is the
 * one place the analytics module needed touching, and it didn't: every
 * report there already works on a BACKTEST-type account for free.
 */
export function ViewInAnalyticsButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await setActiveAccount(accountId);
      if (result.ok) {
        router.push("/analytics");
      } else {
        toast({ title: "Couldn't switch to this run's account", description: result.formError, tone: "loss" });
      }
    });
  }

  return (
    <Button variant="default" size="sm" onClick={handleClick} disabled={pending}>
      <ChartLine /> View in Analytics
    </Button>
  );
}
