import { getTranslations } from "next-intl/server";
import { DataTable, Panel, PanelBody, PanelHeader, Td, Th } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatMoney, formatPercent, formatR } from "@/lib/metrics/formatters";
import type { PeriodsData, SerializedSummary } from "@/lib/queries/analytics";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

function toneClass(n: number | null | undefined) {
  if (n === null || n === undefined || Math.abs(n) < 0.005) return "text-ink-3";
  return n > 0 ? "val-pos" : "val-neg";
}

/**
 * Month-by-month P&L, all time, by close date in the user's timezone. A grid
 * rather than a chart: the question is "which months", and a table answers
 * it with the numbers in reach.
 */
export async function MonthGrid({ years, currency }: { years: PeriodsData["years"]; currency: string }) {
  const t = await getTranslations("analytics.periods");
  const tMonth = await getTranslations("enums.monthShort");
  if (years.length === 0) {
    return <p className="p-3 text-xs text-ink-3">{t("noClosedTrades")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <DataTable>
        <thead>
          <tr>
            <Th>{t("year")}</Th>
            {MONTHS.map((m) => (
              <Th key={m} numeric>
                {tMonth(m)}
              </Th>
            ))}
            <Th numeric>{t("total")}</Th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year}>
              <Td className="mono text-xs font-medium">{y.year}</Td>
              {y.months.map((cell, i) => (
                <Td
                  key={i}
                  numeric
                  className={cn("mono text-xs", toneClass(cell?.netPnl))}
                  title={
                    cell
                      ? t("cellTitle", {
                          label: cell.label,
                          count: cell.count,
                          winRate: cell.winRate === null ? "—" : formatPercent(cell.winRate),
                        })
                      : undefined
                  }
                >
                  {cell ? formatMoney(cell.netPnl, currency) : "·"}
                </Td>
              ))}
              <Td numeric className={cn("mono text-xs font-medium", toneClass(y.total.netPnl))}>
                {formatMoney(y.total.netPnl, currency)}
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

type Metric = {
  label: string;
  pick: (s: SerializedSummary) => number | null;
  format: (n: number | null) => string;
  /** Whether a higher number is better (for the delta's colour). */
  higherIsBetter: boolean;
};

/**
 * The selected range against the window of equal length right before it.
 * "Better/worse" colouring only where the direction is unambiguous.
 */
export async function PeriodComparison({
  comparison,
  currency,
}: {
  comparison: PeriodsData["comparison"];
  currency: string;
}) {
  const t = await getTranslations("analytics.periods");
  const money = (n: number | null) => (n === null ? "—" : formatMoney(n, currency));
  const metrics: Metric[] = [
    { label: t("netPnl"), pick: (s) => s.netPnl, format: money, higherIsBetter: true },
    {
      label: t("trades"),
      pick: (s) => s.tradeCount,
      format: (n) => (n === null ? "—" : String(n)),
      higherIsBetter: true,
    },
    {
      label: t("winRate"),
      pick: (s) => s.winRate,
      format: (n) => (n === null ? "—" : formatPercent(n)),
      higherIsBetter: true,
    },
    {
      label: t("profitFactor"),
      pick: (s) => s.profitFactor,
      format: (n) => (n === null ? "—" : n.toFixed(2)),
      higherIsBetter: true,
    },
    {
      label: t("expectancy"),
      pick: (s) => s.expectancyR,
      format: (n) => (n === null ? "—" : formatR(n)),
      higherIsBetter: true,
    },
    { label: t("averageLoss"), pick: (s) => s.averageLoss, format: money, higherIsBetter: false },
  ];
  const { current, previous } = comparison;

  if (!previous) {
    return <p className="p-3 text-xs text-ink-3">{t("noPrevious")}</p>;
  }

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>{t("metric")}</Th>
          <Th numeric>{t("thisRange")}</Th>
          <Th numeric>{t("previous")}</Th>
          <Th numeric>{t("change")}</Th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((m) => {
          const a = m.pick(current);
          const b = m.pick(previous);
          const delta = a !== null && b !== null ? a - b : null;
          const better = delta === null || Math.abs(delta) < 1e-9 ? null : delta > 0 === m.higherIsBetter;
          return (
            <tr key={m.label}>
              <Td className="text-xs">{m.label}</Td>
              <Td numeric className="mono text-xs">
                {m.format(a)}
              </Td>
              <Td numeric className="mono text-xs text-ink-2">
                {m.format(b)}
              </Td>
              <Td
                numeric
                className={cn("mono text-xs", better === null ? "text-ink-3" : better ? "val-pos" : "val-neg")}
              >
                {delta === null
                  ? "—"
                  : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${m.format(Math.abs(delta)).replace(/^[-−]/, "")}`}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}

/** MAE/MFE over the range: how much heat winners take, how much of the move is kept. */
export async function ExcursionSummary({ excursion }: { excursion: PeriodsData["excursion"] }) {
  const t = await getTranslations("analytics.periods");
  if (excursion.sample === 0) {
    return (
      <PanelBody>
        <p className="text-xs text-ink-3">{t("excursionEmpty")}</p>
      </PanelBody>
    );
  }
  const r = (n: number | null) => (n === null ? "—" : formatR(n));
  const rows: [string, string, string][] = [
    [t("winnersAvgMae"), r(excursion.winnersAvgMaeR), t("winnersAvgMaeHint")],
    [t("winnersWorstMae"), r(excursion.winnersWorstMaeR), ""],
    [t("avgMfe"), r(excursion.avgMfeR), t("avgMfeHint")],
    [t("avgRealised"), r(excursion.avgRealisedR), t("avgRealisedHint")],
    [
      t("winnersCapture"),
      excursion.winnersCapture === null ? "—" : formatPercent(excursion.winnersCapture),
      t("winnersCaptureHint"),
    ],
  ];
  return (
    <PanelBody className="flex flex-col gap-2">
      {rows.map(([label, value, hint]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-ink-2">
            {label}
            {hint ? <span className="block text-2xs text-ink-3">{hint}</span> : null}
          </span>
          <span className="mono text-ink">{value}</span>
        </div>
      ))}
      <p className="text-2xs text-ink-3">{t("sample", { count: excursion.sample })}</p>
    </PanelBody>
  );
}

export async function PeriodsView({ data, currency }: { data: PeriodsData; currency: string }) {
  const t = await getTranslations("analytics.periods");
  return (
    <div className="flex flex-col gap-4">
      <Panel flush>
        <PanelHeader title={t("byMonth")} caption={t("byMonthCaption")} />
        <MonthGrid years={data.years} currency={currency} />
      </Panel>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel flush>
          <PanelHeader title={t("againstPrevious")} caption={t("againstPreviousCaption")} />
          <PeriodComparison comparison={data.comparison} currency={currency} />
        </Panel>
        <Panel>
          <PanelHeader title={t("exitEfficiency")} caption={t("exitEfficiencyCaption")} />
          <ExcursionSummary excursion={data.excursion} />
        </Panel>
      </div>
    </div>
  );
}
