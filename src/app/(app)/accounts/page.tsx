import { SectionHead, EmptyState } from "@/components/ui";
import { Page } from "@/components/shell/page";
import { AccountCard, type AccountCardData } from "@/components/accounts/account-card";
import { NewAccountButton } from "@/components/accounts/new-account-button";
import { requireUser } from "@/lib/session";
import { cashFlow, listAccountRiskSettings, listAccounts, listBalanceEventsFlat } from "@/lib/queries/accounts";
import { resolveActiveTradingAccountId } from "@/lib/queries/journal";
import { type Decimal } from "decimal.js";
import { toDec, toPlain } from "@/lib/decimal-bridge";
import type { BalanceEventRow } from "@/components/accounts/balance-events-dialog";

export default async function AccountsPage() {
  const user = await requireUser();

  const [accounts, activeAccountId, rawEvents, riskRows] = await Promise.all([
    listAccounts(user.id),
    resolveActiveTradingAccountId(user.id),
    listBalanceEventsFlat(user.id),
    listAccountRiskSettings(user.id),
  ]);

  const riskByAccount = new Map(riskRows.map((r) => [r.id, toPlain(r.riskPerTradePct)]));

  function bucket<T>(map: Map<string, T[]>, key: string, value: T) {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  }

  const eventsByAccount = new Map<string, BalanceEventRow[]>();
  const rawByAccount = new Map<string, { kind: string; amount: Decimal }[]>();
  for (const e of rawEvents) {
    bucket(eventsByAccount, e.accountId, {
      id: e.id,
      kind: e.kind,
      amount: toPlain(e.amount)!,
      occurredAt: e.occurredAt.toISOString(),
      note: e.note,
    });
    bucket(rawByAccount, e.accountId, { kind: e.kind, amount: toDec(e.amount)! });
  }
  const flowByAccount = new Map(
    [...rawByAccount.entries()].map(([accountId, events]) => [accountId, cashFlow(events)] as const),
  );

  const cards: AccountCardData[] = accounts.map((a) => {
    const flow = flowByAccount.get(a.id);
    return {
      id: a.id,
      label: a.label,
      broker: a.broker,
      platform: a.platform,
      accountType: a.accountType,
      currency: a.currency,
      startingBalance: a.startingBalance,
      riskPerTradePct: riskByAccount.get(a.id) ?? null,
      equity: a.equity,
      netPnl: a.netPnl,
      tradeCount: a.tradeCount,
      openCount: a.openCount,
      spark: a.spark,
      isArchived: a.isArchived,
      deposits: flow ? flow.deposits.toString() : "0",
      withdrawals: flow ? flow.withdrawals.abs().toString() : "0",
    };
  });

  const active = cards.filter((a) => !a.isArchived);
  const archived = cards.filter((a) => a.isArchived);

  return (
    <Page>
      <SectionHead
        title="Accounts"
        hint="Every broker account you track, its equity, and where its cash has gone."
        actions={<NewAccountButton />}
      />

      {active.length === 0 && archived.length === 0 ? (
        <EmptyState
          title="No trading accounts yet"
          description="Add your first account to start logging trades and journaling against it."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {active.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              isActive={a.id === activeAccountId}
              events={eventsByAccount.get(a.id) ?? []}
            />
          ))}
        </div>
      )}

      {archived.length > 0 ? (
        <details className="group">
          <summary className="label cursor-pointer list-none px-1 py-2 select-none">
            Archived accounts ({archived.length})
          </summary>
          <div className="mt-2 flex flex-col gap-4 opacity-70">
            {archived.map((a) => (
              <AccountCard key={a.id} account={a} isActive={false} events={eventsByAccount.get(a.id) ?? []} />
            ))}
          </div>
        </details>
      ) : null}
    </Page>
  );
}
