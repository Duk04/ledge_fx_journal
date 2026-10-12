import { getTranslations } from "next-intl/server";
import { SectionHead, Panel, PanelHeader, PanelBody } from "@/components/ui";
import { Page } from "@/components/shell/page";
import { canWriteSharedData, requireUser } from "@/lib/session";
import { listCoverage, candleStorageBytes } from "@/lib/queries/candles";
import { listActiveInstruments } from "@/lib/queries/instruments";
import { CoverageTable, type CoverageTableRow } from "@/components/backtest/coverage-table";
import { CandleImportPanel } from "@/components/backtest/candle-import";
import { CandleDownloadPanel } from "@/components/backtest/candle-download";
import { OANDA_INSTRUMENTS } from "@/lib/candles/oanda";
import { env } from "@/lib/env";

// Supabase's free tier (what this app is built against — see
// prisma/schema.prisma's SIZE WARNING on the Candle model).
const FREE_TIER_BYTES = 500 * 1024 * 1024;
// Same figure the schema doc quotes: ~370k M1 rows / ~35MB per symbol per year.
const YEAR_OF_M1_BYTES_PER_SYMBOL = 35 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default async function BacktestDataPage() {
  const user = await requireUser();
  const t = await getTranslations("backtest.data");
  // Candle data is shared by every account, so deleting a range is owner-only
  // (see lib/actions/candles.ts). Resolved here so the control is hidden
  // rather than failing on submit.
  const owner = canWriteSharedData(user.role);

  const [instruments, coverage, storageBytes] = await Promise.all([
    listActiveInstruments(),
    listCoverage(user.id),
    candleStorageBytes(),
  ]);

  const coverageRows: CoverageTableRow[] = coverage
    .slice()
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.timeframe.localeCompare(b.timeframe))
    .map((c) => ({
      symbol: c.symbol,
      timeframe: c.timeframe,
      barCount: c.barCount,
      firstTs: c.firstTs,
      lastTs: c.lastTs,
      source: c.source,
      estimatedGaps: c.estimatedGaps,
      latestImport: c.latestImport,
    }));

  const usagePct = Math.min(100, (storageBytes / FREE_TIER_BYTES) * 100);

  return (
    <Page>
      <SectionHead title={t("title")} hint={t("hint")} />

      <Panel>
        <PanelHeader
          title={t("storage")}
          caption={t("storageUsed", { used: formatBytes(storageBytes), total: formatBytes(FREE_TIER_BYTES) })}
        />
        <PanelBody className="flex flex-col gap-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset">
            <div
              className={`h-full rounded-full ${usagePct > 85 ? "bg-loss" : usagePct > 60 ? "bg-warn" : "bg-brand"}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <p className="text-xs text-ink-3">{t("storageNote", { size: formatBytes(YEAR_OF_M1_BYTES_PER_SYMBOL) })}</p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title={t("coverage")}
          caption={coverageRows.length > 0 ? t("coverageCaption", { count: String(coverageRows.length) }) : undefined}
        />
        <PanelBody padded={coverageRows.length === 0}>
          <CoverageTable rows={coverageRows} canDelete={owner} />
        </PanelBody>
      </Panel>

      <CandleDownloadPanel
        instruments={instruments.filter((i) => OANDA_INSTRUMENTS[i.symbol])}
        configured={Boolean(env.OANDA_API_TOKEN)}
        canWrite={owner}
      />

      <CandleImportPanel instruments={instruments} />
    </Page>
  );
}
