"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  DataTable,
  Field,
  FieldHint,
  FieldLabel,
  NumberInput,
  Panel,
  PanelBody,
  PanelHeader,
  Segmented,
  SegmentedItem,
  Switch,
  Td,
  Th,
} from "@/components/ui";
import { CurveCompareChart } from "@/components/charts/curve-compare-chart";
import { cn } from "@/lib/cn";
import { formatMoney, formatPercent, formatR } from "@/lib/metrics/formatters";
import { NO_RULES, runWhatIf, type SimStats, type WhatIfRules } from "@/lib/simulate/what-if";
import { runMonteCarlo } from "@/lib/simulate/monte-carlo";
import type { SimulationInputs } from "@/lib/queries/analytics";

const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;

// inputs.sessions is typed as plain strings, so a value with no message falls
// back to its raw code rather than making the translator throw.
const KNOWN_SESSIONS = ["SYDNEY", "TOKYO", "LONDON", "NEW_YORK", "OVERLAP", "OFFHOURS"] as const;
type KnownSession = (typeof KNOWN_SESSIONS)[number];
const isKnownSession = (s: string): s is KnownSession => (KNOWN_SESSIONS as readonly string[]).includes(s);

/** A pressed/unpressed filter chip. aria-pressed carries the state, not
 * colour alone. */
function Chip({ pressed, onToggle, children }: { pressed: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "h-7 rounded-control border px-2.5 text-xs transition-colors duration-[var(--dur-fast)]",
        pressed ? "border-brand-line bg-brand-weak text-brand" : "border-line text-ink-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function SimulatorView({ inputs }: { inputs: SimulationInputs }) {
  const t = useTranslations("simulate");
  const tSession = useTranslations("enums.session");
  const { currency, startingBalance, trades } = inputs;
  const [rules, setRules] = React.useState<WhatIfRules>(NO_RULES);
  const result = React.useMemo(() => runWhatIf(trades, rules, startingBalance), [trades, rules, startingBalance]);
  const set = (patch: Partial<WhatIfRules>) => setRules((r) => ({ ...r, ...patch }));

  const rs = React.useMemo(() => trades.map((t) => t.rMultiple).filter((r): r is number => r !== null), [trades]);
  const [mcRisk, setMcRisk] = React.useState("1");
  const [mcTrades, setMcTrades] = React.useState(String(Math.max(50, Math.min(500, trades.length || 100))));
  const [mcRuin, setMcRuin] = React.useState("20");
  const mc = React.useMemo(
    () =>
      runMonteCarlo({
        rMultiples: rs,
        startingBalance: inputs.currentBalance,
        riskPct: Number(mcRisk) || 0,
        tradesPerRun: Math.min(2000, Math.max(1, Math.floor(Number(mcTrades) || 0))),
        runs: 1000,
        ruinDrawdownPct: Number(mcRuin) || 100,
      }),
    [rs, inputs.currentBalance, mcRisk, mcTrades, mcRuin],
  );

  if (trades.length === 0) {
    return (
      <Panel>
        <PanelBody>
          <p className="text-sm text-ink-2">{t("empty")}</p>
        </PanelBody>
      </Panel>
    );
  }

  const mistakeTags = inputs.tags.filter((t) => t.kind === "MISTAKE");
  const otherTags = inputs.tags.filter((t) => t.kind !== "MISTAKE");

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title={t("whatIf.title")} caption={t("whatIf.caption", { count: String(trades.length) })} />
        <PanelBody className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>{t("whatIf.capLoss")}</FieldLabel>
              <Segmented
                value={rules.capLossR === null ? "off" : String(rules.capLossR)}
                onValueChange={(v) => v && set({ capLossR: v === "off" ? null : Number(v) })}
              >
                <SegmentedItem value="off">{t("whatIf.off")}</SegmentedItem>
                <SegmentedItem value="1">−1R</SegmentedItem>
                <SegmentedItem value="1.5">−1.5R</SegmentedItem>
                <SegmentedItem value="2">−2R</SegmentedItem>
              </Segmented>
              <FieldHint>{t("whatIf.capLossHint")}</FieldHint>
            </Field>
            <Field>
              <FieldLabel>{t("whatIf.sizeAt")}</FieldLabel>
              <Segmented
                value={rules.fixedRiskPct === null ? "off" : String(rules.fixedRiskPct)}
                onValueChange={(v) => v && set({ fixedRiskPct: v === "off" ? null : Number(v) })}
              >
                <SegmentedItem value="off">{t("whatIf.asTaken")}</SegmentedItem>
                <SegmentedItem value="0.5">0.5%</SegmentedItem>
                <SegmentedItem value="1">1%</SegmentedItem>
                <SegmentedItem value="2">2%</SegmentedItem>
              </Segmented>
              <FieldHint>{t("whatIf.sizeHint")}</FieldHint>
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-ink-2">{t("whatIf.leaveOut")}</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((key) => (
                <Chip
                  key={key}
                  pressed={rules.skipWeekdays.includes(key)}
                  onToggle={() => set({ skipWeekdays: toggle(rules.skipWeekdays, key) })}
                >
                  {t(`weekdays.${key}`)}
                </Chip>
              ))}
              {inputs.sessions.map((s) => (
                <Chip
                  key={s}
                  pressed={rules.skipSessions.includes(s)}
                  onToggle={() => set({ skipSessions: toggle(rules.skipSessions, s) })}
                >
                  {isKnownSession(s) ? tSession(s) : s}
                </Chip>
              ))}
              {[...mistakeTags, ...otherTags].map((t) => (
                <Chip
                  key={t.id}
                  pressed={rules.skipTagIds.includes(t.id)}
                  onToggle={() => set({ skipTagIds: toggle(rules.skipTagIds, t.id) })}
                >
                  #{t.name}
                </Chip>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <Switch checked={rules.onlyFollowedPlan} onCheckedChange={(v) => set({ onlyFollowedPlan: v })} />
              {t("whatIf.onlyFollowedPlan")}
            </label>
          </div>
        </PanelBody>

        <div className="grid border-t border-line lg:grid-cols-5">
          <div className="lg:col-span-2">
            <ComparisonTable baseline={result.baseline} scenario={result.scenario} currency={currency} />
            <p className="px-3 py-2 text-2xs text-ink-3">
              {result.removed ? t("whatIf.removed", { count: String(result.removed) }) : ""}
              {result.capped ? t("whatIf.capped", { count: String(result.capped) }) : ""}
            </p>
          </div>
          <div className="p-3 lg:col-span-3">
            <CurveCompareChart
              currency={currency}
              startBalance={startingBalance}
              series={[
                { name: t("whatIf.asTraded"), values: result.baseline.curve, muted: true },
                { name: t("whatIf.whatIf"), values: result.scenario.curve },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title={t("monteCarlo.title")}
          caption={t("monteCarlo.caption", { balance: formatMoney(inputs.currentBalance, currency) })}
        />
        <PanelBody className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel>{t("monteCarlo.riskPerTrade")}</FieldLabel>
              <NumberInput value={mcRisk} onChange={(e) => setMcRisk(e.target.value)} unit="%" />
            </Field>
            <Field>
              <FieldLabel>{t("monteCarlo.tradesPerRun")}</FieldLabel>
              <NumberInput
                value={mcTrades}
                onChange={(e) => setMcTrades(e.target.value)}
                unit={t("monteCarlo.tradesUnit")}
              />
            </Field>
            <Field>
              <FieldLabel>{t("monteCarlo.ruinThreshold")}</FieldLabel>
              <NumberInput value={mcRuin} onChange={(e) => setMcRuin(e.target.value)} unit="%" />
            </Field>
          </div>
          {mc ? (
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="flex flex-col gap-2 lg:col-span-2">
                <Row label={t("monteCarlo.median")} value={formatMoney(mc.final.p50, currency)} />
                <Row label={t("monteCarlo.badRun")} value={formatMoney(mc.final.p5, currency)} />
                <Row label={t("monteCarlo.goodRun")} value={formatMoney(mc.final.p95, currency)} />
                <Row label={t("monteCarlo.typicalDrawdown")} value={`${mc.maxDrawdownPct.p50.toFixed(1)}%`} />
                <Row label={t("monteCarlo.worstDrawdown")} value={`${mc.maxDrawdownPct.p95.toFixed(1)}%`} />
                <Row
                  label={t("monteCarlo.ruinChance", { pct: mcRuin })}
                  value={formatPercent(mc.ruinProbability)}
                  tone={mc.ruinProbability > 0.1 ? "loss" : undefined}
                />
                <Row label={t("monteCarlo.lossChance")} value={formatPercent(mc.lossProbability)} />
                <p className="text-2xs text-ink-3">{t("monteCarlo.assumption", { count: String(rs.length) })}</p>
              </div>
              <div className="lg:col-span-3">
                <CurveCompareChart
                  currency={currency}
                  startBalance={inputs.currentBalance}
                  series={mc.samplePaths.map((values, i) => ({
                    name: t("monteCarlo.run", { n: String(i + 1) }),
                    values,
                    muted: i > 0,
                  }))}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-3">{t("monteCarlo.needsTrades")}</p>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "loss" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-ink-2">{label}</span>
      <span className={cn("mono", tone === "loss" ? "val-neg" : "text-ink")}>{value}</span>
    </div>
  );
}

function ComparisonTable({
  baseline,
  scenario,
  currency,
}: {
  baseline: SimStats;
  scenario: SimStats;
  currency: string;
}) {
  const t = useTranslations("simulate.table");
  const money = (n: number) => formatMoney(n, currency);
  const pct = (n: number | null) => (n === null ? "—" : formatPercent(n));
  const fixed = (n: number | null) => (n === null ? "—" : n.toFixed(2));
  const r = (n: number | null) => (n === null ? "—" : formatR(n));
  const rows: [string, string, string][] = [
    [t("trades"), String(baseline.trades), String(scenario.trades)],
    [t("netPnl"), money(baseline.netPnl), money(scenario.netPnl)],
    [t("winRate"), pct(baseline.winRate), pct(scenario.winRate)],
    [t("profitFactor"), fixed(baseline.profitFactor), fixed(scenario.profitFactor)],
    [t("expectancy"), r(baseline.expectancyR), r(scenario.expectancyR)],
    [t("maxDrawdown"), money(baseline.maxDrawdown), money(scenario.maxDrawdown)],
  ];
  return (
    <DataTable>
      <thead>
        <tr>
          <Th aria-label={t("metric")} />
          <Th numeric>{t("asTraded")}</Th>
          <Th numeric>{t("whatIf")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b]) => (
          <tr key={label}>
            <Td className="text-xs">{label}</Td>
            <Td numeric className="mono text-xs text-ink-2">
              {a}
            </Td>
            <Td numeric className="mono text-xs">
              {b}
            </Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
