import { getTranslations } from "next-intl/server";
import { Page } from "@/components/shell/page";
import { Panel, PanelHeader, PanelBody, Skeleton, SkeletonText, SkeletonRows } from "@/components/ui";

/** Mirrors the top of the Overview page — the header, the six headline cards
 * and the balance chart — so what is on screen while it loads does not reflow
 * when the data arrives. The rest of the page is below the fold. */
export default async function OverviewLoading() {
  const t = await getTranslations("dashboard.overview");
  const tStats = await getTranslations("journal.stats");
  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-8 w-52" />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Panel key={i} className="p-4">
            <SkeletonText lines={2} />
          </Panel>
        ))}
      </div>

      <Panel>
        <PanelHeader title={tStats("balance")} />
        <PanelBody className="h-72">
          <Skeleton className="h-full w-full" />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title={t("recentTrades")} />
        <PanelBody padded={false}>
          <table className="data-table w-full">
            <tbody>
              <SkeletonRows rows={6} cols={5} />
            </tbody>
          </table>
        </PanelBody>
      </Panel>
    </Page>
  );
}
