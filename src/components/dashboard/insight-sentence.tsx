import { Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/metrics/formatters";
import type { Breakdowns, BreakdownRow } from "@/lib/queries/analytics";

/**
 * The one generated sentence at the top of the Breakdowns tab — deliberately
 * the single most load-bearing bit of copy on the page, so it earns real
 * logic instead of a template.
 *
 * MINIMUM SAMPLE SIZE: a group with fewer than 10 trades is excluded from
 * consideration entirely, not just flagged — three trades that happened to
 * go well is noise, not a strategy. If fewer than two groups (across every
 * dimension shown on this tab) clear that bar, the sentence says so plainly
 * instead of naming a "strongest" and "weakest" that aren't statistically
 * real yet.
 *
 * Every group across every dimension (symbol/tag/session/direction/plan) is
 * pooled together before picking a winner and a loser — "strongest area of
 * the account", not "strongest symbol specifically" — which is also why the
 * three polarity branches exist below: a portfolio that's net positive
 * everywhere shouldn't be described as if something is "carrying" it
 * against a loser that doesn't actually exist.
 */
const MIN_SAMPLE = 10;

type InsightT = ReturnType<typeof useTranslations<"dashboard.insight">>;

export function buildInsight(breakdowns: Breakdowns, currency: string, t: InsightT): string {
  const pool: BreakdownRow[] = [
    ...breakdowns.symbol,
    ...breakdowns.tag,
    ...breakdowns.marketSession,
    ...breakdowns.direction,
    ...breakdowns.followedPlan,
  ];
  const eligible = pool.filter((r) => r.count >= MIN_SAMPLE);

  if (eligible.length < 2) {
    return t("notEnough", { min: MIN_SAMPLE });
  }

  const sorted = [...eligible].sort((a, b) => b.netPnl - a.netPnl);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const fmt = (n: number) => formatMoney(n, currency);
  const values = {
    min: MIN_SAMPLE,
    best: best.label,
    bestPnl: fmt(best.netPnl),
    bestCount: best.count,
    worst: worst.label,
    worstPnl: fmt(worst.netPnl),
    worstCount: worst.count,
  };

  if (worst.netPnl >= 0) {
    return t("allPositive", values);
  }
  if (best.netPnl <= 0) {
    return t("allNegative", values);
  }
  return t("mixed", values);
}

export function InsightSentence({ breakdowns, currency }: { breakdowns: Breakdowns; currency: string }) {
  const t = useTranslations("dashboard.insight");
  const text = buildInsight(breakdowns, currency, t);
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-panel)] border border-line bg-panel-sunken px-3 py-2.5 text-sm text-ink">
      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
      <p>{text}</p>
    </div>
  );
}
