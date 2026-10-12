import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Play, FlaskConical, Database } from "lucide-react";
import { Page } from "@/components/shell/page";
import { SectionHead, Panel, PanelBody, Button, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { listRuns } from "@/lib/queries/backtests";
import { listCoverage } from "@/lib/queries/candles";
import { RunTable } from "@/components/backtest/run-table";

export default async function BacktestPage() {
  const user = await requireUser();
  const t = await getTranslations("backtest.index");
  const [runs, coverage] = await Promise.all([listRuns(user.id), listCoverage(user.id)]);

  const hasAnyCandles = coverage.length > 0;

  return (
    <Page>
      <SectionHead
        title={t("title")}
        hint={t("hint")}
        actions={
          <>
            <Button asChild variant="default" size="sm">
              <Link href="/backtest/data">
                <Database /> {t("marketData")}
              </Link>
            </Button>
            <Button asChild variant="default" size="sm">
              <Link href="/backtest/replay">
                <Play /> {t("newReplay")}
              </Link>
            </Button>
            {/* Primary only once there is data to run on; until then the
                empty state's "Go to Market data" is the one next step. */}
            <Button asChild variant={hasAnyCandles ? "primary" : "default"} size="sm">
              <Link href="/backtest/strategies">
                <FlaskConical /> {t("newStrategyRun")}
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
              title={t("noDataTitle")}
              description={t("noDataDescription")}
            />
            <div className="flex justify-center pb-4">
              <Button asChild variant="primary" size="sm">
                <Link href="/backtest/data">{t("goToData")}</Link>
              </Button>
            </div>
          </PanelBody>
        ) : runs.length === 0 ? (
          <PanelBody>
            <EmptyState
              icon={<FlaskConical className="size-4" />}
              title={t("noRunsTitle")}
              description={t("noRunsDescription")}
            />
          </PanelBody>
        ) : (
          <RunTable rows={runs} />
        )}
      </Panel>
    </Page>
  );
}
