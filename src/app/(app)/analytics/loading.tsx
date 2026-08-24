import { Page } from "@/components/shell/page";
import { Panel, PanelHeader, PanelBody, Skeleton, SkeletonText } from "@/components/ui";

/** Mirrors the Analytics page's Breakdowns tab (the default tab), so the tab switch doesn't reflow once real content lands. */
export default function AnalyticsLoading() {
  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-8 w-52" />
      </div>

      <div className="flex gap-4 border-b border-line pb-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>

      <Skeleton className="h-12 w-full" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Panel key={i}>
            <PanelHeader>
              <Skeleton className="h-4 w-24" />
            </PanelHeader>
            <PanelBody>
              <SkeletonText lines={5} />
            </PanelBody>
          </Panel>
        ))}
      </div>
    </Page>
  );
}
