import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { SectionHead } from "@/components/ui";
import { PositionCalculator } from "@/components/calculator/position-calculator";
import { resolveActiveAccountId } from "@/lib/active-account";
import { toNum } from "@/lib/decimal-bridge";
import { overview } from "@/lib/queries/analytics";
import { listInstrumentSpecs } from "@/lib/queries/instruments";
import { requireAccountAccess, requireUser } from "@/lib/session";

export default async function CalculatorPage() {
  const user = await requireUser();
  const accountId = await resolveActiveAccountId(user.id);
  if (!accountId) redirect("/accounts");
  const account = await requireAccountAccess(accountId);

  // All-time overview: its prop status carries both the current balance and
  // today's remaining loss allowance, computed the same way the dashboard does.
  const [ov, instruments] = await Promise.all([
    overview({ userId: user.id, accountId: account.id, from: null, to: null }),
    listInstrumentSpecs(),
  ]);
  const t = await getTranslations("calculator");
  const balance = ov.equity.length ? ov.equity[ov.equity.length - 1].balance : (toNum(account.startingBalance) ?? 0);

  return (
    <Page>
      <SectionHead title={t("title")} hint={t("hint", { account: account.label })} />
      <PositionCalculator
        instruments={instruments}
        currency={account.currency}
        equity={balance}
        riskPerTradePct={toNum(account.riskPerTradePct)}
        dailyLossRemaining={ov.prop?.dailyLoss?.remaining ?? null}
      />
    </Page>
  );
}
