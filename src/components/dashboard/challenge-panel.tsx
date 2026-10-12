import { useTranslations } from "next-intl";
import { Badge, Panel, PanelBody, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/metrics/formatters";
import type { PropDTO } from "@/lib/queries/analytics";

/**
 * The prop-firm challenge at a glance: target, drawdown room, today's loss
 * allowance and trading days, with a verdict. Only rendered for an account
 * with challenge rules (src/lib/prop.ts). All-time, never range-scoped — a
 * challenge is one continuous evaluation, not a window.
 */
export function ChallengePanel({ prop, currency }: { prop: PropDTO; currency: string }) {
  const t = useTranslations("dashboard.challenge");
  const verdict = {
    IN_PROGRESS: { label: t("inProgress"), tone: "neutral" as const },
    PASSED: { label: t("passed"), tone: "profit" as const },
    FAILED: { label: t("breached"), tone: "loss" as const },
  }[prop.verdict];

  return (
    <Panel>
      <PanelHeader title={t("title")} actions={<Badge tone={verdict.tone}>{verdict.label}</Badge>} />
      <PanelBody className="flex flex-col gap-3">
        {prop.profitTarget ? (
          <Meter
            label={t("profitTarget")}
            value={prop.profitTarget.progress}
            tone={prop.profitTarget.met ? "profit" : "brand"}
            detail={
              prop.profitTarget.met
                ? t("reached", { amount: formatMoney(prop.profitTarget.threshold, currency) })
                : t("toTarget", {
                    remaining: formatMoney(prop.profitTarget.remaining, currency),
                    threshold: formatMoney(prop.profitTarget.threshold, currency),
                  })
            }
          />
        ) : null}
        {prop.maxDrawdown ? (
          <Meter
            label={t("maxDrawdown", { mode: prop.maxDrawdown.mode })}
            value={prop.maxDrawdown.progress}
            tone={prop.maxDrawdown.breached ? "loss" : prop.maxDrawdown.progress > 0.75 ? "warn" : "neutral"}
            detail={
              prop.maxDrawdown.breached
                ? t("belowFloor", { floor: formatMoney(prop.maxDrawdown.floor, currency) })
                : t("aboveFloor", {
                    remaining: formatMoney(prop.maxDrawdown.remaining, currency),
                    floor: formatMoney(prop.maxDrawdown.floor, currency),
                  })
            }
          />
        ) : null}
        {prop.dailyLoss ? (
          <Meter
            label={t("dailyLoss")}
            value={prop.dailyLoss.progress}
            tone={prop.dailyLoss.breached ? "loss" : prop.dailyLoss.progress > 0.75 ? "warn" : "neutral"}
            detail={
              prop.dailyLoss.breached
                ? t("usedUp", { amount: formatMoney(prop.dailyLoss.threshold, currency) })
                : t("dailyLeft", {
                    remaining: formatMoney(prop.dailyLoss.remaining, currency),
                    threshold: formatMoney(prop.dailyLoss.threshold, currency),
                  })
            }
          />
        ) : null}
        {prop.minTradingDays ? (
          <Meter
            label={t("tradingDays")}
            value={prop.minTradingDays.required ? prop.minTradingDays.done / prop.minTradingDays.required : 1}
            tone={prop.minTradingDays.met ? "profit" : "brand"}
            detail={t("daysProgress", { done: prop.minTradingDays.done, required: prop.minTradingDays.required })}
          />
        ) : null}
      </PanelBody>
    </Panel>
  );
}

const FILL = {
  brand: "bg-brand",
  profit: "bg-profit",
  loss: "bg-loss",
  warn: "bg-warn",
  neutral: "bg-ink-3",
} as const;

function Meter({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: keyof typeof FILL;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="mono text-ink-3">{pct}%</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={detail}
        className="h-1.5 overflow-hidden rounded-full bg-inset"
      >
        <div className={cn("h-full rounded-full", FILL[tone])} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-2xs text-ink-3">{detail}</span>
    </div>
  );
}
