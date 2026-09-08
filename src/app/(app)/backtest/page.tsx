import Link from "next/link";
import { Play, FlaskConical, Database } from "lucide-react";
import { Page } from "@/components/shell/page";
import { SectionHead, Panel, PanelBody, Button, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { listRuns } from "@/lib/queries/backtests";
import { listCoverage } from "@/lib/queries/candles";
import { RunTable } from "@/components/backtest/run-table";

export default async function BacktestPage() {
  const user = await requireUser();
  const [runs, coverage] = await Promise.all([listRuns(user.id), listCoverage(user.id)]);

  const hasAnyCandles = coverage.length > 0;

  return (
    <Page>
      <SectionHead
        title="Backtest"
        hint="Replay bars by hand, or let a coded strategy trade the whole range — both write ordinary trades to a BACKTEST account, so every report in the app works on them for free."
        actions={
          <>
            <Button asChild variant="default" size="sm">
              <Link href="/backtest/data">
                <Database /> Market data
              </Link>
            </Button>
            <Button asChild variant="default" size="sm">
              <Link href="/backtest/replay">
                <Play /> New replay
              </Link>
            </Button>
            <Button asChild variant="primary" size="sm">
              <Link href="/backtest/strategies">
                <FlaskConical /> New strategy run
              </Link>
            </Button>
          </>
        }
      />

      <Panel flush={hasAnyCandles && runs.length > 0}>
        {!hasAnyCandles ? (
          <PanelBody>
            <EmptyState
              icon={<Database className="size-4" />}
              title="No market data yet"
              description="A backtest reads historical bars from the journal's own store. Import a symbol's history to get started."
            />
            <div className="flex justify-center pb-4">
              <Button asChild variant="primary" size="sm">
                <Link href="/backtest/data">Go to Market data</Link>
              </Button>
            </div>
          </PanelBody>
        ) : runs.length === 0 ? (
          <PanelBody>
            <EmptyState
              icon={<FlaskConical className="size-4" />}
              title="No runs yet"
              description="Step through bars by hand in a replay, or run a coded strategy over a whole range."
            />
          </PanelBody>
        ) : (
          <RunTable rows={runs} />
        )}
      </Panel>
    </Page>
  );
}
