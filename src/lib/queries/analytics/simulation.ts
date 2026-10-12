import "server-only";
import { equityCurve, tradingWeekday } from "@/lib/metrics";
import { toDecOr, toNum } from "@/lib/decimal-bridge";
import { toTradeRow } from "@/lib/trade-service";
import type { SimTrade } from "@/lib/simulate/what-if";
import { fetchAccountData } from "./context";

/**
 * The inputs the Simulate page needs, as plain numbers: every CLOSED trade in
 * the account (all time — a what-if over a 30-day slice is too few trades to
 * mean anything) plus what the controls offer to filter by.
 */
export interface SimulationInputs {
  currency: string;
  startingBalance: number;
  /** Today's balance (trades plus deposits/withdrawals) — where a Monte Carlo
   * run starts, since it answers "from here, what could happen". */
  currentBalance: number;
  trades: SimTrade[];
  symbols: string[];
  sessions: string[];
  tags: { id: string; name: string; kind: string }[];
}

export async function simulationInputs(userId: string, accountId: string): Promise<SimulationInputs> {
  const { account, timezone, trades, balanceEvents } = await fetchAccountData(userId, accountId);
  const curve = equityCurve(
    trades.map(toTradeRow),
    toDecOr(account.startingBalance, 0),
    balanceEvents.map((e) => ({ at: e.occurredAt, amount: toDecOr(e.amount, 0), kind: e.kind })),
  );
  const closed = trades.filter((t) => t.status === "CLOSED" && t.closedAt !== null && t.netPnl !== null);
  const tags = new Map<string, { id: string; name: string; kind: string }>();
  for (const t of closed) for (const tt of t.tradeTags) tags.set(tt.tag.id, tt.tag);

  return {
    currency: account.currency,
    startingBalance: toNum(account.startingBalance) ?? 0,
    currentBalance: curve.length
      ? (toNum(curve[curve.length - 1].balance) ?? 0)
      : (toNum(account.startingBalance) ?? 0),
    trades: closed.map((t) => ({
      id: t.id,
      closedAt: t.closedAt!.getTime(),
      netPnl: toNum(t.netPnl) ?? 0,
      rMultiple: toNum(t.rMultiple),
      riskAmount: toNum(t.riskAmount),
      weekday: tradingWeekday(t.openedAt, timezone),
      session: t.marketSession,
      symbol: t.symbol,
      followedPlan: t.followedPlan,
      tagIds: t.tradeTags.map((tt) => tt.tag.id),
    })),
    symbols: [...new Set(closed.map((t) => t.symbol))].sort(),
    sessions: [...new Set(closed.map((t) => t.marketSession).filter((s): s is NonNullable<typeof s> => !!s))].sort(),
    tags: [...tags.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
  };
}
