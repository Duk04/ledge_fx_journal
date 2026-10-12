/**
 * Prop-firm challenge rules — pure, no I/O. Fed by the dashboard with the
 * account's equity curve and the rules stored on the TradingAccount.
 *
 * The rules are the ones evaluation firms actually use (FTMO, The5ers,
 * FundedNext and the like differ in numbers, not in kind):
 *
 *  - Daily loss limit: today's realised loss may not exceed X% of the
 *    STARTING balance. (Firms differ on whether open P&L counts; this journal
 *    has no live prices, so it is realised-only — said in the UI.)
 *  - Max drawdown, STATIC: balance may never close below start × (1 − X%).
 *  - Max drawdown, TRAILING: the floor follows the highest closed balance —
 *    peak × (1 − X%) — so locking in profit also raises the floor.
 *  - Profit target: balance reaches start × (1 + X%).
 *  - Minimum trading days: distinct days with at least one closed trade.
 *
 * "Breached" is sticky: a balance that dipped below the floor once has failed
 * the challenge, even if it recovered. That is how every firm scores it, and
 * the opposite would hide exactly the event the panel exists to show.
 *
 * Deposits/withdrawals are part of the curve but cannot set a new peak for
 * the trailing floor (same judgement call as drawdownSeries in
 * lib/metrics/aggregate.ts): injected cash is not performance.
 */
import { Decimal } from "decimal.js";
import type { EquityPoint } from "@/lib/metrics/types";

export type DrawdownMode = "STATIC" | "TRAILING";

export interface PropRules {
  /** Percent of starting balance, e.g. 5 for 5%. null = rule not used. */
  dailyLossLimitPct: number | null;
  maxDrawdownPct: number | null;
  drawdownMode: DrawdownMode;
  profitTargetPct: number | null;
  minTradingDays: number | null;
}

export interface PropInput {
  startingBalance: Decimal.Value;
  /** The account's full equity curve, oldest first (all time, not a range). */
  curve: EquityPoint[];
  /** Realised net P&L of trades closed today (user's timezone). */
  todayPnl: Decimal.Value;
  /** Distinct days, in the user's timezone, with at least one closed trade. */
  tradingDays: number;
  rules: PropRules;
}

export interface PropRuleStatus {
  /** 0..1 of the way to the target, or of the allowance used. */
  progress: number;
  /** The threshold in account currency (a balance, or a loss amount). */
  threshold: Decimal;
  /** Room left before the rule breaks (≥ 0), or to the target. */
  remaining: Decimal;
  met: boolean;
  breached: boolean;
}

export interface PropStatus {
  balance: Decimal;
  dailyLoss: PropRuleStatus | null;
  maxDrawdown: (PropRuleStatus & { floor: Decimal; mode: DrawdownMode }) | null;
  profitTarget: PropRuleStatus | null;
  minTradingDays: { required: number; done: number; met: boolean } | null;
  /** FAILED once any hard rule broke; PASSED when every set target is met
   * and nothing broke; otherwise IN_PROGRESS. */
  verdict: "IN_PROGRESS" | "PASSED" | "FAILED";
}

export function hasPropRules(r: PropRules): boolean {
  return (
    r.dailyLossLimitPct !== null || r.maxDrawdownPct !== null || r.profitTargetPct !== null || r.minTradingDays !== null
  );
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const pct = (v: number) => new Decimal(v).div(100);

export function computePropStatus(input: PropInput): PropStatus {
  const start = new Decimal(input.startingBalance);
  const { rules } = input;
  const balance = input.curve.length ? input.curve[input.curve.length - 1].balance : start;

  let dailyLoss: PropStatus["dailyLoss"] = null;
  if (rules.dailyLossLimitPct !== null) {
    const allowance = start.times(pct(rules.dailyLossLimitPct));
    const loss = Decimal.max(0, new Decimal(input.todayPnl).negated());
    dailyLoss = {
      threshold: allowance,
      progress: allowance.isZero() ? 0 : clamp01(loss.div(allowance).toNumber()),
      remaining: Decimal.max(0, allowance.minus(loss)),
      met: false,
      breached: loss.gte(allowance) && !allowance.isZero(),
    };
  }

  let maxDrawdown: PropStatus["maxDrawdown"] = null;
  if (rules.maxDrawdownPct !== null) {
    const keep = new Decimal(1).minus(pct(rules.maxDrawdownPct));
    let peak = start;
    let floor = start.times(keep);
    let breached = false;
    for (const p of input.curve) {
      if (rules.drawdownMode === "TRAILING" && p.kind !== "DEPOSIT" && p.balance.gt(peak)) {
        peak = p.balance;
        floor = peak.times(keep);
      }
      if (p.balance.lt(floor)) breached = true;
    }
    const allowance = (rules.drawdownMode === "TRAILING" ? peak : start).minus(floor);
    const used = Decimal.max(0, (rules.drawdownMode === "TRAILING" ? peak : start).minus(balance));
    maxDrawdown = {
      mode: rules.drawdownMode,
      floor,
      threshold: floor,
      progress: allowance.isZero() ? 0 : clamp01(used.div(allowance).toNumber()),
      remaining: Decimal.max(0, balance.minus(floor)),
      met: false,
      breached,
    };
  }

  let profitTarget: PropStatus["profitTarget"] = null;
  if (rules.profitTargetPct !== null) {
    const target = start.times(new Decimal(1).plus(pct(rules.profitTargetPct)));
    const needed = target.minus(start);
    const gained = balance.minus(start);
    profitTarget = {
      threshold: target,
      progress: needed.isZero() ? 1 : clamp01(gained.div(needed).toNumber()),
      remaining: Decimal.max(0, target.minus(balance)),
      met: balance.gte(target),
      breached: false,
    };
  }

  const minTradingDays =
    rules.minTradingDays !== null
      ? { required: rules.minTradingDays, done: input.tradingDays, met: input.tradingDays >= rules.minTradingDays }
      : null;

  const failed = !!(dailyLoss?.breached || maxDrawdown?.breached);
  const targets = [profitTarget?.met, minTradingDays?.met].filter((v) => v !== undefined);
  const passed = !failed && targets.length > 0 && targets.every(Boolean);

  return {
    balance,
    dailyLoss,
    maxDrawdown,
    profitTarget,
    minTradingDays,
    verdict: failed ? "FAILED" : passed ? "PASSED" : "IN_PROGRESS",
  };
}
