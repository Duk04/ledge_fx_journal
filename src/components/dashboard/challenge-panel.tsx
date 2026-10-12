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
  const verdict = {
    IN_PROGRESS: { label: "In progress", tone: "neutral" as const },
    PASSED: { label: "Passed", tone: "profit" as const },
    FAILED: { label: "Breached", tone: "loss" as const },
  }[prop.verdict];

  return (
    <Panel>
      <PanelHeader title="Challenge" actions={<Badge tone={verdict.tone}>{verdict.label}</Badge>} />
      <PanelBody className="flex flex-col gap-3">
        {prop.profitTarget ? (
          <Meter
            label="Profit target"
            value={prop.profitTarget.progress}
            tone={prop.profitTarget.met ? "profit" : "brand"}
            detail={
              prop.profitTarget.met
                ? `Reached ${formatMoney(prop.profitTarget.threshold, currency)}`
                : `${formatMoney(prop.profitTarget.remaining, currency)} to ${formatMoney(prop.profitTarget.threshold, currency)}`
            }
          />
        ) : null}
        {prop.maxDrawdown ? (
          <Meter
            label={`Max drawdown · ${prop.maxDrawdown.mode === "TRAILING" ? "trailing" : "static"}`}
            value={prop.maxDrawdown.progress}
            tone={prop.maxDrawdown.breached ? "loss" : prop.maxDrawdown.progress > 0.75 ? "warn" : "neutral"}
            detail={
              prop.maxDrawdown.breached
                ? `Closed below the ${formatMoney(prop.maxDrawdown.floor, currency)} floor`
                : `${formatMoney(prop.maxDrawdown.remaining, currency)} above the ${formatMoney(prop.maxDrawdown.floor, currency)} floor`
            }
          />
        ) : null}
        {prop.dailyLoss ? (
          <Meter
            label="Today's loss allowance"
            value={prop.dailyLoss.progress}
            tone={prop.dailyLoss.breached ? "loss" : prop.dailyLoss.progress > 0.75 ? "warn" : "neutral"}
            detail={
              prop.dailyLoss.breached
                ? `Used up (${formatMoney(prop.dailyLoss.threshold, currency)})`
                : `${formatMoney(prop.dailyLoss.remaining, currency)} of ${formatMoney(prop.dailyLoss.threshold, currency)} left · closed trades only`
            }
          />
        ) : null}
        {prop.minTradingDays ? (
          <Meter
            label="Trading days"
            value={prop.minTradingDays.required ? prop.minTradingDays.done / prop.minTradingDays.required : 1}
            tone={prop.minTradingDays.met ? "profit" : "brand"}
            detail={`${prop.minTradingDays.done} of ${prop.minTradingDays.required}`}
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
