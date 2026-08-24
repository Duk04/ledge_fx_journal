import { Money } from "@/components/ui";

/** Today / this week / this month P&L — fixed calendar windows in the
 * user's own timezone, independent of the range picker (see analytics.ts). */
export function PnlRows({
  currency,
  todayPnl,
  weekPnl,
  monthPnl,
}: {
  currency: string;
  todayPnl: number;
  weekPnl: number;
  monthPnl: number;
}) {
  const rows: { label: string; value: number }[] = [
    { label: "Today", value: todayPnl },
    { label: "This week", value: weekPnl },
    { label: "This month", value: monthPnl },
  ];
  return (
    <div className="flex flex-col divide-y divide-line-faint">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between px-3 py-2">
          <span className="text-xs text-ink-2">{r.label}</span>
          <Money value={r.value} currency={currency} signed className="text-sm font-medium" />
        </div>
      ))}
    </div>
  );
}
