import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { DataTable, Th, Td, TableEmpty, Money, Percent, RValue } from "@/components/ui";
import { BarCell } from "@/components/charts/bar-cell";
import type { BreakdownRow } from "@/lib/queries/analytics";

/**
 * One table per breakdown dimension (symbol / setup tag / session /
 * direction / plan-followed). Rows arrive pre-sorted by net P&L descending
 * (see analytics.ts), so the LAST row is always the weakest performer in
 * this dimension — its row header gets a loss tint so the problem area is
 * findable in a glance instead of requiring the reader to scan every row.
 */
export function BreakdownTable({
  rows,
  currency,
  keyLabel,
  labelNs,
}: {
  rows: BreakdownRow[];
  currency: string;
  /** Column header for the dimension's own key, e.g. "Symbol", "Session". */
  keyLabel: string;
  /** For enum-keyed dimensions: the row label is translated from `r.key`.
   * The query's English `r.label` stays the fallback for a key with no
   * message (an unknown session spelling). */
  labelNs?: "session" | "weekday" | "plan" | "direction";
}) {
  const t = useTranslations("dashboard.table");
  const tl = useTranslations("analytics.labels");
  const rowLabel = (r: BreakdownRow) => {
    const key = labelNs ? (`${labelNs}.${r.key}` as Parameters<typeof tl>[0]) : null;
    return key && tl.has(key) ? tl(key) : r.label;
  };
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.netPnl)));
  const weakestKey = rows.length > 1 ? rows[rows.length - 1].key : null;

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>{keyLabel}</Th>
          <Th numeric>{t("count")}</Th>
          <Th numeric>{t("netPnl")}</Th>
          <Th numeric>{t("winRate")}</Th>
          <Th numeric>{t("pf")}</Th>
          <Th numeric>{t("expR")}</Th>
          <Th numeric>{t("avgR")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={7}>{t("emptyRange")}</TableEmpty>
        ) : (
          rows.map((r) => (
            <tr key={r.key}>
              <Td className={cn(r.key === weakestKey && "bg-loss-weak")}>
                <span className="truncate">{rowLabel(r)}</span>
              </Td>
              <Td numeric>{r.count}</Td>
              <Td numeric>
                <div className="flex items-center justify-end gap-2">
                  <BarCell value={r.netPnl} scale={maxAbs} width={64} />
                  <Money value={r.netPnl} currency={currency} signed />
                </div>
              </Td>
              <Td numeric>
                {r.winRate === null ? <span className="text-ink-3">—</span> : <Percent value={r.winRate} />}
              </Td>
              <Td numeric>
                {r.profitFactor === null ? <span className="text-ink-3">—</span> : r.profitFactor.toFixed(2)}
              </Td>
              <Td numeric>
                {r.expectancyR === null ? <span className="text-ink-3">—</span> : <RValue value={r.expectancyR} />}
              </Td>
              <Td numeric>
                {r.averageR === null ? <span className="text-ink-3">—</span> : <RValue value={r.averageR} />}
              </Td>
            </tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}
