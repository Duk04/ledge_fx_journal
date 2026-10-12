import { TZDate } from "@date-fns/tz";
import { AlertTriangle } from "lucide-react";
import { requireAccountAccess, requireUser } from "@/lib/session";
import { toNum } from "@/lib/decimal-bridge";
import { getAccountEquity, listTradesOpenedBetween } from "@/lib/queries/accounts";
import { computeRiskGuard, type RiskTradeInput } from "@/lib/risk";

/**
 * A same-day observation strip, not a scold. It renders nothing at all when
 * there's nothing to say — most days should be silent — and every message
 * describes what happened rather than what the trader did wrong ("Two
 * losses in a row today. Your rule says stop at two.", never "You broke
 * your rules!"). See docs/DESIGN-SYSTEM.md for the tone this follows.
 *
 * Self-contained on purpose: it re-authenticates and re-validates account
 * ownership itself (see SCOPING RULE in lib/session.ts) rather than trusting
 * props from whatever page mounts it, so dropping `<RiskGuard accountId={…} />`
 * into a new page is always safe on its own.
 *
 * Mounted on the Overview dashboard (src/app/(app)/(overview)/page.tsx), under the
 * SectionHead and above the StatRow, so a breach is the first thing seen on
 * the page it is most relevant to.
 */
export async function RiskGuard({ accountId }: { accountId: string }) {
  const user = await requireUser();
  const account = await requireAccountAccess(accountId);

  const dayStart = startOfToday(user.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [todaysTrades, equityData] = await Promise.all([
    listTradesOpenedBetween({ userId: user.id, accountId: account.id, from: dayStart, to: dayEnd }),
    getAccountEquity(user.id, account.id),
  ]);

  const trades: RiskTradeInput[] = todaysTrades.map((t) => ({
    id: t.id,
    netPnl: toNum(t.netPnl),
    riskAmount: toNum(t.riskAmount),
    hasStop: t.stopLoss !== null,
  }));

  const startingBalance = toNum(account.startingBalance) ?? 0;
  const equity = equityData?.curve.length ? equityData.curve[equityData.curve.length - 1].balance : startingBalance;

  const result = computeRiskGuard({
    trades,
    startingBalance,
    riskPerTradePct: toNum(account.riskPerTradePct),
    dailyLossLimitPct: toNum(account.dailyLossLimitPct),
    equity,
  });

  if (result.breaches.length === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-col gap-1.5 rounded-[var(--radius-panel)] border border-warn/30 bg-warn-weak px-3.5 py-2.5"
    >
      {result.breaches.map((breach) => (
        <div key={breach.type} className="flex items-start gap-2 text-xs text-warn">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{breach.message}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Midnight today in the user's timezone, as a plain Date.
 *
 * The `new Date(...getTime())` is not redundant. `TZDate` extends Date and
 * its instant is correct, but it overrides `toISOString()` to emit an offset
 * rather than a Z-suffixed UTC string — and this value goes straight into a
 * Prisma `where` against `TIMESTAMP(3)` columns, which carry no time zone.
 * Same normalisation as lib/range.ts, for the same reason.
 */
function startOfToday(timezone: string, now: Date = new Date()): Date {
  const zoned = new TZDate(now, timezone);
  return new Date(TZDate.tz(timezone, zoned.getFullYear(), zoned.getMonth(), zoned.getDate()).getTime());
}
