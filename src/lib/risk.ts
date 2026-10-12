/**
 * Risk guard — pure functions, no I/O. `src/components/dashboard/risk-guard.tsx`
 * is the only caller in this app; it fetches today's trades and the
 * account's settings, then hands them here.
 *
 * INPUT CONTRACT: `trades` is every trade OPENED today (any status — an
 * open position counts for NO_STOP, since "no stop and it's still running"
 * is the more urgent case, not the less), in chronological order
 * (`openedAt` ascending). A trade counts as "closed today" for the P&L and
 * streak checks when its `netPnl` is non-null — that mirrors how the rest of
 * the app treats `netPnl`: null while OPEN, set the moment a trade closes.
 *
 * DENOMINATOR: every percentage here is against `equity` (current account
 * equity), not `startingBalance`. `startingBalance` is still taken as a
 * parameter — the daily-loss fallback threshold, and any future "vs.
 * starting capital" check, want it — but sizing and today's P&L should be
 * judged against what the account is actually worth right now, since that's
 * the number a live risk-of-ruin conversation is really about.
 */

export type RiskBreachType = "DAILY_LOSS_LIMIT" | "LOSS_STREAK" | "OVERSIZED" | "NO_STOP";

export interface RiskBreach {
  type: RiskBreachType;
  /** English, for logs and tests. The UI renders `key` + `values` from
   * `dashboard.risk.*` instead, so the reader gets their own language with
   * the same numbers. */
  message: string;
  key: "dailyLimitUsed" | "dailyHeuristic" | "lossStreak" | "oversized" | "noStopOne" | "noStopMany";
  values: Record<string, string>;
}

export interface RiskTradeInput {
  id: string;
  /** null while the trade is still open (mirrors the DB column). */
  netPnl: number | null;
  /** Dollar amount at risk, implied by the stop loss; null when there is no stop. */
  riskAmount: number | null;
  /** Explicit rather than inferred from `riskAmount === null`, so a trade with a stop distance of exactly zero can't accidentally read as "no stop". */
  hasStop: boolean;
}

export interface RiskGuardInput {
  trades: RiskTradeInput[];
  startingBalance: number;
  /** Percent, e.g. 1 for "1% per trade". null when the account has nothing configured. */
  riskPerTradePct: number | null;
  /**
   * The account's own daily loss limit, percent of STARTING balance (the
   * prop-firm rule — src/lib/prop.ts). When set it replaces the heuristic
   * below, so the guard and the challenge panel never disagree about whether
   * today's limit is gone. Optional: callers that predate it get the default.
   */
  dailyLossLimitPct?: number | null;
  equity: number;
}

export interface RiskGuardResult {
  /** 0-100, always >= 0 (0 on a flat or profitable day). */
  dailyLossPct: number;
  /** >= 0, in account currency. */
  dailyLossAmount: number;
  /** Count of realised (closed) trades among today's trades. */
  tradesToday: number;
  /** Trailing run of realised losses at the end of today, in the order `trades` was given. 0 if the most recent closed trade won or nothing has closed. */
  consecutiveLosses: number;
  breaches: RiskBreach[];
}

const DAILY_LOSS_MULTIPLE = 3;
const DAILY_LOSS_FALLBACK_PCT = 3;
const OVERSIZED_MULTIPLE = 1.5;
const LOSS_STREAK_THRESHOLD = 2;

function numberWord(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return n >= 0 && n < words.length ? words[n] : String(n);
}

export function computeRiskGuard(input: RiskGuardInput): RiskGuardResult {
  const { trades, startingBalance, riskPerTradePct, equity, dailyLossLimitPct = null } = input;
  const realised = trades.filter((t) => t.netPnl !== null) as (RiskTradeInput & { netPnl: number })[];

  const dailyNetPnl = realised.reduce((sum, t) => sum + t.netPnl, 0);
  const dailyLossAmount = dailyNetPnl < 0 ? -dailyNetPnl : 0;
  // A closed account (equity <= 0) can't meaningfully divide into a
  // percentage — treat it as 0 rather than producing Infinity/NaN.
  const dailyLossPct = equity > 0 ? (dailyLossAmount / equity) * 100 : 0;

  let consecutiveLosses = 0;
  for (let i = realised.length - 1; i >= 0; i -= 1) {
    if (realised[i].netPnl < 0) consecutiveLosses += 1;
    else break;
  }

  const breaches: RiskBreach[] = [];

  // DAILY_LOSS_LIMIT — the account's own limit when it has one (an amount:
  // that percent of the starting balance, as prop firms define it).
  // Otherwise a heuristic against current equity: 3x the configured
  // per-trade risk, or a flat 3% when nothing is configured.
  if (dailyLossAmount > 0 && dailyLossLimitPct !== null && startingBalance > 0) {
    const limit = (startingBalance * dailyLossLimitPct) / 100;
    if (dailyLossAmount >= limit) {
      breaches.push({
        type: "DAILY_LOSS_LIMIT",
        message: `Down ${dailyLossAmount.toFixed(2)} today — your ${dailyLossLimitPct}% daily loss limit (${limit.toFixed(2)}) is used up. Stop trading this account today.`,
        key: "dailyLimitUsed",
        values: {
          amount: dailyLossAmount.toFixed(2),
          limitPct: String(dailyLossLimitPct),
          limit: limit.toFixed(2),
        },
      });
    }
  } else if (dailyLossAmount > 0) {
    const thresholdPct = riskPerTradePct !== null ? riskPerTradePct * DAILY_LOSS_MULTIPLE : DAILY_LOSS_FALLBACK_PCT;
    if (dailyLossPct >= thresholdPct) {
      breaches.push({
        type: "DAILY_LOSS_LIMIT",
        message: `Down ${dailyLossPct.toFixed(1)}% today. That's at or beyond your daily loss limit — consider stepping away.`,
        key: "dailyHeuristic",
        values: { pct: dailyLossPct.toFixed(1) },
      });
    }
  }

  // LOSS_STREAK — the CURRENT trailing streak, not the longest one today.
  if (consecutiveLosses >= LOSS_STREAK_THRESHOLD) {
    breaches.push({
      type: "LOSS_STREAK",
      message: `${capitalize(numberWord(consecutiveLosses))} losses in a row today. Your rule says stop at two.`,
      key: "lossStreak",
      values: { word: capitalize(numberWord(consecutiveLosses)), count: String(consecutiveLosses) },
    });
  }

  // OVERSIZED — only meaningful once a per-trade risk is actually
  // configured; with nothing configured there's nothing to be "over".
  if (riskPerTradePct !== null && equity > 0) {
    for (const t of trades) {
      if (!t.hasStop || t.riskAmount === null) continue;
      const riskPct = (t.riskAmount / equity) * 100;
      if (riskPct > riskPerTradePct * OVERSIZED_MULTIPLE) {
        breaches.push({
          type: "OVERSIZED",
          message: `A trade today risked ${riskPct.toFixed(1)}% of equity — more than 1.5x your ${riskPerTradePct}% per-trade rule.`,
          key: "oversized",
          values: { pct: riskPct.toFixed(1), rulePct: String(riskPerTradePct) },
        });
      }
    }
  }

  // NO_STOP — every trade taken today without a stop, open or closed.
  const noStopCount = trades.filter((t) => !t.hasStop).length;
  if (noStopCount > 0) {
    breaches.push({
      type: "NO_STOP",
      message:
        noStopCount === 1
          ? "One trade today has no stop loss recorded."
          : `${noStopCount} trades today have no stop loss recorded.`,
      key: noStopCount === 1 ? "noStopOne" : "noStopMany",
      values: { count: String(noStopCount) },
    });
  }

  return {
    dailyLossPct,
    dailyLossAmount,
    tradesToday: realised.length,
    consecutiveLosses,
    breaches,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
