import { DataTable, Th, Td, TrLink, TableEmpty } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money, RValue, Empty } from "@/components/ui/value";
import { RunRowMenu } from "./run-row-menu";
import type { RunListRow } from "@/lib/queries/backtests";

const STATUS_TONE: Record<RunListRow["status"], "neutral" | "profit" | "loss" | "warn"> = {
  DRAFT: "neutral",
  RUNNING: "warn",
  DONE: "profit",
  FAILED: "loss",
};

function formatRange(fromIso: string, toIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit", year: "2-digit" };
  return `${new Date(fromIso).toLocaleDateString("en-US", opts)} – ${new Date(toIso).toLocaleDateString("en-US", opts)}`;
}

export function RunTable({ rows }: { rows: RunListRow[] }) {
  if (rows.length === 0) return null;

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Run</Th>
          <Th>Kind</Th>
          <Th>Symbol</Th>
          <Th>Range</Th>
          <Th numeric>Trades</Th>
          <Th numeric>Net P&L</Th>
          <Th numeric>Profit factor</Th>
          <Th numeric>Expectancy</Th>
          <Th>Status</Th>
          <Th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const stats = r.stats;
          const netPnl = stats ? stats.netPnl : null;
          return (
            <TrLink key={r.id} href={`/backtest/runs/${r.id}`}>
              <Td>
                <div className="flex flex-col">
                  <span className="font-medium text-ink">{r.label ?? r.symbol}</span>
                  {r.strategyName ? <span className="text-2xs text-ink-3">{r.strategyName}</span> : null}
                </div>
              </Td>
              <Td>
                <Badge tone={r.kind === "STRATEGY" ? "brand" : "neutral"}>{r.kind}</Badge>
              </Td>
              <Td>
                <span className="mono text-xs">
                  {r.symbol} <span className="text-ink-3">{r.timeframe}</span>
                </span>
              </Td>
              <Td>
                <span className="mono text-2xs text-ink-3">{formatRange(r.fromTs, r.toTs)}</span>
              </Td>
              <Td numeric>{stats ? stats.tradeCount : <Empty />}</Td>
              <Td numeric>{stats ? <Money value={netPnl} currency={r.currency} signed /> : <Empty />}</Td>
              <Td numeric>{stats?.profitFactor != null ? stats.profitFactor.toFixed(2) : <Empty />}</Td>
              <Td numeric>{stats ? <RValue value={stats.expectancyR} /> : <Empty />}</Td>
              <Td>
                <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
              </Td>
              <Td>
                <RunRowMenu runId={r.id} label={r.label} />
              </Td>
            </TrLink>
          );
        })}
        {rows.length === 0 ? <TableEmpty colSpan={10}>No runs yet.</TableEmpty> : null}
      </tbody>
    </DataTable>
  );
}
