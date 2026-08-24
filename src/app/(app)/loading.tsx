import { Page, Grid } from "@/components/shell/page";
import { Panel, PanelHeader, PanelBody, Skeleton, SkeletonText, SkeletonRows } from "@/components/ui";

/** Mirrors the Overview page's exact layout so nothing reflows once real data arrives. */
export default function OverviewLoading() {
  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-8 w-52" />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonText key={i} lines={2} />
        ))}
      </div>

      <Grid>
        <Panel className="lg:col-span-8">
          <PanelHeader title="Equity" />
          <PanelBody className="h-56">
            <Skeleton className="h-full w-full" />
          </PanelBody>
          <div className="h-24 border-t border-line p-3">
            <Skeleton className="h-full w-full" />
          </div>
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-4">
          {["Open positions", "P&L", "Discipline"].map((title) => (
            <Panel key={title}>
              <PanelHeader title={title} />
              <PanelBody>
                <SkeletonText lines={3} />
              </PanelBody>
            </Panel>
          ))}
        </div>

        <Panel className="lg:col-span-7">
          <PanelHeader title="Recent trades" />
          <PanelBody padded={false}>
            <table className="data-table w-full">
              <tbody>
                <SkeletonRows rows={6} cols={5} />
              </tbody>
            </table>
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-5">
          <PanelHeader title="Daily P&L" />
          <PanelBody className="h-64">
            <Skeleton className="h-full w-full" />
          </PanelBody>
        </Panel>
      </Grid>
    </Page>
  );
}
