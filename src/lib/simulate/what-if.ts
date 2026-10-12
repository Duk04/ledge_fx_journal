/**
 * What-if: re-run your own closed trades under a rule you didn't follow, and
 * see what the record would have been. Pure, browser-side, on plain numbers
 * (like lib/backtest): it is an exploration tool, recomputed on every toggle,
 * and its output is never stored as a journal number.
 *
 * Every scenario changes only what it says it changes:
 *  - capLossR: a loss worse than −cap R is replaced by exactly −cap R
 *    (in money: −cap × that trade's risk). "If I had respected my stop."
 *    Trades without a stop (no risk amount) are left as they were.
 *  - skip*: drops matching trades entirely (weekdays, sessions, symbols,
 *    tags, trades where you didn't follow the plan).
 *  - fixedRiskPct: re-sizes every trade to risk that percent of the running
 *    balance, so money = R × balance × pct. Needs R, so trades without a stop
 *    are dropped from that scenario — said in the result.
 *
 * Order: skips first, then the loss cap, then re-sizing.
 */

export interface SimTrade {
  id: string;
  closedAt: number;
  netPnl: number;
  /** null when the trade had no stop. */
  rMultiple: number | null;
  riskAmount: number | null;
  weekday: string;
  session: string | null;
  symbol: string;
  followedPlan: boolean | null;
  tagIds: string[];
}

export interface WhatIfRules {
  capLossR: number | null;
  skipWeekdays: string[];
  skipSessions: string[];
  skipSymbols: string[];
  skipTagIds: string[];
  onlyFollowedPlan: boolean;
  fixedRiskPct: number | null;
}

export const NO_RULES: WhatIfRules = {
  capLossR: null,
  skipWeekdays: [],
  skipSessions: [],
  skipSymbols: [],
  skipTagIds: [],
  onlyFollowedPlan: false,
  fixedRiskPct: null,
};

export interface SimStats {
  trades: number;
  netPnl: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  maxDrawdown: number;
  /** Balance after each trade, starting balance first. */
  curve: number[];
}

export interface WhatIfResult {
  baseline: SimStats;
  scenario: SimStats;
  /** Trades the scenario removed (skips, or no-stop under fixed risk). */
  removed: number;
  /** Losses the cap shortened. */
  capped: number;
}

function stats(pnls: number[], rs: (number | null)[], startingBalance: number): SimStats {
  const wins = pnls.filter((p) => p > 0.005);
  const losses = pnls.filter((p) => p < -0.005);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const withR = rs.filter((r): r is number => r !== null);
  const curve = [startingBalance];
  let peak = startingBalance;
  let maxDd = 0;
  for (const p of pnls) {
    const next = curve[curve.length - 1] + p;
    curve.push(next);
    peak = Math.max(peak, next);
    maxDd = Math.max(maxDd, peak - next);
  }
  return {
    trades: pnls.length,
    netPnl: pnls.reduce((a, b) => a + b, 0),
    winRate: wins.length + losses.length ? wins.length / (wins.length + losses.length) : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancyR: withR.length ? withR.reduce((a, b) => a + b, 0) / withR.length : null,
    maxDrawdown: maxDd,
    curve,
  };
}

export function runWhatIf(trades: readonly SimTrade[], rules: WhatIfRules, startingBalance: number): WhatIfResult {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const baseline = stats(
    sorted.map((t) => t.netPnl),
    sorted.map((t) => t.rMultiple),
    startingBalance,
  );

  const skip = (t: SimTrade) =>
    rules.skipWeekdays.includes(t.weekday) ||
    (t.session !== null && rules.skipSessions.includes(t.session)) ||
    rules.skipSymbols.includes(t.symbol) ||
    t.tagIds.some((id) => rules.skipTagIds.includes(id)) ||
    (rules.onlyFollowedPlan && t.followedPlan === false) ||
    (rules.fixedRiskPct !== null && t.rMultiple === null);

  const kept = sorted.filter((t) => !skip(t));
  let capped = 0;
  const adjusted = kept.map((t) => {
    if (rules.capLossR !== null && t.rMultiple !== null && t.riskAmount && t.rMultiple < -rules.capLossR) {
      capped++;
      return { ...t, rMultiple: -rules.capLossR, netPnl: -rules.capLossR * t.riskAmount };
    }
    return t;
  });

  let pnls: number[];
  if (rules.fixedRiskPct !== null) {
    let balance = startingBalance;
    pnls = adjusted.map((t) => {
      const pnl = t.rMultiple! * balance * (rules.fixedRiskPct! / 100);
      balance += pnl;
      return pnl;
    });
  } else {
    pnls = adjusted.map((t) => t.netPnl);
  }

  return {
    baseline,
    scenario: stats(
      pnls,
      adjusted.map((t) => t.rMultiple),
      startingBalance,
    ),
    removed: sorted.length - kept.length,
    capped,
  };
}
